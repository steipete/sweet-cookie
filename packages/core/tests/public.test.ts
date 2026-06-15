import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const itIfDarwin = process.platform === "darwin" ? it : it.skip;

type SqliteRow = Record<string, unknown>;
type CaptureState = { lastOptions: unknown };
type NodeSqliteState = { rows: SqliteRow[]; shouldThrow: boolean };

function buildInlinePayload(): string {
	return JSON.stringify({
		cookies: [{ name: "inline", value: "1", domain: "chatgpt.com", path: "/" }],
	});
}

const edgeCapture = vi.hoisted<CaptureState>(() => ({ lastOptions: null }));
const chromeCapture = vi.hoisted<CaptureState>(() => ({ lastOptions: null }));
const safariCapture = vi.hoisted<CaptureState>(() => ({ lastOptions: null }));
const nodeSqlite = vi.hoisted<NodeSqliteState>(() => ({ rows: [], shouldThrow: false }));
const allChromiumProfilesSymbol = vi.hoisted(() => Symbol("test.ALL_CHROMIUM_PROFILES"));

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

describe("public API", () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		nodeSqlite.rows = [];
		nodeSqlite.shouldThrow = false;
		edgeCapture.lastOptions = null;
		chromeCapture.lastOptions = null;
		safariCapture.lastOptions = null;
	});

	it("returns inline cookies first (and filters by name)", async () => {
		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			names: ["inline"],
			inlineCookiesJson: buildInlinePayload(),
			browsers: ["chrome", "firefox", "safari"],
		});
		expect(res.cookies.map((c) => c.name)).toEqual(["inline"]);
	});

	it("tries inline sources in order until one yields cookies", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-public-inline-"));
		const inlineFile = path.join(dir, "cookies.json");
		writeFileSync(inlineFile, buildInlinePayload(), "utf8");

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			inlineCookiesJson: JSON.stringify({ cookies: [] }),
			inlineCookiesBase64: Buffer.from(buildInlinePayload(), "utf8").toString("base64"),
			inlineCookiesFile: inlineFile,
			browsers: ["chrome"],
		});

		expect(res.cookies.map((c) => c.name)).toEqual(["inline"]);
	});

	it("fails closed when the target URL has no filterable origin", async () => {
		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "file:///etc/hosts",
			inlineCookiesJson: buildInlinePayload(),
			browsers: ["chrome"],
		});

		expect(res).toEqual({ cookies: [], warnings: [] });
	});

	it("respects SWEET_COOKIE_BROWSERS env when browsers are not provided", async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-public-env-"));
		const firefoxDir = path.join(dir, "ff");
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, "cookies.sqlite"), "", "utf8");

		nodeSqlite.rows = [
			{
				name: "firefox",
				value: "f",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async () => ({
				cookies: [{ name: "chrome", value: "c", domain: "chatgpt.com", path: "/", secure: true }],
				warnings: [],
			}),
		}));

		vi.stubEnv("SWEET_COOKIE_BROWSERS", "firefox, chrome");
		vi.stubEnv("SWEET_COOKIE_MODE", "merge");

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name).sort()).toEqual(["chrome", "firefox"]);
	});

	it("ignores unknown tokens in SWEET_COOKIE_BROWSERS and invalid SWEET_COOKIE_MODE", async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-public-env-"));
		const firefoxDir = path.join(dir, "ff");
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, "cookies.sqlite"), "", "utf8");

		nodeSqlite.rows = [
			{
				name: "firefox",
				value: "f",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		vi.stubEnv("SWEET_COOKIE_BROWSERS", "firefox, nope");
		vi.stubEnv("SWEET_COOKIE_MODE", "nope");

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(["firefox"]);
	});

	it("supports edge backend and uses SWEET_COOKIE_EDGE_PROFILE", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/edge.js", () => ({
			getCookiesFromEdge: async (options: unknown) => {
				edgeCapture.lastOptions = options;
				return {
					cookies: [{ name: "edge", value: "e", domain: "chatgpt.com", path: "/", secure: true }],
					warnings: [],
				};
			},
		}));

		vi.stubEnv("SWEET_COOKIE_BROWSERS", "edge");
		vi.stubEnv("SWEET_COOKIE_EDGE_PROFILE", "Default");

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(["edge"]);
		expect(edgeCapture.lastOptions).toMatchObject({ profile: "Default" });
	});

	it("supports SWEET_COOKIE_SOURCES and falls back to SWEET_COOKIE_CHROME_PROFILE for edge", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/edge.js", () => ({
			getCookiesFromEdge: async (options: unknown) => {
				edgeCapture.lastOptions = options;
				return {
					cookies: [{ name: "edge", value: "e", domain: "chatgpt.com", path: "/", secure: true }],
					warnings: [],
				};
			},
		}));

		vi.stubEnv("SWEET_COOKIE_SOURCES", "edge");
		vi.stubEnv("SWEET_COOKIE_CHROME_PROFILE", "Profile 7");

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(["edge"]);
		expect(edgeCapture.lastOptions).toMatchObject({ profile: "Profile 7" });
	});

	it("passes chromiumBrowser through to the chrome provider", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async (options: unknown) => {
				chromeCapture.lastOptions = options;
				return {
					cookies: [{ name: "chrome", value: "c", domain: "chatgpt.com", path: "/", secure: true }],
					warnings: [],
				};
			},
		}));

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome"],
			chromiumBrowser: "arc",
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(["chrome"]);
		expect(chromeCapture.lastOptions).toMatchObject({ chromiumBrowser: "arc" });
	});

	it("reads every selected Chrome profile as one backend result", async () => {
		vi.resetModules();

		const seenProfiles: unknown[] = [];
		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async (options: { profile?: string }) => {
				seenProfiles.push(options.profile);
				return {
					cookies: [
						{
							name: options.profile === "Work" ? "work" : "personal",
							value: "1",
							domain: "chatgpt.com",
							path: "/",
							secure: true,
						},
					],
					warnings: [],
				};
			},
		}));

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome"],
			chromeProfile: ["Personal", "Work"],
			includeExpired: true,
		});

		expect(seenProfiles).toEqual(["Personal", "Work"]);
		expect(res.cookies.map((c) => c.name).sort()).toEqual(["personal", "work"]);
	});

	it("keeps same-name cookies from different selected profiles", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async (options: { profile?: string }) => ({
				cookies: [
					{
						name: "sid",
						value: options.profile === "Work" ? "work-value" : "personal-value",
						domain: "chatgpt.com",
						path: "/",
						source: { browser: "chrome", profile: options.profile },
					},
				],
				warnings: [],
			}),
		}));

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome"],
			chromeProfile: ["Personal", "Work"],
		});

		expect(res.cookies.map((c) => c.value).sort()).toEqual(["personal-value", "work-value"]);
	});

	it("keeps same-name cookies from different Chromium roots for one selected profile", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async () => ({
				cookies: [
					{
						name: "sid",
						value: "chrome-default",
						domain: "chatgpt.com",
						path: "/",
						source: { browser: "chrome", profile: "Default", storeId: "chrome" },
					},
					{
						name: "sid",
						value: "brave-default",
						domain: "chatgpt.com",
						path: "/",
						source: { browser: "chrome", profile: "Default", storeId: "brave" },
					},
				],
				warnings: [],
			}),
		}));

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome"],
			chromeProfile: "Default",
		});

		expect(res.cookies.map((c) => c.value).sort()).toEqual(["brave-default", "chrome-default"]);
	});

	it("uses ALL_PROFILES as the explicit all-profile selector", async () => {
		vi.resetModules();

		const seenProfiles: unknown[] = [];
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			ALL_CHROMIUM_PROFILES: allChromiumProfilesSymbol,
		}));
		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async (options: { profile?: unknown }) => {
				seenProfiles.push(options.profile);
				return {
					cookies: [
						{
							name:
								options.profile === allChromiumProfilesSymbol ? "auto" : String(options.profile),
							value: "1",
							domain: "chatgpt.com",
							path: "/",
						},
					],
					warnings: [],
				};
			},
		}));

		const { ALL_PROFILES, getCookies } = await import("../src/index.js");
		const stringifiedAllProfiles = String(ALL_PROFILES);
		await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome"],
			chromeProfile: stringifiedAllProfiles,
		});
		await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome"],
			chromeProfile: ALL_PROFILES,
		});

		expect(seenProfiles).toEqual([stringifiedAllProfiles, allChromiumProfilesSymbol]);
	});

	it("keeps all-profile cookies from different Chromium roots with the same profile name", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/chromium/paths.js", () => ({
			ALL_CHROMIUM_PROFILES: allChromiumProfilesSymbol,
		}));
		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async () => ({
				cookies: [
					{
						name: "sid",
						value: "chrome-value",
						domain: "chatgpt.com",
						path: "/",
						source: { browser: "chrome", profile: "Default", storeId: "chrome" },
					},
					{
						name: "sid",
						value: "brave-value",
						domain: "chatgpt.com",
						path: "/",
						source: { browser: "chrome", profile: "Default", storeId: "brave" },
					},
				],
				warnings: [],
			}),
		}));

		const { ALL_PROFILES, getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome"],
			chromeProfile: ALL_PROFILES,
		});

		expect(res.cookies.map((c) => c.value).sort()).toEqual(["brave-value", "chrome-value"]);
	});

	it("passes Safari-specific options through to the safari provider", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/safariBinaryCookies.js", () => ({
			getCookiesFromSafari: async (options: unknown) => {
				safariCapture.lastOptions = options;
				return {
					cookies: [{ name: "safari", value: "s", domain: "chatgpt.com", path: "/" }],
					warnings: [],
				};
			},
		}));

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["safari"],
			includeExpired: true,
			safariCookiesFile: "/tmp/Cookies.binarycookies",
		});

		expect(res.cookies.map((c) => c.name)).toEqual(["safari"]);
		expect(safariCapture.lastOptions).toMatchObject({
			file: "/tmp/Cookies.binarycookies",
			includeExpired: true,
		});
	});

	itIfDarwin("merges browser sources and dedupes by name+domain+path", async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-public-"));

		const firefoxDir = path.join(dir, "ff");
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, "cookies.sqlite"), "", "utf8");

		nodeSqlite.rows = [
			{
				name: "dup",
				value: "x",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
			{
				name: "firefox",
				value: "f",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async () => ({
				cookies: [
					{
						name: "dup",
						value: "x",
						domain: "chatgpt.com",
						path: "/",
						secure: true,
						source: { browser: "chrome", storeId: "chrome" },
					},
					{ name: "chrome", value: "c", domain: "chatgpt.com", path: "/", secure: true },
				],
				warnings: [],
			}),
		}));

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome", "firefox"],
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name).sort()).toEqual(["chrome", "dup", "firefox"]);
	});

	it("preserves multi-profile cookies without re-adding lower-priority browser duplicates", async () => {
		vi.resetModules();

		vi.doMock("../src/providers/chrome.js", () => ({
			getCookiesFromChrome: async (options: { profile?: string }) => ({
				cookies: [
					{
						name: "sid",
						value: options.profile === "Work" ? "work" : "personal",
						domain: "chatgpt.com",
						path: "/",
						source: { browser: "chrome", profile: options.profile },
					},
				],
				warnings: [],
			}),
		}));
		vi.doMock("../src/providers/safariBinaryCookies.js", () => ({
			getCookiesFromSafari: async () => ({
				cookies: [
					{
						name: "sid",
						value: "safari",
						domain: "chatgpt.com",
						path: "/",
						source: { browser: "safari" },
					},
				],
				warnings: [],
			}),
		}));

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			browsers: ["chrome", "safari"],
			chromeProfile: ["Personal", "Work"],
		});

		expect(res.cookies.map((cookie) => cookie.value).sort()).toEqual(["personal", "work"]);
	});

	it("mode=first returns the first non-empty browser result", async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-public-first-"));
		const firefoxDir = path.join(dir, "ff");
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, "cookies.sqlite"), "", "utf8");

		nodeSqlite.rows = [
			{
				name: "only",
				value: "f",
				host: ".chatgpt.com",
				path: "/",
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		const { getCookies } = await import("../src/index.js");
		const res = await getCookies({
			url: "https://chatgpt.com/",
			mode: "first",
			browsers: ["firefox", "chrome"],
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(["only"]);
	});

	it("toCookieHeader() sorts and can dedupe by name", async () => {
		const { toCookieHeader } = await import("../src/index.js");
		const header = toCookieHeader(
			[
				{ name: "b", value: "2" },
				{ name: "a", value: "1" },
				{ name: "a", value: "ignored" },
			],
			{ dedupeByName: true },
		);
		expect(header).toBe("a=1; b=2");
	});

	it("toCookieHeader() can preserve order", async () => {
		const { toCookieHeader } = await import("../src/index.js");
		const header = toCookieHeader(
			[
				{ name: "b", value: "2" },
				{ name: "a", value: "1" },
			],
			{ sort: "none" },
		);
		expect(header).toBe("b=2; a=1");
	});
});
