import { createCipheriv, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
	decryptChromiumAes128CbcCookieValue,
	decryptChromiumAes256GcmCookieValue,
	deriveAes128CbcKeyFromPassword,
} from "../src/providers/chromeSqlite/crypto.js";
import { getCookiesFromChromeSqliteDb } from "../src/providers/chromeSqlite/shared.js";

const hostKey = ".example.com";
const hash = (host: string) => createHash("sha256").update(host).digest();

function encrypt(plaintext: Buffer, gcm: boolean) {
	const key = gcm
		? Buffer.alloc(32, 7)
		: deriveAes128CbcKeyFromPassword("synthetic", { iterations: 1 });
	if (gcm) {
		const nonce = Buffer.alloc(12, 9);
		const cipher = createCipheriv("aes-256-gcm", key, nonce);
		return {
			key,
			value: Buffer.concat([
				Buffer.from("v10"),
				nonce,
				cipher.update(plaintext),
				cipher.final(),
				cipher.getAuthTag(),
			]),
		};
	}
	const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
	return {
		key,
		value: Buffer.concat([Buffer.from("v10"), cipher.update(plaintext), cipher.final()]),
	};
}

describe("Chromium host binding", () => {
	it.each([false, true])("verifies the raw host hash with GCM=%s", async (gcm) => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-binding-"));
		try {
			const dbPath = path.join(dir, "Cookies");
			const db = new DatabaseSync(dbPath);
			db.exec(`CREATE TABLE meta (key TEXT, value INTEGER);
				INSERT INTO meta VALUES ('version', 24);
				CREATE TABLE cookies (name TEXT, value TEXT, host_key TEXT, path TEXT,
				expires_utc INTEGER, samesite INTEGER, encrypted_value BLOB, is_secure INTEGER, is_httponly INTEGER);`);
			const insert = db.prepare("INSERT INTO cookies VALUES (?, '', ?, '/', 0, 0, ?, 1, 1)");
			for (const [name, plaintext] of [
				["valid", Buffer.concat([hash(hostKey), Buffer.from("synthetic")])],
				["wrong-host", Buffer.concat([hash(".other.example"), Buffer.from("synthetic")])],
				["wrong-scope", Buffer.concat([hash("example.com"), Buffer.from("synthetic")])],
				["short", Buffer.from("synthetic")],
				["empty", hash(hostKey)],
			] as const) {
				insert.run(name, hostKey, encrypt(plaintext, gcm).value);
			}
			db.close();
			const key = encrypt(Buffer.alloc(0), gcm).key;
			const result = await getCookiesFromChromeSqliteDb(
				{ dbPath },
				["https://example.com/"],
				null,
				(value, options) =>
					gcm
						? decryptChromiumAes256GcmCookieValue(value, key, options)
						: decryptChromiumAes128CbcCookieValue(value, [key], options),
			);
			expect(result.cookies.map(({ name }) => name)).toEqual(["valid", "empty"]);
			expect(result.warnings).toEqual([
				"3 Chromium cookie(s) could not be decrypted or failed host binding verification.",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.each([false, true])("preserves pre-24 cookies with GCM=%s", (gcm) => {
		const { key, value } = encrypt(Buffer.from("synthetic"), gcm);
		const options = { stripHashPrefix: false, hostKey };
		expect(
			gcm
				? decryptChromiumAes256GcmCookieValue(value, key, options)
				: decryptChromiumAes128CbcCookieValue(value, [key], options),
		).toBe("synthetic");
	});
});
