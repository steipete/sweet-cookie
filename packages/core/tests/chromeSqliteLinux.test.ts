import { describe, expect, it, vi } from 'vitest';

describe('chrome sqlite (linux) provider', () => {
	it('uses the Brave safe storage helper when the DB path points at Brave', async () => {
		vi.resetModules();

		const getLinuxBraveSafeStoragePassword = vi
			.fn()
			.mockResolvedValue({ password: 'brave-pw', warnings: [] });
		const getLinuxChromeSafeStoragePassword = vi
			.fn()
			.mockResolvedValue({ password: 'chrome-pw', warnings: [] });
		const getCookiesFromChromeSqliteDb = vi.fn().mockResolvedValue({ cookies: [], warnings: [] });

		vi.doMock('../src/providers/chromeSqlite/linuxKeyring.js', () => ({
			getLinuxBraveSafeStoragePassword,
			getLinuxChromeSafeStoragePassword,
		}));
		vi.doMock('../src/providers/chromium/linuxPaths.js', () => ({
			resolveChromiumCookiesDbLinux: () =>
				'/home/test/.config/BraveSoftware/Brave-Browser/Default/Cookies',
		}));
		vi.doMock('../src/providers/chromeSqlite/shared.js', () => ({
			getCookiesFromChromeSqliteDb,
		}));
		vi.doMock('../src/providers/chromeSqlite/crypto.js', () => ({
			decryptChromiumAes128CbcCookieValue: vi.fn(),
			deriveAes128CbcKeyFromPassword: () => new Uint8Array(),
		}));

		const { getCookiesFromChromeSqliteLinux } = await import(
			'../src/providers/chromeSqliteLinux.js'
		);

		await getCookiesFromChromeSqliteLinux({ profile: 'Default' }, ['https://example.com'], null);

		expect(getLinuxBraveSafeStoragePassword).toHaveBeenCalled();
		expect(getLinuxChromeSafeStoragePassword).not.toHaveBeenCalled();
		expect(getCookiesFromChromeSqliteDb).toHaveBeenCalled();
	});
});
