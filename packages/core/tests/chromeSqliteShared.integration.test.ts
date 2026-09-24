import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getCookiesFromChromeSqliteDb } from "../src/providers/chromeSqlite/shared.js";
import { importNodeSqlite } from "../src/util/nodeSqlite.js";

it("reads large Chromium expiries without overflow and orders them numerically", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-bigint-"));
	try {
		const dbPath = path.join(dir, "Cookies");
		const { DatabaseSync } = await importNodeSqlite();
		const db = new DatabaseSync(dbPath);
		try {
			db.exec(`
				CREATE TABLE meta (key TEXT, value INTEGER);
				INSERT INTO meta VALUES ('version', 24);
				CREATE TABLE cookies (
					name TEXT, value TEXT, host_key TEXT, path TEXT, expires_utc INTEGER,
					samesite INTEGER, encrypted_value BLOB, is_secure INTEGER, is_httponly INTEGER
				);
				INSERT INTO cookies VALUES
					('earlier', 'synthetic', '.example.com', '/', 9999999999999999, 1, X'', 1, 0),
					('reported', 'synthetic', '.example.com', '/', 13466633372274744, 2, X'', 1, 1);
			`);
		} finally {
			db.close();
		}

		const result = await getCookiesFromChromeSqliteDb(
			{ dbPath, includeExpired: true },
			["https://example.com/"],
			null,
			() => null,
		);

		expect(result.warnings).toEqual([]);
		expect(result.cookies.map((cookie) => cookie.name)).toEqual(["reported", "earlier"]);
		expect(result.cookies[0]).toMatchObject({
			value: "synthetic",
			expires: 1_822_159_772,
			secure: true,
			httpOnly: true,
			sameSite: "Strict",
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
