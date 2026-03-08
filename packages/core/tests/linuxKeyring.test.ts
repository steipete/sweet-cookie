import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLinuxChromiumSafeStoragePassword } from '../src/providers/chromeSqlite/linuxKeyring.js';

const itIfLinux = process.platform === 'linux' ? it : it.skip;

function prependToPath(dir: string): void {
	const parts = [dir, process.env.PATH ?? ''].filter(Boolean);
	vi.stubEnv('PATH', parts.join(path.delimiter));
}

/**
 * Creates a secret-tool shim that returns different passwords based on arguments.
 * This simulates the GNOME keyring behavior where different lookup methods return different results.
 */
function writeSecretToolShim(
	binDir: string,
	options: {
		serviceAccountPassword?: string;
		applicationPassword?: string;
	}
): void {
	mkdirSync(binDir, { recursive: true });

	const shim = path.join(binDir, 'secret-tool');
	// Script checks args to determine which password to return
	const script = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
// Check for application-based lookup (fallback method)
if (args.includes('application')) {
	process.stdout.write(${JSON.stringify(options.applicationPassword ?? '')});
	process.exit(0);
}
// Check for service/account lookup (primary method)
if (args.includes('service') && args.includes('account')) {
	process.stdout.write(${JSON.stringify(options.serviceAccountPassword ?? '')});
	process.exit(0);
}
process.exit(1);
`;
	writeFileSync(shim, script, { encoding: 'utf8' });
	if (process.platform !== 'win32') chmodSync(shim, 0o755);
}

describe('linux keyring', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	itIfLinux('returns password from service/account lookup when available (Chrome)', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-keyring-'));
		const binDir = path.join(dir, 'bin');

		writeSecretToolShim(binDir, {
			serviceAccountPassword: 'primary-password\n',
			applicationPassword: 'fallback-password\n',
		});
		prependToPath(binDir);

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: 'gnome',
			app: 'chrome',
		});

		expect(result.password).toBe('primary-password');
		expect(result.warnings).toEqual([]);
	});

	itIfLinux(
		'falls back to application lookup when service/account returns empty (Chrome)',
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-keyring-'));
			const binDir = path.join(dir, 'bin');

			// Primary method returns empty, fallback should be used
			writeSecretToolShim(binDir, {
				serviceAccountPassword: '', // Empty - simulates chrome_libsecret_os_crypt_password_v2 systems
				applicationPassword: 'fallback-password\n',
			});
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({
				backend: 'gnome',
				app: 'chrome',
			});

			expect(result.password).toBe('fallback-password');
			expect(result.warnings).toEqual([]);
		}
	);

	itIfLinux(
		'falls back to application lookup when service/account returns empty (Edge)',
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-keyring-'));
			const binDir = path.join(dir, 'bin');

			// Primary method returns empty, fallback should be used
			writeSecretToolShim(binDir, {
				serviceAccountPassword: '',
				applicationPassword: 'edge-fallback-password\n',
			});
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({
				backend: 'gnome',
				app: 'edge',
			});

			expect(result.password).toBe('edge-fallback-password');
			expect(result.warnings).toEqual([]);
		}
	);

	itIfLinux(
		'falls back to application lookup when service/account returns empty (Brave)',
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-keyring-'));
			const binDir = path.join(dir, 'bin');

			writeSecretToolShim(binDir, {
				serviceAccountPassword: '',
				applicationPassword: 'brave-fallback-password\n',
			});
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({
				backend: 'gnome',
				app: 'brave',
			});

			expect(result.password).toBe('brave-fallback-password');
			expect(result.warnings).toEqual([]);
		}
	);

	itIfLinux('returns warning when both lookups fail', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sweet-cookie-keyring-'));
		const binDir = path.join(dir, 'bin');

		// Both methods return empty
		writeSecretToolShim(binDir, {
			serviceAccountPassword: '',
			applicationPassword: '',
		});
		prependToPath(binDir);

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: 'gnome',
			app: 'chrome',
		});

		expect(result.password).toBe('');
		expect(result.warnings).toContain(
			'Failed to read Linux keyring via secret-tool; v11 cookies may be unavailable.'
		);
	});

	it('uses env override when set', async () => {
		vi.stubEnv('SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD', 'override-password');

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: 'gnome',
			app: 'chrome',
		});

		expect(result.password).toBe('override-password');
		expect(result.warnings).toEqual([]);
	});

	it('uses Brave env override when set', async () => {
		vi.stubEnv('SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD', 'brave-override-password');

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: 'gnome',
			app: 'brave',
		});

		expect(result.password).toBe('brave-override-password');
		expect(result.warnings).toEqual([]);
	});

	it('returns empty password for basic backend', async () => {
		const result = await getLinuxChromiumSafeStoragePassword({
			backend: 'basic',
			app: 'chrome',
		});

		expect(result.password).toBe('');
		expect(result.warnings).toEqual([]);
	});
});
