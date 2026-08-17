import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getCookiesFromFirefox } from "../src/providers/firefoxSqlite.js";

test("firefox sqlite provider reads via bun:sqlite", async () => {
	const dir = path.join(tmpdir(), `sweet-cookie-bun-${Date.now()}`);
	const profileDir = path.join(dir, "profile");
	mkdirSync(profileDir, { recursive: true });

	const dbPath = path.join(profileDir, "cookies.sqlite");
	const db = new Database(dbPath);
	try {
		db.query(
			`CREATE TABLE moz_cookies (
        name TEXT,
        value TEXT,
        host TEXT,
        path TEXT,
        expiry INTEGER,
        isSecure INTEGER,
        isHttpOnly INTEGER,
		sameSite INTEGER,
		originAttributes TEXT,
		isPartitionedAttributeSet INTEGER
      );`,
		).run();
		db.query(
			`INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes, isPartitionedAttributeSet)
			 VALUES
			 ('sid', 'domain-value', '.chatgpt.com', '/', 9999999999, 1, 1, 2, '', 0),
			 ('sid', 'host-value', 'chatgpt.com', '/', 9999999999, 1, 1, 2, '', 0),
			 ('partitioned', 'partitioned-value', '.chatgpt.com', '/', 9999999999, 1, 1, 2, '', 1),
			 ('container', 'container-value', '.chatgpt.com', '/', 9999999999, 1, 1, 2, '^userContextId=2', 0);`,
		).run();
	} finally {
		db.close();
	}

	const res = await getCookiesFromFirefox(
		{ profile: profileDir, includeExpired: false },
		["https://sub.chatgpt.com/"],
		null,
	);

	expect(res.cookies.length).toBe(1);
	expect(res.cookies[0]?.name).toBe("sid");
	expect(res.cookies[0]?.value).toBe("domain-value");
	expect(res.cookies[0]?.hostOnly).toBe(false);
	expect(res.cookies[0]?.sameSite).toBe("Strict");
	expect(res.warnings).toEqual([
		"2 partitioned or container-scoped Firefox cookie(s) were excluded because replay cannot preserve their origin attributes.",
	]);
});

test("firefox sqlite provider reads schemas without isolation columns", async () => {
	const dir = path.join(tmpdir(), `sweet-cookie-bun-legacy-${Date.now()}`);
	const profileDir = path.join(dir, "profile");
	mkdirSync(profileDir, { recursive: true });

	const dbPath = path.join(profileDir, "cookies.sqlite");
	const db = new Database(dbPath);
	try {
		db.query(
			`CREATE TABLE moz_cookies (
        name TEXT,
        value TEXT,
        host TEXT,
        path TEXT,
        expiry INTEGER,
        isSecure INTEGER,
        isHttpOnly INTEGER,
        sameSite INTEGER
      );`,
		).run();
		db.query(
			`INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite)
       VALUES ('sid', 'value', 'example.com', '/', 9999999999, 1, 1, 2);`,
		).run();
	} finally {
		db.close();
	}

	const res = await getCookiesFromFirefox(
		{ profile: profileDir, includeExpired: false },
		["https://example.com/"],
		null,
	);

	expect(res.cookies).toHaveLength(1);
	expect(res.cookies[0]?.name).toBe("sid");
	expect(res.cookies[0]?.hostOnly).toBe(true);
	expect(res.warnings).toEqual([]);
});
