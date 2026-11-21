import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getCookiesFromChromeSqliteDb } from "../src/providers/chromeSqlite/shared.js";
import { getCookiesFromFirefox } from "../src/providers/firefoxSqlite.js";
import { importNodeSqlite } from "../src/util/nodeSqlite.js";

it.each(["chrome", "firefox"] as const)(
	"reads large origin lists with %s without broadening cookie scope",
	async (browser) => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-origins-"));
		try {
			const dbPath = path.join(dir, browser === "chrome" ? "Cookies" : "cookies.sqlite");
			const { DatabaseSync } = await importNodeSqlite();
			const db = new DatabaseSync(dbPath);
			try {
				if (browser === "chrome") {
					db.exec(`CREATE TABLE meta (key TEXT, value INTEGER);
						INSERT INTO meta VALUES ('version', 24);
						CREATE TABLE cookies (name TEXT, value TEXT, host_key TEXT, path TEXT,
							expires_utc INTEGER, samesite INTEGER, encrypted_value BLOB,
							is_secure INTEGER, is_httponly INTEGER);`);
					const insert = db.prepare(
						"INSERT INTO cookies VALUES (?, 'synthetic', ?, '/', 0, 0, X'', 0, 0)",
					);
					insert.run("first", "h0.example.com");
					insert.run("last", "h1199.example.com");
					insert.run("parent", ".example.com");
					insert.run("unrequested", "other.example.com");
				} else {
					db.exec(`CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT,
						expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);`);
					const insert = db.prepare(
						"INSERT INTO moz_cookies VALUES (?, 'synthetic', ?, '/', 0, 0, 0, 0)",
					);
					insert.run("first", "h0.example.com");
					insert.run("last", "h1199.example.com");
					insert.run("parent", ".example.com");
					insert.run("unrequested", "other.example.com");
				}
			} finally {
				db.close();
			}

			for (const count of [200, 1200]) {
				const origins = Array.from({ length: count }, (_, i) => `https://h${i}.example.com/`);
				const result =
					browser === "chrome"
						? await getCookiesFromChromeSqliteDb({ dbPath }, origins, null, () => null)
						: await getCookiesFromFirefox({ profile: dbPath }, origins, null);
				expect(result.warnings).toEqual([]);
				expect(result.cookies.map(({ name }) => name).sort()).toEqual(
					count === 200 ? ["first", "parent"] : ["first", "last", "parent"],
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
