import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCookiesFromChromeSqliteMac } from '../src/providers/chromeSqliteMac.js';

function prependToPath(dir: string): void {
	const parts = [dir, process.env.PATH ?? ''].filter(Boolean);
	vi.stubEnv('PATH', parts.join(path.delimiter));
}

// biome-ignore lint/suspicious/noExplicitAny: test-only control surface
const nodeSqlite = vi.hoisted(() => ({ rows: [] as any[], shouldThrow: false }));
// biome-ignore lint/suspicious/noExplicitAny: test-only control surface
const bunSqlite = vi.hoisted(() => ({ rows: [] as any[], shouldThrow: false }));

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

vi.mock('bun:sqlite', () => {
	class Database {
		// biome-ignore lint/suspicious/noExplicitAny: test shim
		constructor(_path: string, _options?: any) {
			if (bunSqlite.shouldThrow) {
				throw new Error('boom');
			}
		}

		query() {
			return { all: () => bunSqlite.rows };
		}

		close() {}
	}

	return { Database };
});

function writeShim(
	binDir: string,
	name: string,
	options: { stdout?: string; stderr?: string; exitCode?: number } = {}
): void {
	mkdirSync(binDir, { recursive: true });

	const shim = path.join(binDir, name);
	const script = [
		'#!/usr/bin/env node',
		`process.stdout.write(${JSON.stringify(options.stdout ?? '')});`,
		`process.stderr.write(${JSON.stringify(options.stderr ?? '')});`,
		`process.exit(${options.exitCode ?? 0});`,
	].join('\n');
	writeFileSync(shim, script, { encoding: 'utf8' });
	if (process.platform !== 'win32') chmodSync(shim, 0o755);

	if (process.platform === 'win32') {
		const cmd = path.join(binDir, `${name}.cmd`);
		writeFileSync(cmd, ['@echo off', `node "%~dp0${name}" %*`].join('\r\n'), {
			encoding: 'utf8',
		});
	}
}

function encryptChromeCookieValueMac(plaintext: string, password: string): Buffer {
	const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
	const iv = Buffer.alloc(16, 0x20);
	const cipher = createCipheriv('aes-128-cbc', key, iv);
	cipher.setAutoPadding(false);

	const data = Buffer.from(plaintext, 'utf8');
	const padding = 16 - (data.length % 16);
	const paddingSize = padding === 0 ? 16 : padding;
	const padded = Buffer.concat([data, Buffer.alloc(paddingSize, paddingSize)]);
	const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

	return Buffer.concat([Buffer.from('v11', 'utf8'), encrypted]);
}

describe('chrome sqlite (mac) provider', () => {
	beforeEach(() => {
		nodeSqlite.rows = [];
		nodeSqlite.shouldThrow = false;
		bunSqlite.rows = [];
		bunSqlite.shouldThrow = false;
	});

	it('reads + decrypts cookies via node:sqlite + macOS keychain stub', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		const password = 'test-password';
		writeShim(binDir, 'security', { stdout: `${password}\n`, exitCode: 0 });
		prependToPath(binDir);

		const encrypted = encryptChromeCookieValueMac('cookie-value', password);
		nodeSqlite.rows = [
			{
				name: 'sid',
				value: '',
				host_key: '.chatgpt.com',
				path: '/',
				expires_utc: 1700000000,
				is_secure: 1,
				is_httponly: 1,
				samesite: 2,
				encrypted_value: encrypted,
			},
		];

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.warnings).toEqual([]);
		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe('sid');
		expect(res.cookies[0]?.value).toBe('cookie-value');
		expect(res.cookies[0]?.secure).toBe(true);
		expect(res.cookies[0]?.httpOnly).toBe(true);
		expect(res.cookies[0]?.sameSite).toBe('Strict');
	});

	it('uses plaintext value when present (no decryption)', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		writeShim(binDir, 'security', { stdout: 'ignored\n', exitCode: 0 });
		prependToPath(binDir);

		nodeSqlite.rows = [
			{
				name: 'sid',
				value: 'plain',
				host_key: '.chatgpt.com',
				path: '/',
				expires_utc: 1700000000,
				is_secure: 0,
				is_httponly: 0,
				samesite: -1,
				encrypted_value: new Uint8Array(),
			},
		];

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.value).toBe('plain');
	});

	it('normalizes SameSite strings from sqlite rows', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		writeShim(binDir, 'security', { stdout: 'ignored\n', exitCode: 0 });
		prependToPath(binDir);

		nodeSqlite.rows = [
			{
				name: 'sid',
				value: 'plain',
				host_key: '.chatgpt.com',
				path: '/',
				expires_utc: 1700000000,
				is_secure: 0,
				is_httponly: 0,
				samesite: 'lax',
				encrypted_value: new Uint8Array(),
			},
		];

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.sameSite).toBe('Lax');
	});

	it('returns warnings when keychain lookup fails', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		writeShim(binDir, 'security', { stderr: 'nope', exitCode: 1 });
		prependToPath(binDir);

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
		expect(res.warnings.join('\n')).toContain('Failed to read macOS Keychain');
	});

	it('returns warnings when keychain password is empty', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		writeShim(binDir, 'security', { stdout: '\n', exitCode: 0 });
		prependToPath(binDir);

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
		expect(res.warnings.join('\n')).toContain('empty Chrome Safe Storage password');
	});

	it('returns warnings when node:sqlite fails', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		writeShim(binDir, 'security', { stdout: 'pw\n', exitCode: 0 });
		prependToPath(binDir);

		nodeSqlite.shouldThrow = true;
		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
		expect(res.warnings.join('\n')).toContain('node:sqlite failed reading Chrome cookies');
	});

	it('skips invalid encrypted_value payloads', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		writeShim(binDir, 'security', { stdout: 'pw\n', exitCode: 0 });
		prependToPath(binDir);

		nodeSqlite.rows = [
			{
				name: 'sid',
				value: '',
				host_key: '.chatgpt.com',
				path: '/',
				expires_utc: 1700000000,
				is_secure: 1,
				is_httponly: 1,
				samesite: 2,
				encrypted_value: 123,
			},
		];

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
	});

	it('returns warnings when the Chrome cookie DB is missing', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');

		mkdirSync(profileDir, { recursive: true });

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
		expect(res.warnings.join('\n')).toContain('Chrome cookies database not found');
	});

	it('filters expired cookies when includeExpired is false', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		const password = 'pw';
		writeShim(binDir, 'security', { stdout: `${password}\n`, exitCode: 0 });
		prependToPath(binDir);

		const encrypted = encryptChromeCookieValueMac('cookie-value', password);
		nodeSqlite.rows = [
			{
				name: 'sid',
				value: '',
				host_key: '.chatgpt.com',
				path: '/',
				expires_utc: 1,
				is_secure: 1,
				is_httponly: 1,
				samesite: 0,
				encrypted_value: encrypted,
			},
		];

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: false },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
	});

	it('skips cookies that do not match the requested origins', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		const password = 'pw';
		writeShim(binDir, 'security', { stdout: `${password}\n`, exitCode: 0 });
		prependToPath(binDir);

		const encrypted = encryptChromeCookieValueMac('cookie-value', password);
		nodeSqlite.rows = [
			{
				name: 'sid',
				value: '',
				host_key: '.evil.com',
				path: '/',
				expires_utc: 1700000000,
				is_secure: 1,
				is_httponly: 1,
				samesite: 0,
				encrypted_value: encrypted,
			},
		];

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			null
		);

		expect(res.cookies).toEqual([]);
	});

	it('filters by allowlist', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');

		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		const password = 'pw';
		writeShim(binDir, 'security', { stdout: `${password}\n`, exitCode: 0 });
		prependToPath(binDir);

		const encrypted = encryptChromeCookieValueMac('cookie-value', password);
		nodeSqlite.rows = [
			{
				name: 'sid',
				value: '',
				host_key: '.chatgpt.com',
				path: '/',
				expires_utc: 1700000000,
				is_secure: 1,
				is_httponly: 1,
				samesite: 0,
				encrypted_value: encrypted,
			},
		];

		const res = await getCookiesFromChromeSqliteMac(
			{ profile: profileDir, includeExpired: true },
			['https://chatgpt.com/'],
			new Set(['other'])
		);

		expect(res.cookies).toEqual([]);
	});

	it('reads via bun:sqlite when bun runtime detected', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-bun-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		const password = 'pw';
		writeShim(binDir, 'security', { stdout: `${password}\n`, exitCode: 0 });
		prependToPath(binDir);

		const encrypted = encryptChromeCookieValueMac('cookie-value', password);
		bunSqlite.rows = [
			{
				name: 'sid',
				value: '',
				host_key: '.chatgpt.com',
				path: '/',
				expires_utc: 1700000000,
				is_secure: 1,
				is_httponly: 1,
				samesite: 2,
				encrypted_value: encrypted,
			},
		];

		const prev = (process.versions as unknown as { bun?: string }).bun;
		(process.versions as unknown as { bun?: string }).bun = '1.0.0';
		try {
			const res = await getCookiesFromChromeSqliteMac(
				{ profile: profileDir, includeExpired: true },
				['https://chatgpt.com/'],
				null
			);
			expect(res.cookies).toHaveLength(1);
			expect(res.cookies[0]?.value).toBe('cookie-value');
		} finally {
			(process.versions as unknown as { bun?: string }).bun = prev;
		}
	});

	it('returns warnings when bun:sqlite fails', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-bun-'));
		const profileDir = path.join(dir, 'profile');
		const binDir = path.join(dir, 'bin');
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(path.join(profileDir, 'Cookies'), '', 'utf8');

		writeShim(binDir, 'security', { stdout: 'pw\n', exitCode: 0 });
		prependToPath(binDir);

		const prev = (process.versions as unknown as { bun?: string }).bun;
		(process.versions as unknown as { bun?: string }).bun = '1.0.0';
		bunSqlite.shouldThrow = true;
		try {
			const res = await getCookiesFromChromeSqliteMac(
				{ profile: profileDir, includeExpired: true },
				['https://chatgpt.com/'],
				null
			);
			expect(res.cookies).toEqual([]);
			expect(res.warnings.join('\n')).toContain('bun:sqlite failed reading Chrome cookies');
		} finally {
			bunSqlite.shouldThrow = false;
			(process.versions as unknown as { bun?: string }).bun = prev;
		}
	});
});
