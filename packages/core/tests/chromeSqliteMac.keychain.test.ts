import { describe, expect, it, vi } from "vitest";

const itIfDarwin = process.platform === "darwin" ? it : it.skip;

describe("chrome sqlite (mac) keychain selection", () => {
	it("binds every generic custom profile path to its explicit Chromium browser", async () => {
		vi.resetModules();
		const { resolveKeychainForDb } = await import("../src/providers/chromeSqliteMac.js");

		const expected = {
			chrome: {
				account: "Chrome",
				services: ["Chrome Safe Storage"],
				label: "Chrome Safe Storage",
			},
			brave: {
				account: "Brave",
				services: ["Brave Safe Storage"],
				label: "Brave Safe Storage",
			},
			arc: {
				account: "Arc",
				services: ["Arc Safe Storage"],
				label: "Arc Safe Storage",
			},
			chromium: {
				account: "Chromium",
				services: ["Chromium Safe Storage"],
				label: "Chromium Safe Storage",
			},
		} as const;

		for (const browser of Object.keys(expected) as (keyof typeof expected)[]) {
			expect(
				resolveKeychainForDb(`/private/custom-profile-${browser}/Default/Cookies`, browser),
			).toEqual(expected[browser]);
		}
	});

	it("passes timeoutMs through to the Keychain lookup", async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: "pw" });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });

		vi.doMock("../src/providers/chromium/macosKeychain.js", () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			resolveCookiesDbsFromProfileOrRoots: () => [
				{
					dbPath: "/Users/test/Library/Application Support/Google/Chrome/Default/Cookies",
					profile: "Default",
				},
			],
		}));
		vi.doMock("../src/providers/chromeSqlite/shared.js", () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock("../src/providers/chromeSqlite/crypto.js", () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import("../src/providers/chromeSqliteMac.js");

		await getCookiesFromChromeSqliteMac(
			{ profile: "Default", timeoutMs: 1234 },
			["https://example.com"],
			null,
		);

		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: "Chrome",
				services: ["Chrome Safe Storage"],
				label: "Chrome Safe Storage",
				timeoutMs: 1234,
			}),
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	it("uses the default Keychain timeout when timeoutMs is omitted", async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: "pw" });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });

		vi.doMock("../src/providers/chromium/macosKeychain.js", () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			resolveCookiesDbsFromProfileOrRoots: () => [
				{
					dbPath: "/Users/test/Library/Application Support/Google/Chrome/Default/Cookies",
					profile: "Default",
				},
			],
		}));
		vi.doMock("../src/providers/chromeSqlite/shared.js", () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock("../src/providers/chromeSqlite/crypto.js", () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import("../src/providers/chromeSqliteMac.js");

		await getCookiesFromChromeSqliteMac({ profile: "Default" }, ["https://example.com"], null);

		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: "Chrome",
				services: ["Chrome Safe Storage"],
				label: "Chrome Safe Storage",
				timeoutMs: 3000,
			}),
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	it("uses the Brave keychain entry when the DB path points at Brave", async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: "pw" });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });

		vi.doMock("../src/providers/chromium/macosKeychain.js", () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			resolveCookiesDbsFromProfileOrRoots: () => [
				{
					dbPath:
						"/Users/test/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies",
					profile: "Default",
				},
			],
		}));
		vi.doMock("../src/providers/chromeSqlite/shared.js", () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock("../src/providers/chromeSqlite/crypto.js", () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import("../src/providers/chromeSqliteMac.js");

		await getCookiesFromChromeSqliteMac({ profile: "Default" }, ["https://example.com"], null);

		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: "Brave",
				services: ["Brave Safe Storage"],
				label: "Brave Safe Storage",
			}),
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	itIfDarwin("binds the targeted Chromium root and Keychain for a custom path", async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: "pw" });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });
		const resolveCookiesDbsFromProfileOrRoots = vi.fn().mockReturnValue([
			{
				dbPath: "/private/custom-profile/Default/Cookies",
				profile: "Default",
			},
		]);

		vi.doMock("../src/providers/chromium/macosKeychain.js", () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			resolveCookiesDbsFromProfileOrRoots,
		}));
		vi.doMock("../src/providers/chromeSqlite/shared.js", () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock("../src/providers/chromeSqlite/crypto.js", () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import("../src/providers/chromeSqliteMac.js");

		await getCookiesFromChromeSqliteMac(
			{ profile: "Default", chromiumBrowser: "arc" },
			["https://example.com"],
			null,
		);

		expect(resolveCookiesDbsFromProfileOrRoots).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: "Default",
				roots: [expect.stringContaining("/Library/Application Support/Arc/User Data")],
			}),
		);
		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: "Arc",
				services: ["Arc Safe Storage"],
				label: "Arc Safe Storage",
			}),
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	itIfDarwin("searches the Dia root and keychain when chromiumBrowser is dia", async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: "pw" });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });
		const resolveCookiesDbsFromProfileOrRoots = vi.fn().mockReturnValue([
			{
				dbPath: "/Users/test/Library/Application Support/Dia/User Data/Default/Cookies",
				profile: "Default",
			},
		]);

		vi.doMock("../src/providers/chromium/macosKeychain.js", () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			resolveCookiesDbsFromProfileOrRoots,
		}));
		vi.doMock("../src/providers/chromeSqlite/shared.js", () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock("../src/providers/chromeSqlite/crypto.js", () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import("../src/providers/chromeSqliteMac.js");

		await getCookiesFromChromeSqliteMac(
			{ profile: "Default", chromiumBrowser: "dia" },
			["https://example.com"],
			null,
		);

		expect(resolveCookiesDbsFromProfileOrRoots).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: "Default",
				roots: [expect.stringContaining("/Library/Application Support/Dia/User Data")],
			}),
		);
		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: "Dia",
				services: ["Dia Safe Storage"],
				label: "Dia Safe Storage",
			}),
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	itIfDarwin("defaults to Chrome and Brave roots when chromiumBrowser is omitted", async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: "pw" });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });
		const resolveCookiesDbsFromProfileOrRoots = vi.fn().mockReturnValue([
			{
				dbPath: "/Users/test/Library/Application Support/Google/Chrome/Default/Cookies",
				profile: "Default",
			},
		]);

		vi.doMock("../src/providers/chromium/macosKeychain.js", () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			resolveCookiesDbsFromProfileOrRoots,
		}));
		vi.doMock("../src/providers/chromeSqlite/shared.js", () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock("../src/providers/chromeSqlite/crypto.js", () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import("../src/providers/chromeSqliteMac.js");

		await getCookiesFromChromeSqliteMac({ profile: "Default" }, ["https://example.com"], null);

		expect(resolveCookiesDbsFromProfileOrRoots).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: "Default",
				roots: [
					expect.stringContaining("/Library/Application Support/Google/Chrome"),
					expect.stringContaining("/Library/Application Support/BraveSoftware/Brave-Browser"),
				],
			}),
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	itIfDarwin("preserves permission warnings alongside readable Chromium results", async () => {
		vi.resetModules();

		const warning =
			"Permission denied reading Chromium profile data at /Users/test/Library/Application Support/BraveSoftware/Brave-Browser.";
		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: "pw" });
		const cookie = {
			name: "sid",
			value: "value",
			domain: "example.com",
			path: "/",
		};
		const getCookiesFromChromeSqliteDb = vi
			.fn()
			.mockResolvedValue({ cookies: [cookie], warnings: [] });
		const resolveCookiesDbsFromProfileOrRoots = vi.fn(
			(options: { onWarning?: (message: string) => void }) => {
				options.onWarning?.(warning);
				return [
					{
						dbPath: "/Users/test/Library/Application Support/Google/Chrome/Default/Cookies",
						profile: "Default",
					},
				];
			},
		);

		vi.doMock("../src/providers/chromium/macosKeychain.js", () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock("../src/providers/chromium/paths.js", () => ({
			resolveCookiesDbsFromProfileOrRoots,
		}));
		vi.doMock("../src/providers/chromeSqlite/shared.js", () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock("../src/providers/chromeSqlite/crypto.js", () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import("../src/providers/chromeSqliteMac.js");
		const result = await getCookiesFromChromeSqliteMac(
			{ profile: "Default" },
			["https://example.com"],
			null,
		);

		expect(result).toEqual({ cookies: [cookie], warnings: [warning] });
	});
});
