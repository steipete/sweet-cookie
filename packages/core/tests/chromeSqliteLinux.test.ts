import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveLinuxChromiumCookiesDbs } from "../src/providers/chromium/linuxTargets.js";
import { ALL_CHROMIUM_PROFILES } from "../src/providers/chromium/paths.js";

const targetRoots = [
	{
		browser: "chrome" as const,
		roots: (home: string, xdgConfigHome: string) => [
			path.join(xdgConfigHome, "google-chrome"),
			path.join(home, ".var", "app", "com.google.Chrome", "config", "google-chrome"),
		],
	},
	{
		browser: "chromium" as const,
		roots: (home: string, xdgConfigHome: string) => [
			path.join(xdgConfigHome, "chromium"),
			path.join(home, "snap", "chromium", "common", "chromium"),
			path.join(home, ".var", "app", "org.chromium.Chromium", "config", "chromium"),
		],
	},
	{
		browser: "brave" as const,
		roots: (home: string, xdgConfigHome: string) => [
			path.join(xdgConfigHome, "BraveSoftware", "Brave-Browser"),
			path.join(
				home,
				".var",
				"app",
				"com.brave.Browser",
				"config",
				"BraveSoftware",
				"Brave-Browser",
			),
		],
	},
];

describe("chrome sqlite (linux) discovery", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("discovers a Chromium Snap default profile when no browser is pinned", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const dbPath = path.join(home, "snap", "chromium", "common", "chromium", "Default", "Cookies");
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");
		vi.stubEnv("HOME", home);
		vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));

		expect(resolveLinuxChromiumCookiesDbs({})).toEqual([
			{
				browser: "chromium",
				dbPath,
				keyringApp: "chromium",
				profile: "Default",
			},
		]);
	});

	it.each(targetRoots)("discovers every $browser root with ALL_PROFILES", ({ browser, roots }) => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const xdgConfigHome = path.join(home, "xdg");
		vi.stubEnv("HOME", home);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const dbPaths = roots(home, xdgConfigHome).map((root, index) =>
			path.join(root, `Profile ${index + 1}`, "Network", "Cookies"),
		);
		for (const dbPath of dbPaths) {
			mkdirSync(path.dirname(dbPath), { recursive: true });
			writeFileSync(dbPath, "", "utf8");
		}

		expect(
			resolveLinuxChromiumCookiesDbs({
				chromiumBrowser: browser,
				profile: ALL_CHROMIUM_PROFILES,
			}).map((db) => db.dbPath),
		).toEqual(dbPaths);
	});

	it("uses a pinned Chromium identity for an explicit cookie database", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const dbPath = path.join(home, "custom", "Profile 4", "Network", "Cookies");
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");

		expect(
			resolveLinuxChromiumCookiesDbs({
				chromiumBrowser: "chromium",
				profile: dbPath,
			}),
		).toEqual([
			{
				browser: "chromium",
				dbPath,
				keyringApp: "chromium",
				profile: "Profile 4",
				storeId: path.dirname(path.dirname(dbPath)),
			},
		]);
	});

	it("reads every supported root when ALL_PROFILES is unpinned", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const xdgConfigHome = path.join(home, "xdg");
		vi.stubEnv("HOME", home);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const expected = targetRoots.flatMap(({ browser, roots }) =>
			roots(home, xdgConfigHome).map((root) => {
				const dbPath = path.join(root, "Default", "Network", "Cookies");
				mkdirSync(path.dirname(dbPath), { recursive: true });
				writeFileSync(dbPath, "", "utf8");
				return { browser, dbPath, storeId: root };
			}),
		);

		expect(
			resolveLinuxChromiumCookiesDbs({ profile: ALL_CHROMIUM_PROFILES }).map(
				({ browser, dbPath, storeId }) => ({ browser, dbPath, storeId }),
			),
		).toEqual(expected);
	});
});
