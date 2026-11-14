import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import { getCookies } from "../src/index.js";

describe("Firefox expiry in SQLite", () => {
	it.each([
		{ schema: 15, factor: 1 },
		{ schema: 16, factor: 1000 },
		{ schema: 17, factor: 1000 },
	])("reads schema $schema expiry units", async ({ schema, factor }) => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-expiry-"));
		const dbPath = path.join(dir, "cookies.sqlite");
		const now = 2_000_000_000;
		vi.spyOn(Date, "now").mockReturnValue(now * 1000 + 500);
		try {
			const db = new DatabaseSync(dbPath);
			db.exec(`PRAGMA user_version = ${schema};
				CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);`);
			const insert = db.prepare(
				"INSERT INTO moz_cookies VALUES (?, 'value', 'example.com', '/', ?, 0, 0, 0)",
			);
			insert.run("expired", (now - 3600) * factor);
			insert.run("valid", (now + 3600) * factor + (factor === 1000 ? 999 : 0));
			db.close();

			const options: Parameters<typeof getCookies>[0] = {
				url: "https://example.com/",
				browsers: ["firefox"],
				firefoxProfile: dbPath,
			};
			const result = await getCookies(options);
			expect(result.warnings).toEqual([]);
			expect(result.cookies.map(({ name, expires }) => ({ name, expires }))).toEqual([
				{ name: "valid", expires: now + 3600 },
			]);
			const all = await getCookies({ ...options, includeExpired: true });
			expect(all.cookies.map(({ name, expires }) => ({ name, expires }))).toEqual([
				{ name: "valid", expires: now + 3600 },
				{ name: "expired", expires: now - 3600 },
			]);
		} finally {
			vi.restoreAllMocks();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("preserves session cookies and enforces millisecond and year-9999 boundaries", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-expiry-"));
		const dbPath = path.join(dir, "cookies.sqlite");
		const now = 2_000_000_000_500;
		vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			const db = new DatabaseSync(dbPath);
			db.exec(`PRAGMA user_version = 16;
				CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);`);
			const insert = db.prepare(
				"INSERT INTO moz_cookies VALUES (?, 'value', 'example.com', '/', ?, 0, 0, 0)",
			);
			insert.run("session", 0);
			insert.run("at-now", now);
			insert.run("after-now", now + 1);
			insert.run("year-9999", 253_402_300_799_999);
			insert.run("year-10000", 253_402_300_800_000);
			db.close();
			const result = await getCookies({
				url: "https://example.com/",
				browsers: ["firefox"],
				firefoxProfile: dbPath,
			});
			expect(result.warnings).toEqual([]);
			expect(result.cookies.map(({ name, expires }) => ({ name, expires }))).toEqual([
				{ name: "year-10000", expires: undefined },
				{ name: "year-9999", expires: 253_402_300_799 },
				{ name: "after-now", expires: 2_000_000_000 },
				{ name: "session", expires: undefined },
			]);
		} finally {
			vi.restoreAllMocks();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
