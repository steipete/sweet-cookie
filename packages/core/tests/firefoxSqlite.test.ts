import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALL_PROFILES } from "../src/index.js";
import { getCookiesFromFirefox } from "../src/providers/firefoxSqlite.js";

type SqliteRow = Record<string, unknown>;
type NodeSqliteState = {
	rows: SqliteRow[];
	columns: string[];
	shouldThrow: boolean;
	openCount: number;
	lastSql: string;
};

function stubFirefoxProfilesRoot(homeDir: string): string {
	if (process.platform === "darwin") {
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("USERPROFILE", homeDir);
		return path.join(homeDir, "Library", "Application Support", "Firefox", "Profiles");
	}

	if (process.platform === "linux") {
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("USERPROFILE", homeDir);
		return path.join(homeDir, ".mozilla", "firefox");
	}

	if (process.platform === "win32") {
		const appData = path.join(homeDir, "AppData", "Roaming");
		vi.stubEnv("APPDATA", appData);
		return path.join(appData, "Mozilla", "Firefox", "Profiles");
	}

	throw new Error(`Unsupported platform: ${process.platform}`);
}

const nodeSqlite = vi.hoisted<NodeSqliteState>(() => ({
	rows: [],
	columns: ["originAttributes", "isPartitionedAttributeSet"],
	shouldThrow: false,
	openCount: 0,
	lastSql: "",
}));

vi.mock("node:sqlite", () => {
	class DatabaseSync {
		constructor(_path: string, _options?: unknown) {
			nodeSqlite.openCount++;
			if (nodeSqlite.shouldThrow) {
				throw new Error("boom");
			}
		}

		prepare(sql: string) {
			nodeSqlite.lastSql = sql;
			return {
				all: () =>
					sql === "PRAGMA table_info(moz_cookies);"
						? nodeSqlite.columns.map((name) => ({ name }))
						: nodeSqlite.rows,
			};
		}

		close() {}
	}

	return { DatabaseSync };
});

describe("firefox sqlite provider", () => {
	beforeEach(() => {
		nodeSqlite.rows = [];
		nodeSqlite.columns = ["originAttributes", "isPartitionedAttributeSet"];
		nodeSqlite.shouldThrow = false;
		nodeSqlite.openCount = 0;
		nodeSqlite.lastSql = "";
	});

	it("preserves host scope and excludes partitioned or container-scoped cookies", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const dbDir = path.join(dir, "profile");

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, "cookies.sqlite"), "", "utf8");
		nodeSqlite.rows = [
			{
				name: "sid",
				value: "host-value",
				host: "chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
				originAttributes: "",
				isPartitionedAttributeSet: 0,
			},
			{
				name: "sid",
				value: "domain-value",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
				originAttributes: "",
				isPartitionedAttributeSet: 0,
			},
			{
				name: "container",
				value: "container-value",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
				originAttributes: "^userContextId=2",
				isPartitionedAttributeSet: 0,
			},
			{
				name: "partitioned",
				value: "partitioned-value",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
				originAttributes: "",
				isPartitionedAttributeSet: 1,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(nodeSqlite.lastSql).toContain("originAttributes, isPartitionedAttributeSet");
		expect(res.cookies.map(({ value, hostOnly }) => ({ value, hostOnly }))).toEqual([
			{ value: "host-value", hostOnly: true },
			{ value: "domain-value", hostOnly: false },
		]);
		expect(res.warnings).toEqual([
			"2 partitioned or container-scoped Firefox cookie(s) were excluded because replay cannot preserve their origin attributes.",
		]);

		const subdomainRes = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			["https://sub.chatgpt.com/"],
			null,
		);
		expect(subdomainRes.cookies.map(({ value, hostOnly }) => ({ value, hostOnly }))).toEqual([
			{ value: "domain-value", hostOnly: false },
		]);
	});

	it("reads ordinary cookies when isolation-provenance columns are absent", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-"));
		const dbDir = path.join(dir, "profile");

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, "cookies.sqlite"), "", "utf8");
		nodeSqlite.columns = ["name", "value", "host", "path"];
		nodeSqlite.rows = [
			{
				name: "sid",
				value: "value",
				host: "example.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			["https://example.com/"],
			null,
		);

		expect(nodeSqlite.lastSql).toContain("'' AS originAttributes");
		expect(nodeSqlite.lastSql).toContain("0 AS isPartitionedAttributeSet");
		expect(res.cookies).toEqual([
			expect.objectContaining({ name: "sid", value: "value", hostOnly: true }),
		]);
		expect(res.warnings).toEqual([]);
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
		expect(res.cookies[0]?.source?.profile).toBe("abc.default-release");
	});

	it("reads every Firefox profile when ALL_PROFILES is specified", async () => {
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
			{ profile: ALL_PROFILES, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(
			res.cookies
				.map((cookie) => cookie.source?.profile)
				.sort((a, b) => String(a).localeCompare(String(b))),
		).toEqual(["abc.default-release", "xyz.default"]);
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

const actualPlatform = process.platform;
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

const containerProfileRoots = [
	{
		layout: "Snap",
		root: (home: string) => path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
	},
	{
		layout: "Flatpak legacy",
		root: (home: string) =>
			path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
	},
	{
		layout: "Flatpak XDG",
		root: (home: string) =>
			path.join(home, ".var", "app", "org.mozilla.firefox", "config", "mozilla", "firefox"),
	},
];

describe("firefox sqlite provider (Linux profile roots, issue #26)", () => {
	beforeEach(() => {
		Object.defineProperty(process, "platform", { value: "linux" });
		nodeSqlite.rows = [sampleRow];
		nodeSqlite.columns = ["originAttributes", "isPartitionedAttributeSet"];
		nodeSqlite.shouldThrow = false;
		nodeSqlite.openCount = 0;
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: actualPlatform });
		vi.unstubAllEnvs();
	});

	it.each(containerProfileRoots)(
		"resolves a default profile from the $layout root",
		async ({ root }) => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-container-"));
			const homeDir = path.join(dir, "home");
			const profileDir = path.join(root(homeDir), "abc.default-release");
			mkdirSync(profileDir, { recursive: true });
			writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
			vi.stubEnv("HOME", homeDir);
			vi.stubEnv("USERPROFILE", homeDir);
			vi.stubEnv("XDG_CONFIG_HOME", path.join(dir, "xdg-config"));

			const res = await getCookiesFromFirefox(
				{ includeExpired: true },
				["https://chatgpt.com/"],
				null,
			);

			expect(res.cookies[0]?.source?.profile).toBe("abc.default-release");
		},
	);

	it("skips non-profile directories before selecting a Snap default", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-container-"));
		const homeDir = path.join(dir, "home");
		const snapRoot = path.join(homeDir, "snap", "firefox", "common", ".mozilla", "firefox");
		const profileName = "rvwkamqb.default";
		const profileDir = path.join(snapRoot, profileName);
		mkdirSync(path.join(snapRoot, "Crash Reports"), { recursive: true });
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("USERPROFILE", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", path.join(dir, "xdg-config"));

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.source?.profile).toBe(profileName);
		expect(res.warnings).toEqual([]);
	});

	it("reads profiles across every native and container root with ALL_PROFILES", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-all-linux-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("USERPROFILE", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const roots = [
			path.join(xdgConfigHome, "mozilla", "firefox"),
			path.join(homeDir, ".mozilla", "firefox"),
			...containerProfileRoots.map(({ root }) => root(homeDir)),
		];
		const profiles = roots.map((root, index) => {
			const profile = `profile-${index}.default-release`;
			const profileDir = path.join(root, profile);
			mkdirSync(profileDir, { recursive: true });
			writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
			return profile;
		});

		const res = await getCookiesFromFirefox(
			{ profile: ALL_PROFILES, includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies.map((cookie) => cookie.source?.profile)).toEqual(profiles);
	});

	it("resolves profiles at $XDG_CONFIG_HOME/mozilla/firefox when set", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		const profileDir = path.join(xdgConfigHome, "mozilla", "firefox", "abc.default-release");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("USERPROFILE", homeDir);
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
		vi.stubEnv("USERPROFILE", homeDir);
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
		vi.stubEnv("USERPROFILE", homeDir);
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
		vi.stubEnv("USERPROFILE", homeDir);
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
		vi.stubEnv("USERPROFILE", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
	});

	it("uses only the first default profile root unless ALL_PROFILES is requested", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-firefox-xdg-"));
		const homeDir = path.join(dir, "home");
		const xdgConfigHome = path.join(dir, "xdg-config");
		const xdgProfileDir = path.join(xdgConfigHome, "mozilla", "firefox", "abc.default-release");
		const legacyProfileDir = path.join(homeDir, ".mozilla", "firefox", "legacy.default-release");
		mkdirSync(xdgProfileDir, { recursive: true });
		mkdirSync(legacyProfileDir, { recursive: true });
		writeFileSync(path.join(xdgProfileDir, "cookies.sqlite"), "", "utf8");
		writeFileSync(path.join(legacyProfileDir, "cookies.sqlite"), "", "utf8");
		vi.stubEnv("HOME", homeDir);
		vi.stubEnv("USERPROFILE", homeDir);
		vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.source?.profile).toBe("abc.default-release");
		// One selected profile is inspected for capabilities and then queried.
		expect(nodeSqlite.openCount).toBe(2);
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
		vi.stubEnv("USERPROFILE", homeDir);
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
		vi.stubEnv("USERPROFILE", homeDir);
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
		vi.stubEnv("USERPROFILE", homeDir);
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
