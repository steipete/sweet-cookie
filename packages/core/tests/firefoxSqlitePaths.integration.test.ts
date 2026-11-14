import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { getCookies } from "../src/index.js";

describe("Firefox profile paths", () => {
	it.each(["directory", "directory named cookies.sqlite", "cookies.sqlite", "a.sqlite"])(
		"reads a database from %s",
		async (selector) => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
			const profile = path.join(
				dir,
				selector === "directory named cookies.sqlite" ? "cookies.sqlite" : "profile",
			);
			mkdirSync(profile);
			try {
				const dbPath = path.join(profile, "cookies.sqlite");
				const db = new DatabaseSync(dbPath);
				db.exec(`CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);
				INSERT INTO moz_cookies VALUES ('sid', 'value', 'example.com', '/', 9999999999, 0, 0, 0);`);
				db.close();
				copyFileSync(dbPath, path.join(profile, "a.sqlite"));

				const result = await getCookies({
					url: "https://example.com/",
					browsers: ["firefox"],
					firefoxProfile: selector.startsWith("directory") ? profile : path.join(profile, selector),
				});
				expect(result.warnings).toEqual([]);
				expect(result.cookies).toEqual([
					expect.objectContaining({
						name: "sid",
						value: "value",
						source: {
							browser: "firefox",
							profile: selector === "a.sqlite" ? "a.sqlite" : path.basename(profile),
						},
					}),
				]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it("keeps cookies from two renamed databases in one directory", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		try {
			for (const [filename, value] of [
				["a.sqlite", "a"],
				["b.sqlite", "b"],
			] as const) {
				const db = new DatabaseSync(path.join(dir, filename));
				db.exec(
					`CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);`,
				);
				db.prepare(
					"INSERT INTO moz_cookies VALUES ('sid', ?, 'example.com', '/', 9999999999, 0, 0, 0)",
				).run(value);
				db.close();
			}
			const result = await getCookies({
				url: "https://example.com/",
				browsers: ["firefox"],
				firefoxProfile: [path.join(dir, "a.sqlite"), path.join(dir, "b.sqlite")],
			});
			expect(result.warnings).toEqual([]);
			expect(
				result.cookies.map(({ value, source }) => ({ value, profile: source?.profile })),
			).toEqual([
				{ value: "a", profile: "a.sqlite" },
				{ value: "b", profile: "b.sqlite" },
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads WAL changes through a symlink and labels it by the link name", async ({ skip }) => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		try {
			const dbPath = path.join(dir, "a.sqlite");
			const db = new DatabaseSync(dbPath);
			try {
				db.exec(`CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);
					PRAGMA journal_mode = WAL;
					INSERT INTO moz_cookies VALUES ('sid', 'value', 'example.com', '/', 9999999999, 0, 0, 0);`);
				const basePath = path.join(dir, "base.sqlite");
				copyFileSync(dbPath, basePath);
				const base = new DatabaseSync(basePath, { readOnly: true });
				try {
					expect(base.prepare("SELECT count(*) AS count FROM moz_cookies").get()?.count).toBe(0);
				} finally {
					base.close();
				}
				const link = path.join(dir, "b.sqlite");
				try {
					symlinkSync(dbPath, link);
				} catch (error) {
					if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) {
						skip("Symlink creation is not permitted");
					}
					throw error;
				}
				const result = await getCookies({
					url: "https://example.com/",
					browsers: ["firefox"],
					firefoxProfile: link,
				});
				expect(result.warnings).toEqual([]);
				expect(result.cookies).toEqual([
					expect.objectContaining({
						name: "sid",
						value: "value",
						source: { browser: "firefox", profile: "b.sqlite" },
					}),
				]);
			} finally {
				db.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("resolves parent traversal after following a symlink", async ({ skip }) => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		try {
			const target = path.join(dir, "target");
			const sub = path.join(target, "sub");
			const links = path.join(dir, "links");
			mkdirSync(sub, { recursive: true });
			mkdirSync(links);
			const db = new DatabaseSync(path.join(target, "a.sqlite"));
			try {
				db.exec(`CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);
					INSERT INTO moz_cookies VALUES ('sid', 'value', 'example.com', '/', 9999999999, 0, 0, 0);`);
			} finally {
				db.close();
			}
			const link = path.join(links, "link");
			try {
				symlinkSync(sub, link, "dir");
			} catch (error) {
				if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) {
					skip("Symlink creation is not permitted");
				}
				throw error;
			}
			const result = await getCookies({
				url: "https://example.com/",
				browsers: ["firefox"],
				firefoxProfile: `${link}${path.sep}..${path.sep}a.sqlite`,
			});
			expect(result.warnings).toEqual([]);
			expect(result.cookies).toEqual([
				expect.objectContaining({
					name: "sid",
					value: "value",
					source: { browser: "firefox", profile: "a.sqlite" },
				}),
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
