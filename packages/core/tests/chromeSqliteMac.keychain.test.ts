import { describe, expect, it, vi } from 'vitest';

describe('chrome sqlite (mac) keychain selection', () => {
	it('passes timeoutMs through to the Keychain lookup', async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: 'pw' });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });

		vi.doMock('../src/providers/chromium/macosKeychain.js', () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock('../src/providers/chromium/paths.js', () => ({
			resolveCookiesDbFromProfileOrRoots: () =>
				'/Users/test/Library/Application Support/Google/Chrome/Default/Cookies',
		}));
		vi.doMock('../src/providers/chromeSqlite/shared.js', () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock('../src/providers/chromeSqlite/crypto.js', () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import('../src/providers/chromeSqliteMac.js');

		await getCookiesFromChromeSqliteMac(
			{ profile: 'Default', timeoutMs: 1234 },
			['https://example.com'],
			null
		);

		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: 'Chrome',
				services: ['Chrome Safe Storage'],
				label: 'Chrome Safe Storage',
				timeoutMs: 1234,
			})
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	it('uses the default Keychain timeout when timeoutMs is omitted', async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: 'pw' });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });

		vi.doMock('../src/providers/chromium/macosKeychain.js', () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock('../src/providers/chromium/paths.js', () => ({
			resolveCookiesDbFromProfileOrRoots: () =>
				'/Users/test/Library/Application Support/Google/Chrome/Default/Cookies',
		}));
		vi.doMock('../src/providers/chromeSqlite/shared.js', () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock('../src/providers/chromeSqlite/crypto.js', () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import('../src/providers/chromeSqliteMac.js');

		await getCookiesFromChromeSqliteMac({ profile: 'Default' }, ['https://example.com'], null);

		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: 'Chrome',
				services: ['Chrome Safe Storage'],
				label: 'Chrome Safe Storage',
				timeoutMs: 3000,
			})
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	it('uses the Brave keychain entry when the DB path points at Brave', async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: 'pw' });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });

		vi.doMock('../src/providers/chromium/macosKeychain.js', () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock('../src/providers/chromium/paths.js', () => ({
			resolveCookiesDbFromProfileOrRoots: () =>
				'/Users/test/Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies',
		}));
		vi.doMock('../src/providers/chromeSqlite/shared.js', () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock('../src/providers/chromeSqlite/crypto.js', () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import('../src/providers/chromeSqliteMac.js');

		await getCookiesFromChromeSqliteMac({ profile: 'Default' }, ['https://example.com'], null);

		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: 'Brave',
				services: ['Brave Safe Storage'],
				label: 'Brave Safe Storage',
			})
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	it('searches only the targeted Chromium root when chromiumBrowser is set', async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: 'pw' });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });
		const resolveCookiesDbFromProfileOrRoots = vi
			.fn()
			.mockReturnValue('/Users/test/Library/Application Support/Arc/User Data/Default/Cookies');

		vi.doMock('../src/providers/chromium/macosKeychain.js', () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock('../src/providers/chromium/paths.js', () => ({
			resolveCookiesDbFromProfileOrRoots,
		}));
		vi.doMock('../src/providers/chromeSqlite/shared.js', () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock('../src/providers/chromeSqlite/crypto.js', () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import('../src/providers/chromeSqliteMac.js');

		await getCookiesFromChromeSqliteMac(
			{ profile: 'Default', chromiumBrowser: 'arc' },
			['https://example.com'],
			null
		);

		expect(resolveCookiesDbFromProfileOrRoots).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: 'Default',
				roots: [expect.stringContaining('/Library/Application Support/Arc/User Data')],
			})
		);
		expect(readKeychainGenericPasswordFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				account: 'Arc',
				services: ['Arc Safe Storage'],
				label: 'Arc Safe Storage',
			})
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});

	it('defaults to Chrome and Brave roots when chromiumBrowser is omitted', async () => {
		vi.resetModules();

		const readKeychainGenericPasswordFirst = vi
			.fn()
			.mockResolvedValue({ ok: true, password: 'pw' });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });
		const resolveCookiesDbFromProfileOrRoots = vi
			.fn()
			.mockReturnValue('/Users/test/Library/Application Support/Google/Chrome/Default/Cookies');

		vi.doMock('../src/providers/chromium/macosKeychain.js', () => ({
			readKeychainGenericPasswordFirst,
		}));
		vi.doMock('../src/providers/chromium/paths.js', () => ({
			resolveCookiesDbFromProfileOrRoots,
		}));
		vi.doMock('../src/providers/chromeSqlite/shared.js', () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock('../src/providers/chromeSqlite/crypto.js', () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteMac } = await import('../src/providers/chromeSqliteMac.js');

		await getCookiesFromChromeSqliteMac({ profile: 'Default' }, ['https://example.com'], null);

		expect(resolveCookiesDbFromProfileOrRoots).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: 'Default',
				roots: [
					expect.stringContaining('/Library/Application Support/Google/Chrome'),
					expect.stringContaining('/Library/Application Support/BraveSoftware/Brave-Browser'),
				],
			})
		);
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});
});
