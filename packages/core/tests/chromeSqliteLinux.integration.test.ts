import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { importNodeSqlite } from '../src/util/nodeSqlite.js';

const describeIfLinux = process.platform === 'linux' ? describe : describe.skip;

function encryptAes128CbcCookieValue(options: {
	prefix: 'v10' | 'v11';
	password: string;
	iterations: number;
	stripHashPrefix: boolean;
	value: string;
}): Uint8Array {
	const key = pbkdf2Sync(options.password, 'saltysalt', options.iterations, 16, 'sha1');
	const iv = Buffer.alloc(16, 0x20);
	const cipher = createCipheriv('aes-128-cbc', key, iv);
	cipher.setAutoPadding(false);

	const payload = options.stripHashPrefix
		? Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from(options.value, 'utf8')])
		: Buffer.from(options.value, 'utf8');

	const padding = 16 - (payload.length % 16);
	const paddingSize = padding === 0 ? 16 : padding;
	const padded = Buffer.concat([payload, Buffer.alloc(paddingSize, paddingSize)]);

	const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
	return Buffer.concat([Buffer.from(options.prefix, 'utf8'), encrypted]);
}

async function createChromiumCookiesDb(options: {
	dbPath: string;
	metaVersion: number;
	rows: Array<{
		host_key: string;
		name: string;
		value: string;
		encrypted_value: Uint8Array;
	}>;
}): Promise<void> {
	const { DatabaseSync } = await importNodeSqlite();
	const db = new DatabaseSync(options.dbPath);
	try {
		db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER);');
		db.exec(
			'CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER);'
		);

		db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('version', options.metaVersion);

		const insert = db.prepare(
			'INSERT INTO cookies (host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		for (const row of options.rows) {
			insert.run(row.host_key, row.name, row.value, row.encrypted_value, '/', 0, 1, 1, 0);
		}
	} finally {
		db.close();
	}
}

describeIfLinux('chrome sqlite (linux) integration', () => {
	it('decrypts v10 and v11 cookies from a real sqlite DB', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-linux-it-'));
		const dbPath = path.join(dir, 'Cookies');

		const v11Password = `pw-${randomBytes(8).toString('hex')}`;
		vi.stubEnv('SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD', v11Password);

		await createChromiumCookiesDb({
			dbPath,
			metaVersion: 24,
			rows: [
				{
					host_key: '.example.com',
					name: 'v10',
					value: '',
					encrypted_value: encryptAes128CbcCookieValue({
						prefix: 'v10',
						password: 'peanuts',
						iterations: 1,
						stripHashPrefix: true,
						value: 'cookie-v10',
					}),
				},
				{
					host_key: '.example.com',
					name: 'v11',
					value: '',
					encrypted_value: encryptAes128CbcCookieValue({
						prefix: 'v11',
						password: v11Password,
						iterations: 1,
						stripHashPrefix: true,
						value: 'cookie-v11',
					}),
				},
			],
		});

		const { getCookiesFromChromeSqliteLinux } = await import(
			'../src/providers/chromeSqliteLinux.js'
		);
		const res = await getCookiesFromChromeSqliteLinux(
			{ profile: dbPath, includeExpired: true },
			['https://example.com/'],
			null
		);

		expect(res.warnings).toEqual([]);
		expect(res.cookies.map((c) => `${c.name}=${c.value}`).sort()).toEqual([
			'v10=cookie-v10',
			'v11=cookie-v11',
		]);
	});
});
