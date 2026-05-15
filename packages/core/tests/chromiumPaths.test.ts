import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	resolveChromiumCookiesDbLinux,
	resolveChromiumCookiesDbsLinux,
} from "../src/providers/chromium/linuxPaths.js";
import {
	ALL_CHROMIUM_PROFILES,
	expandPath,
	looksLikePath,
	resolveCookiesDbFromProfileOrRoots,
	resolveCookiesDbsFromProfileOrRoots,
	safeStat,
} from "../src/providers/chromium/paths.js";
import {
	resolveChromiumPathsWindows,
	resolveChromiumPathsWindowsAll,
} from "../src/providers/chromium/windowsPaths.js";
import { ALL_PROFILES } from "../src/types.js";

describe("chromium path helpers", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("handles generic path helpers", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-paths-"));
		const file = path.join(dir, "Cookies");
		writeFileSync(file, "", "utf8");

		expect(looksLikePath("Default")).toBe(false);
		expect(looksLikePath("Profile 1/Cookies")).toBe(true);
		expect(expandPath("~/Library")).toBe(path.join(homedir(), "Library"));
		expect(expandPath(file)).toBe(file);
		expect(safeStat(file)?.isFile()).toBe(true);
		expect(safeStat(path.join(dir, "missing"))).toBeNull();
	});

	it("resolves cookies DBs from explicit files, profile directories, and roots", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-roots-"));
		const explicitFile = path.join(dir, "explicit", "Cookies");
		mkdirSync(path.dirname(explicitFile), { recursive: true });
		writeFileSync(explicitFile, "", "utf8");

		expect(
			resolveCookiesDbFromProfileOrRoots({
				profile: explicitFile,
				roots: [path.join(dir, "unused")],
			}),
		).toBe(explicitFile);

		const profileDir = path.join(dir, "profile-dir");
		mkdirSync(path.join(profileDir, "Network"), { recursive: true });
		writeFileSync(path.join(profileDir, "Network", "Cookies"), "", "utf8");
		expect(resolveCookiesDbFromProfileOrRoots({ profile: profileDir, roots: [] })).toBe(
			path.join(profileDir, "Network", "Cookies"),
		);

		const root = path.join(dir, "root");
		mkdirSync(path.join(root, "Profile 2"), { recursive: true });
		writeFileSync(path.join(root, "Profile 2", "Cookies"), "", "utf8");
		expect(resolveCookiesDbFromProfileOrRoots({ profile: "Profile 2", roots: [root] })).toBe(
			path.join(root, "Profile 2", "Cookies"),
		);
	});

	it("keeps omitted Chromium profile on Default and uses sentinel for all profile DBs", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-profile-aliases-"));
		const root = path.join(dir, "root");
		const stringifiedAllProfiles = String(ALL_PROFILES);
		const defaultDb = path.join(root, "Default", "Network", "Cookies");
		const workDb = path.join(root, "Profile 1", "Network", "Cookies");
		const stringifiedAllProfilesDb = path.join(root, stringifiedAllProfiles, "Network", "Cookies");
		mkdirSync(path.dirname(defaultDb), { recursive: true });
		mkdirSync(path.dirname(workDb), { recursive: true });
		mkdirSync(path.dirname(stringifiedAllProfilesDb), { recursive: true });
		writeFileSync(defaultDb, "", "utf8");
		writeFileSync(workDb, "", "utf8");
		writeFileSync(stringifiedAllProfilesDb, "", "utf8");
		writeFileSync(
			path.join(root, "Local State"),
			JSON.stringify({
				profile: {
					info_cache: {
						Default: { name: "Personal" },
						"Profile 1": { name: "Work" },
						[stringifiedAllProfiles]: { name: stringifiedAllProfiles },
					},
				},
			}),
			"utf8",
		);

		expect(resolveCookiesDbFromProfileOrRoots({ profile: "Work", roots: [root] })).toBe(workDb);
		expect(
			resolveCookiesDbFromProfileOrRoots({
				profile: stringifiedAllProfiles,
				roots: [root],
			}),
		).toBe(stringifiedAllProfilesDb);
		expect(resolveCookiesDbFromProfileOrRoots({ roots: [root] })).toBe(defaultDb);
		expect(
			resolveCookiesDbsFromProfileOrRoots({
				profile: ALL_CHROMIUM_PROFILES,
				roots: [root],
			}).map((item) => item.dbPath),
		).toEqual([defaultDb, workDb, stringifiedAllProfilesDb]);
	});

	it("uses the first root with Default when Chromium profile is omitted", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-default-root-"));
		const firstRoot = path.join(dir, "Chrome");
		const secondRoot = path.join(dir, "Brave");
		const chromeDb = path.join(firstRoot, "Default", "Network", "Cookies");
		const braveDb = path.join(secondRoot, "Default", "Network", "Cookies");
		mkdirSync(path.dirname(chromeDb), { recursive: true });
		mkdirSync(path.dirname(braveDb), { recursive: true });
		writeFileSync(chromeDb, "", "utf8");
		writeFileSync(braveDb, "", "utf8");

		expect(resolveCookiesDbsFromProfileOrRoots({ roots: [firstRoot, secondRoot] })).toEqual([
			{ dbPath: chromeDb, profile: "Default" },
		]);
	});

	it("resolves linux Chromium DBs from XDG config roots and explicit paths", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-paths-"));
		vi.stubEnv("HOME", dir);
		vi.stubEnv("XDG_CONFIG_HOME", path.join(dir, "xdg"));

		const defaultDb = path.join(dir, "xdg", "BraveSoftware", "Brave-Browser", "Default", "Cookies");
		mkdirSync(path.dirname(defaultDb), { recursive: true });
		writeFileSync(defaultDb, "", "utf8");

		expect(
			resolveChromiumCookiesDbLinux({
				configDirName: path.join("BraveSoftware", "Brave-Browser"),
			}),
		).toBe(defaultDb);

		const profileDir = path.join(dir, "custom-profile");
		mkdirSync(path.join(profileDir, "Network"), { recursive: true });
		writeFileSync(path.join(profileDir, "Network", "Cookies"), "", "utf8");
		expect(
			resolveChromiumCookiesDbLinux({
				configDirName: "ignored",
				profile: profileDir,
			}),
		).toBe(path.join(profileDir, "Network", "Cookies"));
	});

	it("derives Linux profile names from explicit Network/Cookies DB paths", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-explicit-db-"));
		const dbPath = path.join(dir, "Profile 4", "Network", "Cookies");
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");

		expect(
			resolveChromiumCookiesDbsLinux({
				configDirName: "ignored",
				profile: dbPath,
			}),
		).toEqual([{ dbPath, profile: "Profile 4" }]);
	});

	it("resolves Windows Chromium DBs and Local State fallbacks", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-windows-paths-"));
		vi.stubEnv("LOCALAPPDATA", dir);

		const root = path.join(dir, "Google", "Chrome", "User Data");
		const dbPath = path.join(root, "Default", "Network", "Cookies");
		const legacyDbPath = path.join(root, "Default", "Cookies");
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");
		writeFileSync(legacyDbPath, "", "utf8");
		writeFileSync(path.join(root, "Local State"), "{}", "utf8");

		expect(
			resolveChromiumPathsWindows({
				localAppDataVendorPath: path.join("Google", "Chrome", "User Data"),
			}),
		).toEqual({ dbPath, userDataDir: root });

		const explicitProfileDir = path.join(dir, "EdgeProfile");
		mkdirSync(explicitProfileDir, { recursive: true });
		writeFileSync(path.join(explicitProfileDir, "Local State"), "{}", "utf8");
		expect(
			resolveChromiumPathsWindows({
				localAppDataVendorPath: path.join("Microsoft", "Edge", "User Data"),
				profile: explicitProfileDir,
			}),
		).toEqual({ dbPath: null, userDataDir: explicitProfileDir });

		expect(
			resolveChromiumPathsWindows({
				localAppDataVendorPath: path.join("Missing", "Chrome", "User Data"),
			}),
		).toEqual({ dbPath: null, userDataDir: path.join(dir, "Missing", "Chrome", "User Data") });
	});

	it("derives Windows profile names from explicit Network/Cookies DB paths", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-windows-explicit-db-"));
		const userDataDir = path.join(dir, "Chrome", "User Data");
		const dbPath = path.join(userDataDir, "Profile 9", "Network", "Cookies");
		mkdirSync(path.dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "", "utf8");
		writeFileSync(path.join(userDataDir, "Local State"), "{}", "utf8");

		expect(
			resolveChromiumPathsWindowsAll({
				localAppDataVendorPath: path.join("unused"),
				profile: dbPath,
			}),
		).toEqual([{ dbPath, userDataDir, profile: "Profile 9" }]);
	});
});
