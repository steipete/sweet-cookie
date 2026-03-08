import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const itIfDarwin = process.platform === 'darwin' ? it : it.skip;

function buildInlinePayload(): string {
	return JSON.stringify({
		cookies: [{ name: 'inline', value: '1', domain: 'chatgpt.com', path: '/' }],
	});
}

// biome-ignore lint/suspicious/noExplicitAny: test-only capture
const edgeCapture = vi.hoisted(() => ({ lastOptions: null as any }));
// biome-ignore lint/suspicious/noExplicitAny: test-only capture
const chromeCapture = vi.hoisted(() => ({ lastOptions: null as any }));

// biome-ignore lint/suspicious/noExplicitAny: test-only control surface
const nodeSqlite = vi.hoisted(() => ({ rows: [] as any[], shouldThrow: false }));

vi.mock('node:sqlite', () => {
	class DatabaseSync {
		// biome-ignore lint/suspicious/noExplicitAny: test shim
		constructor(_path: string, _options?: any) {
			if (nodeSqlite.shouldThrow) {
				throw new Error('boom');
			}
		}

		prepare() {
			return { all: () => nodeSqlite.rows };
		}

		close() {}
	}

	return { DatabaseSync };
});

describe('public API', () => {
	beforeEach(() => {
		nodeSqlite.rows = [];
		nodeSqlite.shouldThrow = false;
		edgeCapture.lastOptions = null;
		chromeCapture.lastOptions = null;
	});

	it('returns inline cookies first (and filters by name)', async () => {
		const { getCookies } = await import('../src/index.js');
		const res = await getCookies({
			url: 'https://chatgpt.com/',
			names: ['inline'],
			inlineCookiesJson: buildInlinePayload(),
			browsers: ['chrome', 'firefox', 'safari'],
		});
		expect(res.cookies.map((c) => c.name)).toEqual(['inline']);
	});

	it('respects SWEET_COOKIE_BROWSERS env when browsers are not provided', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-public-env-'));
		const firefoxDir = path.join(dir, 'ff');
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, 'cookies.sqlite'), '', 'utf8');

		nodeSqlite.rows = [
			{
				name: 'firefox',
				value: 'f',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		vi.doMock('../src/providers/chrome.js', () => ({
			getCookiesFromChrome: async () => ({
				cookies: [{ name: 'chrome', value: 'c', domain: 'chatgpt.com', path: '/', secure: true }],
				warnings: [],
			}),
		}));

		vi.stubEnv('SWEET_COOKIE_BROWSERS', 'firefox, chrome');
		vi.stubEnv('SWEET_COOKIE_MODE', 'merge');

		const { getCookies } = await import('../src/index.js');
		const res = await getCookies({
			url: 'https://chatgpt.com/',
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name).sort()).toEqual(['chrome', 'firefox']);
	});

	it('ignores unknown tokens in SWEET_COOKIE_BROWSERS and invalid SWEET_COOKIE_MODE', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-public-env-'));
		const firefoxDir = path.join(dir, 'ff');
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, 'cookies.sqlite'), '', 'utf8');

		nodeSqlite.rows = [
			{
				name: 'firefox',
				value: 'f',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		vi.stubEnv('SWEET_COOKIE_BROWSERS', 'firefox, nope');
		vi.stubEnv('SWEET_COOKIE_MODE', 'nope');

		const { getCookies } = await import('../src/index.js');
		const res = await getCookies({
			url: 'https://chatgpt.com/',
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(['firefox']);
	});

	it('supports edge backend and uses SWEET_COOKIE_EDGE_PROFILE', async () => {
		vi.resetModules();

		vi.doMock('../src/providers/edge.js', () => ({
			getCookiesFromEdge: async (options: unknown) => {
				edgeCapture.lastOptions = options;
				return {
					cookies: [{ name: 'edge', value: 'e', domain: 'chatgpt.com', path: '/', secure: true }],
					warnings: [],
				};
			},
		}));

		vi.stubEnv('SWEET_COOKIE_BROWSERS', 'edge');
		vi.stubEnv('SWEET_COOKIE_EDGE_PROFILE', 'Default');

		const { getCookies } = await import('../src/index.js');
		const res = await getCookies({
			url: 'https://chatgpt.com/',
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(['edge']);
		expect(edgeCapture.lastOptions).toMatchObject({ profile: 'Default' });
	});

	it('passes chromiumBrowser through to the chrome provider', async () => {
		vi.resetModules();

		vi.doMock('../src/providers/chrome.js', () => ({
			getCookiesFromChrome: async (options: unknown) => {
				chromeCapture.lastOptions = options;
				return {
					cookies: [{ name: 'chrome', value: 'c', domain: 'chatgpt.com', path: '/', secure: true }],
					warnings: [],
				};
			},
		}));

		const { getCookies } = await import('../src/index.js');
		const res = await getCookies({
			url: 'https://chatgpt.com/',
			browsers: ['chrome'],
			chromiumBrowser: 'arc',
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(['chrome']);
		expect(chromeCapture.lastOptions).toMatchObject({ chromiumBrowser: 'arc' });
	});

	itIfDarwin('merges browser sources and dedupes by name+domain+path', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-public-'));

		const firefoxDir = path.join(dir, 'ff');
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, 'cookies.sqlite'), '', 'utf8');

		nodeSqlite.rows = [
			{
				name: 'dup',
				value: 'x',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
			{
				name: 'firefox',
				value: 'f',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		vi.doMock('../src/providers/chrome.js', () => ({
			getCookiesFromChrome: async () => ({
				cookies: [
					{ name: 'dup', value: 'x', domain: 'chatgpt.com', path: '/', secure: true },
					{ name: 'chrome', value: 'c', domain: 'chatgpt.com', path: '/', secure: true },
				],
				warnings: [],
			}),
		}));

		const { getCookies } = await import('../src/index.js');
		const res = await getCookies({
			url: 'https://chatgpt.com/',
			browsers: ['chrome', 'firefox'],
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name).sort()).toEqual(['chrome', 'dup', 'firefox']);
	});

	it('mode=first returns the first non-empty browser result', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-public-first-'));
		const firefoxDir = path.join(dir, 'ff');
		mkdirSync(firefoxDir, { recursive: true });
		writeFileSync(path.join(firefoxDir, 'cookies.sqlite'), '', 'utf8');

		nodeSqlite.rows = [
			{
				name: 'only',
				value: 'f',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		const { getCookies } = await import('../src/index.js');
		const res = await getCookies({
			url: 'https://chatgpt.com/',
			mode: 'first',
			browsers: ['firefox', 'chrome'],
			firefoxProfile: firefoxDir,
			includeExpired: true,
		});

		expect(res.cookies.map((c) => c.name)).toEqual(['only']);
	});

	it('toCookieHeader() sorts and can dedupe by name', async () => {
		const { toCookieHeader } = await import('../src/index.js');
		const header = toCookieHeader(
			[
				{ name: 'b', value: '2' },
				{ name: 'a', value: '1' },
				{ name: 'a', value: 'ignored' },
			],
			{ dedupeByName: true }
		);
		expect(header).toBe('a=1; b=2');
	});

	it('toCookieHeader() can preserve order', async () => {
		const { toCookieHeader } = await import('../src/index.js');
		const header = toCookieHeader(
			[
				{ name: 'b', value: '2' },
				{ name: 'a', value: '1' },
			],
			{ sort: 'none' }
		);
		expect(header).toBe('b=2; a=1');
	});
});
