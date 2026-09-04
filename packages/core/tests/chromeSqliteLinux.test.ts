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
			path.join(home, "snap", "brave", "common", "BraveSoftware", "Brave-Browser"),
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

	it("keeps unpinned default discovery scoped to Chrome", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const dbPath = path.join(home, "snap", "chromium", "common", "chromium", "Default", "Cookies");
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));

		expect(resolveLinuxChromiumCookiesDbs({})).toEqual([]);
	});

	it("discovers a Chrome Flatpak default profile when unpinned", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const dbPath = path.join(
			home,
			".var",
			"app",
			"com.google.Chrome",
			"config",
			"google-chrome",
			"Default",
			"Cookies",
		);
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));

		expect(resolveLinuxChromiumCookiesDbs({})).toEqual([
			{
				browser: "chrome",
				dbPath,
				keyringApp: "chrome",
				profile: "Default",
			},
		]);
	});

	it.each(targetRoots)("discovers every $browser root with ALL_PROFILES", ({ browser, roots }) => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const xdgConfigHome = path.join(home, "xdg");
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
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

	it("preserves Brave identity for an unpinned explicit cookie database", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const dbPath = path.join(
			home,
			"custom",
			"BraveSoftware",
			"Brave-Browser",
			"Profile 4",
			"Network",
			"Cookies",
		);
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");

		expect(resolveLinuxChromiumCookiesDbs({ profile: dbPath })).toEqual([
			{
				browser: "brave",
				dbPath,
				keyringApp: "brave",
				profile: "Profile 4",
				storeId: path.dirname(path.dirname(dbPath)),
			},
		]);
	});

	it("preserves Chromium identity for an unpinned explicit cookie database", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const dbPath = path.join(
			home,
			"snap",
			"chromium",
			"common",
			"chromium",
			"Profile 4",
			"Network",
			"Cookies",
		);
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));

		expect(resolveLinuxChromiumCookiesDbs({ profile: dbPath })).toEqual([
			{
				browser: "chromium",
				dbPath,
				keyringApp: "chromium",
				profile: "Profile 4",
				storeId: path.dirname(path.dirname(dbPath)),
			},
		]);
	});

	it("lets a pinned Chromium identity override explicit-path inference", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const dbPath = path.join(
			home,
			"custom",
			"BraveSoftware",
			"Brave-Browser",
			"Profile 4",
			"Network",
			"Cookies",
		);
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

	it("keeps unpinned ALL_PROFILES discovery scoped to Chrome", () => {
		const home = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-targets-"));
		const xdgConfigHome = path.join(home, "xdg");
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
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
		).toEqual(expected.filter(({ browser }) => browser === "chrome"));
	});
});
