import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { getCookies } from "../src/index.js";

describe("Firefox profile paths", () => {
	it.each(["directory", "directory named cookies.sqlite", "cookies.sqlite"])(
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
							profile: path.basename(profile),
						},
					}),
				]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it("returns identical cookies from cookies.sqlite and backup.sqlite", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		try {
			const dbPath = path.join(dir, "cookies.sqlite");
			const db = new DatabaseSync(dbPath);
			try {
				db.exec(
					`CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER);
					INSERT INTO moz_cookies VALUES ('sid', 'value', 'example.com', '/', 9999999999, 0, 0, 0);`,
				);
			} finally {
				db.close();
			}
			const backupPath = path.join(dir, "backup.sqlite");
			copyFileSync(dbPath, backupPath);
			const options = {
				url: "https://example.com/",
				browsers: ["firefox"],
			} satisfies Parameters<typeof getCookies>[0];
			const original = await getCookies({ ...options, firefoxProfile: dbPath });
			const backup = await getCookies({ ...options, firefoxProfile: backupPath });
			expect(original.warnings).toEqual([]);
			expect(backup.warnings).toEqual([]);
			expect(original.cookies).toEqual([
				expect.objectContaining({
					name: "sid",
					value: "value",
					source: { browser: "firefox", profile: path.basename(dir) },
				}),
			]);
			expect(backup.cookies).toEqual(original.cookies);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps cookies from suffix-named databases in different directories", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		try {
			for (const [profile, value] of [
				["one", "a"],
				["two", "b"],
			] as const) {
				const profileDir = path.join(dir, profile);
				mkdirSync(profileDir);
				const db = new DatabaseSync(path.join(profileDir, "backup-cookies.sqlite"));
				try {
					db.exec(
						"CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)",
					);
					db.prepare(
						"INSERT INTO moz_cookies VALUES ('sid', ?, 'example.com', '/', 9999999999, 0, 0, 0)",
					).run(value);
				} finally {
					db.close();
				}
			}
			const result = await getCookies({
				url: "https://example.com/",
				browsers: ["firefox"],
				firefoxProfile: [
					path.join(dir, "one", "backup-cookies.sqlite"),
					path.join(dir, "two", "backup-cookies.sqlite"),
				],
			});
			expect(result.warnings).toEqual([]);
			expect(
				result.cookies.map(({ value, source }) => ({ value, profile: source?.profile })),
			).toEqual([
				{ value: "a", profile: "one" },
				{ value: "b", profile: "two" },
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("resolves parent traversal after following a symlink", async ({ skip }) => {
		if (process.platform === "win32") {
			skip("Windows resolves parent traversal before following symlinks");
		}
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
					source: { browser: "firefox", profile: ".." },
				}),
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
