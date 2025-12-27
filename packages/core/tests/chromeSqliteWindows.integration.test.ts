import { execFileSync } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const describeIfWin = process.platform === 'win32' ? describe : describe.skip;

function dpapiProtect(data: Buffer): Buffer {
	const inputB64 = data.toString('base64');
	const prelude =
		'try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop } catch { try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch {} };';
	const script =
		prelude +
		`$in=[Convert]::FromBase64String('${inputB64}');` +
		`$out=[System.Security.Cryptography.ProtectedData]::Protect($in,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);` +
		`[Convert]::ToBase64String($out)`;
	const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
		encoding: 'utf8',
	});
	return Buffer.from(out.trim(), 'base64');
}

function encryptAes256GcmCookieValue(options: {
	key: Buffer;
	stripHashPrefix: boolean;
	value: string;
}): Uint8Array {
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', options.key, nonce);

	const payload = options.stripHashPrefix
		? Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from(options.value, 'utf8')])
		: Buffer.from(options.value, 'utf8');

	const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([Buffer.from('v10', 'utf8'), nonce, ciphertext, tag]);
}

async function createChromiumCookiesDb(options: {
	dbPath: string;
	metaVersion: number;
	host: string;
	encryptedValue: Uint8Array;
}): Promise<void> {
	const { DatabaseSync } = await import('node:sqlite');
	const db = new DatabaseSync(options.dbPath);
	try {
		db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER);');
		db.exec(
			'CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER);'
		);

		db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('version', options.metaVersion);
		db.prepare(
			'INSERT INTO cookies (host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run(options.host, 'sid', '', options.encryptedValue, '/', 0, 1, 1, 0);
	} finally {
		db.close();
	}
}

describeIfWin('chrome sqlite (windows) integration', () => {
	it('decrypts v10 AES-GCM cookies using DPAPI-wrapped master key', async () => {
		vi.resetModules();

		const root = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-win-it-'));
		const userDataDir = path.join(root, 'User Data');
		const cookiesDir = path.join(userDataDir, 'Default', 'Network');
		mkdirSync(cookiesDir, { recursive: true });
		const dbPath = path.join(cookiesDir, 'Cookies');

		const masterKey = randomBytes(32);
		const protectedKey = dpapiProtect(masterKey);

		const localState = {
			os_crypt: {
				encrypted_key: Buffer.concat([Buffer.from('DPAPI', 'utf8'), protectedKey]).toString(
					'base64'
				),
			},
		};

		writeFileSync(path.join(userDataDir, 'Local State'), JSON.stringify(localState), 'utf8');

		const encryptedValue = encryptAes256GcmCookieValue({
			key: masterKey,
			stripHashPrefix: true,
			value: 'cookie-value',
		});

		await createChromiumCookiesDb({
			dbPath,
			metaVersion: 24,
			host: '.example.com',
			encryptedValue,
		});

		const { getCookiesFromChromeSqliteWindows } = await import(
			'../src/providers/chromeSqliteWindows.js'
		);
		const res = await getCookiesFromChromeSqliteWindows(
			{ profile: dbPath, includeExpired: true },
			['https://example.com/'],
			null
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.value).toBe('cookie-value');
	});
});
