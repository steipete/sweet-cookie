import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCookiesFromFirefox } from '../src/providers/firefoxSqlite.js';

function stubFirefoxProfilesRoot(homeDir: string): string {
	if (process.platform === 'darwin') {
		vi.stubEnv('HOME', homeDir);
		return path.join(homeDir, 'Library', 'Application Support', 'Firefox', 'Profiles');
	}

	if (process.platform === 'linux') {
		vi.stubEnv('HOME', homeDir);
		return path.join(homeDir, '.mozilla', 'firefox');
	}

	if (process.platform === 'win32') {
		const appData = path.join(homeDir, 'AppData', 'Roaming');
		vi.stubEnv('APPDATA', appData);
		return path.join(appData, 'Mozilla', 'Firefox', 'Profiles');
	}

	throw new Error(`Unsupported platform: ${process.platform}`);
}

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

describe('firefox sqlite provider', () => {
	beforeEach(() => {
		nodeSqlite.rows = [];
		nodeSqlite.shouldThrow = false;
	});

	it('reads cookies via node:sqlite', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));
		const dbDir = path.join(dir, 'profile');

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, 'cookies.sqlite'), '', 'utf8');
		nodeSqlite.rows = [
			{
				name: 'sid',
				value: 'value',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: false },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe('sid');
		expect(res.cookies[0]?.secure).toBe(true);
		expect(res.cookies[0]?.httpOnly).toBe(true);
		expect(res.cookies[0]?.sameSite).toBe('Strict');
	});

	it('accepts a direct cookies.sqlite path', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));
		const dbDir = path.join(dir, 'profile');
		mkdirSync(dbDir, { recursive: true });
		const dbPath = path.join(dbDir, 'cookies.sqlite');
		writeFileSync(dbPath, '', 'utf8');

		nodeSqlite.rows = [
			{
				name: 'sid',
				value: 'value',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbPath, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe('sid');
	});

	it('resolves profile by name from default Profiles root', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));
		const homeDir = path.join(dir, 'home');
		const profilesRoot = stubFirefoxProfilesRoot(homeDir);
		const profileName = 'abc.default-release';
		const profileDir = path.join(profilesRoot, profileName);

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'cookies.sqlite'), '', 'utf8');
		nodeSqlite.rows = [
			{
				name: 'sid',
				value: 'value',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: profileName, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe('sid');
	});

	it('auto-picks a default-release profile when no profile is specified', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));
		const homeDir = path.join(dir, 'home');
		const profilesRoot = stubFirefoxProfilesRoot(homeDir);
		const defaultRelease = path.join(profilesRoot, 'abc.default-release');
		const other = path.join(profilesRoot, 'xyz.default');
		mkdirSync(defaultRelease, { recursive: true });
		mkdirSync(other, { recursive: true });
		writeFileSync(path.join(defaultRelease, 'cookies.sqlite'), '', 'utf8');
		writeFileSync(path.join(other, 'cookies.sqlite'), '', 'utf8');

		nodeSqlite.rows = [
			{
				name: 'sid',
				value: 'value',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 1,
				isHttpOnly: 1,
				sameSite: 2,
			},
		];

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(1);
	});

	it('handles unreadable profile roots gracefully', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));
		const homeDir = path.join(dir, 'home');
		const profilesRoot = stubFirefoxProfilesRoot(homeDir);

		mkdirSync(path.dirname(profilesRoot), { recursive: true });
		writeFileSync(profilesRoot, 'not a dir', 'utf8');

		const res = await getCookiesFromFirefox(
			{ includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
		expect(res.warnings.join('\n')).toContain('Firefox cookies database not found');
	});

	it('filters by allowlist', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));
		const dbDir = path.join(dir, 'profile');

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, 'cookies.sqlite'), '', 'utf8');
		nodeSqlite.rows = [
			{
				name: 'a',
				value: '1',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
			{
				name: 'b',
				value: '2',
				host: '.chatgpt.com',
				path: '/',
				expiry: 9999999999,
				isSecure: 0,
				isHttpOnly: 0,
				sameSite: 0,
			},
		];

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			['https://chatgpt.com/'],
			new Set(['b'])
		);

		expect(res.cookies.map((c) => c.name)).toEqual(['b']);
	});

	it('returns a warning when the database is missing', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));

		const res = await getCookiesFromFirefox(
			{ profile: path.join(dir, 'missing-profile'), includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join('\n')).toContain('Firefox cookies database not found');
	});

	it('returns a warning when node:sqlite fails', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-firefox-'));
		const dbDir = path.join(dir, 'profile');

		mkdirSync(dbDir, { recursive: true });
		writeFileSync(path.join(dbDir, 'cookies.sqlite'), '', 'utf8');
		nodeSqlite.shouldThrow = true;

		const res = await getCookiesFromFirefox(
			{ profile: dbDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join('\n')).toContain('node:sqlite failed reading Firefox cookies');
	});
});
