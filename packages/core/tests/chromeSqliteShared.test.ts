import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

describe('chrome sqlite provider (shared)', () => {
	it('passes stripHashPrefix based on meta.version', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-shared-'));
		const dbPath = path.join(dir, 'Cookies');
		writeFileSync(dbPath, '', 'utf8');

		vi.doMock('node:sqlite', () => {
			class DatabaseSync {
				prepare(sql: string) {
					return {
						all() {
							if (sql.includes('FROM meta')) return [{ value: 24 }];
							return [
								{
									name: 'sid',
									value: '',
									host_key: '.chatgpt.com',
									path: '/',
									expires_utc: 0,
									samesite: 0,
									encrypted_value: new Uint8Array([1, 2, 3]),
									is_secure: 1,
									is_httponly: 1,
								},
							];
						},
					};
				}
				close() {}
			}
			return { DatabaseSync };
		});

		const { getCookiesFromChromeSqliteDb } = await import(
			'../src/providers/chromeSqlite/shared.js'
		);

		const decrypt = vi.fn((_encryptedValue: Uint8Array, opts: { stripHashPrefix: boolean }) =>
			opts.stripHashPrefix ? 'yes' : 'no'
		);

		const res = await getCookiesFromChromeSqliteDb(
			{ dbPath, includeExpired: true },
			['https://chatgpt.com/'],
			null,
			decrypt
		);

		expect(res.cookies[0]?.value).toBe('yes');
		expect(decrypt).toHaveBeenCalled();
	});

	it('supports BigInt sqlite rows without dropping cookies', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-shared-'));
		const dbPath = path.join(dir, 'Cookies');
		writeFileSync(dbPath, '', 'utf8');

		vi.doMock('node:sqlite', () => {
			class DatabaseSync {
				prepare(sql: string) {
					return {
						all() {
							if (sql.includes('FROM meta')) return [{ value: 24 }];
							return [
								{
									name: 'auth_token',
									value: 'token',
									host_key: '.x.com',
									path: '/',
									expires_utc: 1_700_000_000n,
									samesite: 1n,
									encrypted_value: new Uint8Array([1]),
									is_secure: 1n,
									is_httponly: 0n,
								},
							];
						},
					};
				}
				close() {}
			}
			return { DatabaseSync };
		});

		const { getCookiesFromChromeSqliteDb } = await import(
			'../src/providers/chromeSqlite/shared.js'
		);

		const decrypt = vi.fn((_encryptedValue: Uint8Array) => 'token');

		const res = await getCookiesFromChromeSqliteDb(
			{ dbPath, includeExpired: true },
			['https://x.com/'],
			null,
			decrypt
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.expires).toBe(1_700_000_000);
		expect(res.cookies[0]?.secure).toBe(true);
		expect(res.cookies[0]?.httpOnly).toBe(false);
		expect(res.cookies[0]?.sameSite).toBe('Lax');
	});

	it('supports string sqlite rows without dropping cookies', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-chrome-shared-'));
		const dbPath = path.join(dir, 'Cookies');
		writeFileSync(dbPath, '', 'utf8');

		vi.doMock('node:sqlite', () => {
			class DatabaseSync {
				prepare(sql: string) {
					return {
						all() {
							if (sql.includes('FROM meta')) return [{ value: 24 }];
							return [
								{
									name: 'auth_token',
									value: 'token',
									host_key: '.google.com',
									path: '/',
									expires_utc: '13446467996267834',
									samesite: 1,
									encrypted_value: new Uint8Array([1]),
									is_secure: 1,
									is_httponly: 0,
								},
							];
						},
					};
				}
				close() {}
			}
			return { DatabaseSync };
		});

		const { getCookiesFromChromeSqliteDb } = await import(
			'../src/providers/chromeSqlite/shared.js'
		);

		const decrypt = vi.fn((_encryptedValue: Uint8Array) => 'token');

		const res = await getCookiesFromChromeSqliteDb(
			{ dbPath, includeExpired: true },
			['https://google.com/'],
			null,
			decrypt
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.expires).toBe(1_801_994_396);
	});
});
