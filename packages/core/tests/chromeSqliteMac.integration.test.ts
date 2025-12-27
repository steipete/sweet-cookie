import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { importNodeSqlite } from '../src/util/nodeSqlite.js';

const describeIfDarwin = process.platform === 'darwin' ? describe : describe.skip;

function encryptChromeCookieValueMac(options: {
	password: string;
	stripHashPrefix: boolean;
	value: string;
}): Buffer {
	const key = pbkdf2Sync(options.password, 'saltysalt', 1003, 16, 'sha1');
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
	return Buffer.concat([Buffer.from('v11', 'utf8'), encrypted]);
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
			insert.run(row.host_key, row.name, row.value, row.encrypted_value, '/', 9999999999, 1, 1, 2);
		}
	} finally {
		db.close();
	}
}

function writeShim(
	binDir: string,
	name: string,
	options: { stdout: string; exitCode?: number }
): void {
	mkdirSync(binDir, { recursive: true });
	const shim = path.join(binDir, name);
	const script = [
		'#!/usr/bin/env node',
		`process.stdout.write(${JSON.stringify(options.stdout)});`,
		`process.exit(${options.exitCode ?? 0});`,
	].join('\n');
	writeFileSync(shim, script, { encoding: 'utf8' });
	chmodSync(shim, 0o755);
}

describeIfDarwin('chrome sqlite (mac) integration', () => {
	it('decrypts v11 cookies from a real sqlite DB', async () => {
		vi.resetModules();

		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-mac-it-'));
		const binDir = path.join(dir, 'bin');
		const dbPath = path.join(dir, 'Cookies');

		const password = `pw-${randomBytes(8).toString('hex')}`;
		writeShim(binDir, 'security', { stdout: `${password}\n`, exitCode: 0 });
		vi.stubEnv('PATH', [binDir, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter));

		await createChromiumCookiesDb({
			dbPath,
			metaVersion: 24,
			rows: [
				{
					host_key: '.example.com',
					name: 'sid',
					value: '',
					encrypted_value: encryptChromeCookieValueMac({
						password,
						stripHashPrefix: true,
						value: 'cookie-value',
					}),
				},
			],
		});

		const { getCookiesFromChromeSqliteMac } = await import('../src/providers/chromeSqliteMac.js');
		const res = await getCookiesFromChromeSqliteMac(
			{ profile: dbPath, includeExpired: true },
			['https://example.com/'],
			null
		);

		expect(res.warnings).toEqual([]);
		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.value).toBe('cookie-value');
	});
});
