import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const describeIfDarwin = process.platform === "darwin" ? describe : describe.skip;

type SqliteRow = Record<string, unknown>;
type NodeSqliteState = { rows: SqliteRow[]; shouldThrow: boolean };

const nodeSqlite = vi.hoisted<NodeSqliteState>(() => ({ rows: [], shouldThrow: false }));

vi.mock("node:sqlite", () => {
	class DatabaseSync {
		constructor(_path: string, _options?: unknown) {
			if (nodeSqlite.shouldThrow) {
				throw new Error("boom");
			}
		}

		prepare() {
			return { all: () => nodeSqlite.rows };
		}

		close() {}
	}

	return { DatabaseSync };
});

function prependToPath(dir: string): void {
	const parts = [dir, process.env.PATH ?? ""].filter(Boolean);
	vi.stubEnv("PATH", parts.join(path.delimiter));
}

function writeSecurityShim(
	binDir: string,
	options: { expectedArgs: string[]; password: string; exitCode?: number },
): void {
	mkdirSync(binDir, { recursive: true });

	const shim = path.join(binDir, "security");
	const script = [
		"#!/usr/bin/env node",
		"const expected = JSON.parse(process.env['SWEET_COOKIE_TEST_EXPECTED_ARGS'] ?? '[]');",
		"const args = process.argv.slice(2);",
		"if (JSON.stringify(args) !== JSON.stringify(expected)) {",
		'  process.stderr.write("unexpected args: " + args.join(" ") + "\\n");',
		"  process.exit(2);",
		"}",
		`process.stdout.write(${JSON.stringify(`${options.password}\n`)});`,
		`process.exit(${options.exitCode ?? 0});`,
	].join("\n");
	writeFileSync(shim, script, { encoding: "utf8" });
	if (process.platform !== "win32") {
		chmodSync(shim, 0o755);
	}

	vi.stubEnv("SWEET_COOKIE_TEST_EXPECTED_ARGS", JSON.stringify(options.expectedArgs));
}

function encryptEdgeCookieValueMac(plaintext: string, password: string): Buffer {
	const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
	const iv = Buffer.alloc(16, 0x20);
	const cipher = createCipheriv("aes-128-cbc", key, iv);
	cipher.setAutoPadding(false);

	const data = Buffer.from(plaintext, "utf8");
	const padding = 16 - (data.length % 16);
	const paddingSize = padding === 0 ? 16 : padding;
	const padded = Buffer.concat([data, Buffer.alloc(paddingSize, paddingSize)]);
	const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

	return Buffer.concat([Buffer.from("v11", "utf8"), encrypted]);
}

describeIfDarwin("edge sqlite (mac) provider", () => {
	beforeEach(() => {
		nodeSqlite.rows = [];
		nodeSqlite.shouldThrow = false;
	});

	it("discovers Default profile and decrypts cookies via Keychain password", async () => {
		vi.resetModules();

		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-edge-home-"));
		const cookiesDb = path.join(
			home,
			"Library",
			"Application Support",
			"Microsoft Edge",
			"Default",
			"Network",
			"Cookies",
		);
		mkdirSync(path.dirname(cookiesDb), { recursive: true });
		writeFileSync(cookiesDb, "", "utf8");

		vi.doMock("node:os", async () => {
			const actual = await vi.importActual<typeof import("node:os")>("node:os");
			return { ...actual, homedir: () => home };
		});

		const binDir = path.join(home, "bin");
		const password = "edge-password";
		writeSecurityShim(binDir, {
			expectedArgs: [
				"find-generic-password",
				"-w",
				"-a",
				"Microsoft Edge",
				"-s",
				"Microsoft Edge Safe Storage",
			],
			password,
		});
		prependToPath(binDir);

		const encrypted = encryptEdgeCookieValueMac("cookie-value", password);
		nodeSqlite.rows = [
			{
				name: "sid",
				value: "",
				host_key: ".chatgpt.com",
				path: "/",
				expires_utc: 1700000000,
				is_secure: 1,
				is_httponly: 1,
				samesite: 2,
				encrypted_value: encrypted,
			},
		];

		const { getCookiesFromEdgeSqliteMac } = await import("../src/providers/edgeSqliteMac.js");
		const res = await getCookiesFromEdgeSqliteMac(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.warnings).toEqual([]);
		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe("sid");
		expect(res.cookies[0]?.source?.browser).toBe("edge");
		expect(res.cookies[0]?.value).toBe("cookie-value");
	});
});
