import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
						source: { browser: "firefox", profile: path.basename(profile) },
					}),
				]);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
