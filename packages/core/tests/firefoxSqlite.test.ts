import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCookiesFromFirefox } from "../src/providers/firefoxSqlite.js";

type SqliteRow = Record<string, unknown>;
type NodeSqliteState = { rows: SqliteRow[]; shouldThrow: boolean };

function stubFirefoxProfilesRoot(homeDir: string): string {
	if (process.platform === "darwin") {
		vi.stubEnv("HOME", homeDir);
		return path.join(homeDir, "Library", "Application Support", "Firefox", "Profiles");
	}

	if (process.platform === "linux") {
		vi.stubEnv("HOME", homeDir);
		return path.join(homeDir, ".mozilla", "firefox");
	}

	if (process.platform === "win32") {
		const appData = path.join(homeDir, "AppData", "Roaming");
		vi.stubEnv("APPDATA", appData);
		return path.join(appData, "Mozilla", "Firefox", "Profiles");
	}

	throw new Error(`Unsupported platform: ${process.platform}`);
}

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

describe("firefox sqlite provider", () => {
	beforeEach(() => {
		nodeSqlite.rows = [];
		nodeSqlite.shouldThrow = false;
	});

	it("reads cookies via node:sqlite", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const dbDir = path.join(dir, "profile");

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, "cookies.sqlite"), "", "utf8");
		nodeSqlite.rows = [
			{
				name: "sid",
				value: "value",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: false },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe("sid");
		expect(res.cookies[0]?.secure).toBe(true);
		expect(res.cookies[0]?.httpOnly).toBe(true);
		expect(res.cookies[0]?.sameSite).toBe("Strict");
	});

	it("drops impossible far-future Firefox expiry values", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const dbDir = path.join(dir, "profile");

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, "cookies.sqlite"), "", "utf8");
		nodeSqlite.rows = [
			{
				name: "sid",
				value: "value",
				host: ".chatgpt.com",
				path: "/",
				expiry: "253402300800",
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.expires).toBeUndefined();
	});

	it("accepts a direct cookies.sqlite path", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const dbDir = path.join(dir, "profile");
		mkdirSync(dbDir, { recursive: true });
		const dbPath = path.join(dbDir, "cookies.sqlite");
		writeFileSync(dbPath, "", "utf8");

		nodeSqlite.rows = [
			{
				name: "sid",
				value: "value",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbPath, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe("sid");
	});

	it("resolves profile by name from default Profiles root", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const homeDir = path.join(dir, "home");
		const profilesRoot = stubFirefoxProfilesRoot(homeDir);
		const profileName = "abc.default-release";
		const profileDir = path.join(profilesRoot, profileName);

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		nodeSqlite.rows = [
			{
				name: "sid",
				value: "value",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: profileName, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe("sid");
	});

	it("auto-picks a default-release profile when no profile is specified", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const homeDir = path.join(dir, "home");
		const profilesRoot = stubFirefoxProfilesRoot(homeDir);
		const defaultRelease = path.join(profilesRoot, "abc.default-release");
		const other = path.join(profilesRoot, "xyz.default");
		mkdirSync(defaultRelease, { recursive: true });
		mkdirSync(other, { recursive: true });
		writeFileSync(path.join(defaultRelease, "cookies.sqlite"), "", "utf8");
		writeFileSync(path.join(other, "cookies.sqlite"), "", "utf8");

		nodeSqlite.rows = [
			{
				name: "sid",
				value: "value",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
	});

	it("handles unreadable profile roots gracefully", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const homeDir = path.join(dir, "home");
		const profilesRoot = stubFirefoxProfilesRoot(homeDir);

		mkdirSync(path.dirname(profilesRoot), { recursive: true });
		writeFileSync(profilesRoot, "not a dir", "utf8");

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toEqual([]);
		expect(res.warnings.join("\n")).toContain("Firefox cookies database not found");
	});

	it("filters by allowlist", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const dbDir = path.join(dir, "profile");

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, "cookies.sqlite"), "", "utf8");
		nodeSqlite.rows = [
			{
				name: "a",
				value: "1",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
			{
				name: "b",
				value: "2",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			["https://chatgpt.com/"],
			new Set(["b"]),
		);

		expect(res.cookies.map((c) => c.name)).toEqual(["b"]);
	});

	it("returns a warning when the database is missing", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));

		const res = await getCookiesFromFirefox(
			{ profile: path.join(dir, "missing-profile"), includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join("\n")).toContain("Firefox cookies database not found");
	});

	it("returns a warning when node:sqlite fails", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const dbDir = path.join(dir, "profile");

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, "cookies.sqlite"), "", "utf8");
		nodeSqlite.shouldThrow = true;

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join("\n")).toContain("node:sqlite failed reading Firefox cookies");
	});
});

const describeIfLinux = process.platform === "linux" ? describe : describe.skip;
const sampleRow: SqliteRow = {
	name: "sid",
	value: "value",
	host: ".chatgpt.com",
	path: "/",
	expiry: 9999999999,
	isSecure: 1,
	isHttpOnly: 1,
	sameSite: 2,
};

describeIfLinux("firefox sqlite provider (Linux XDG profile roots, issue #26)", () => {
	beforeEach(() => {
		nodeSqlite.rows = [sampleRow];
		nodeSqlite.shouldThrow = false;
	});

	it("resolves profiles at $XDG_CONFIG_HOME/mozilla/firefox when set", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		const profileDir = path.join(xdgConfigHome, "mozilla", "firefox", "abc.default-release");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe("sid");
	});

	it("resolves profiles at ~/.config/mozilla/firefox when XDG_CONFIG_HOME is unset", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const profileDir = path.join(homeDir, ".config", "mozilla", "firefox", "abc.default-release");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", undefined);

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe("sid");
	});

	it("treats an empty XDG_CONFIG_HOME as unset", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const profileDir = path.join(homeDir, ".config", "mozilla", "firefox", "abc.default-release");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", "");

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
	});

	it("ignores a relative XDG_CONFIG_HOME per the XDG spec", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		// Profile sits at the spec-default ~/.config root; the bogus relative
		// XDG_CONFIG_HOME below must not redirect lookup to a cwd-relative path.
		const profileDir = path.join(homeDir, ".config", "mozilla", "firefox", "abc.default-release");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", "relative/path");

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
	});

	it("falls back to the legacy ~/.mozilla/firefox path when no XDG profile exists", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		// Pre-Firefox-147 layout: profile only at ~/.mozilla/firefox.
		const legacyProfileDir = path.join(homeDir, ".mozilla", "firefox", "abc.default-release");
		mkdirSync(legacyProfileDir, { recursive: true });
		writeFileSync(path.join(legacyProfileDir, "cookies.sqlite"), "", "utf8");
		// XDG root is a real directory but contains no Firefox subtree.
		mkdirSync(xdgConfigHome, { recursive: true });
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
	});

	it("resolves a named profile at the XDG root", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		const profileName = "abc.default-release";
		const profileDir = path.join(xdgConfigHome, "mozilla", "firefox", profileName);
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const res = await getCookiesFromFirefox(
			{ profile: profileName, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
	});

	it("resolves a named profile at the legacy root when only legacy is populated", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		const profileName = "abc.default-release";
		const profileDir = path.join(homeDir, ".mozilla", "firefox", profileName);
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		mkdirSync(xdgConfigHome, { recursive: true });
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const res = await getCookiesFromFirefox(
			{ profile: profileName, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
	});

	it("returns no cookies when neither root has a Firefox profile", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(xdgConfigHome, { recursive: true });
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join("\n")).toContain("Firefox cookies database not found");
	});
});
