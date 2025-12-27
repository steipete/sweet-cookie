import { describe, expect, it, vi } from 'vitest';

describe('chrome-cookies-secure provider', () => {
	it('normalizes cookies and respects allowlist/expiry', async () => {
		vi.resetModules();

		const now = Math.floor(Date.now() / 1000);
		const getCookiesPromised = vi.fn(async () => [
			{
				name: 'sid',
				value: 'a',
				domain: '.chatgpt.com',
				path: '/',
				expires: now + 60,
				sameSite: 'no_restriction',
				secure: true,
				httpOnly: true,
			},
			{
				name: 'expired',
				value: 'x',
				domain: '.chatgpt.com',
				path: '/',
				expires: now - 10,
				secure: true,
			},
		]);

		vi.doMock('chrome-cookies-secure', () => ({
			default: { getCookiesPromised },
		}));

		const { getCookiesFromChrome } = await import('../src/providers/chromeCookiesSecure.js');

		const res = await getCookiesFromChrome(
			{ profile: 'Default', includeExpired: false },
			['https://chatgpt.com/'],
			new Set(['sid', 'expired'])
		);

		expect(res.cookies.map((c) => c.name)).toEqual(['sid']);
		expect(res.cookies[0]?.sameSite).toBe('None');
		expect(res.cookies[0]?.source?.browser).toBe('chrome');
		expect(res.cookies[0]?.source?.profile).toBe('Default');
	});

	it('defaults secure=false for http origins when flags are missing', async () => {
		vi.resetModules();

		const getCookiesPromised = vi.fn(async () => [
			{ name: 'sid', value: 'a', domain: 'localhost', path: '/' },
		]);

		vi.doMock('chrome-cookies-secure', () => ({
			default: { getCookiesPromised },
		}));

		const { getCookiesFromChrome } = await import('../src/providers/chromeCookiesSecure.js');

		const res = await getCookiesFromChrome({ includeExpired: true }, ['http://localhost/'], null);

		expect(res.cookies[0]?.secure).toBe(false);
	});

	it('returns warnings when chrome-cookies-secure is present but missing getCookiesPromised()', async () => {
		vi.resetModules();

		vi.doMock('chrome-cookies-secure', () => ({
			default: {},
		}));

		const { getCookiesFromChrome } = await import('../src/providers/chromeCookiesSecure.js');
		const res = await getCookiesFromChrome(
			{ includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join('\n')).toContain('does not expose getCookiesPromised');
	});

	it('ignores non-array cookie results', async () => {
		vi.resetModules();

		const getCookiesPromised = vi.fn(async () => ({ ok: true }));
		vi.doMock('chrome-cookies-secure', () => ({
			default: { getCookiesPromised },
		}));

		const { getCookiesFromChrome } = await import('../src/providers/chromeCookiesSecure.js');
		const res = await getCookiesFromChrome(
			{ includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(0);
	});

	it('times out slow reads and reports a warning', async () => {
		vi.resetModules();

		const getCookiesPromised = vi.fn(async () => await new Promise(() => {}));
		vi.doMock('chrome-cookies-secure', () => ({
			default: { getCookiesPromised },
		}));

		const { getCookiesFromChrome } = await import('../src/providers/chromeCookiesSecure.js');
		const res = await getCookiesFromChrome(
			{ includeExpired: true, timeoutMs: 10 },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join('\n')).toContain('Timed out');
	});

	it('does not warn when chrome-cookies-secure is not installed', async () => {
		vi.resetModules();

		vi.doMock('chrome-cookies-secure', () => ({
			get default() {
				const error = Object.assign(new Error("Cannot find package 'chrome-cookies-secure'"), {
					code: 'ERR_MODULE_NOT_FOUND',
				});
				throw error;
			},
		}));

		const { getCookiesFromChrome } = await import('../src/providers/chromeCookiesSecure.js');
		const res = await getCookiesFromChrome(
			{ includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
		expect(res.warnings).toEqual([]);
	});
});
