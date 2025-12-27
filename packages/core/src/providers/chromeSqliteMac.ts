import { homedir } from 'node:os';
import path from 'node:path';

import type { GetCookiesResult } from '../types.js';
import {
	decryptChromiumAes128CbcCookieValue,
	deriveAes128CbcKeyFromPassword,
} from './chromeSqlite/crypto.js';
import { getCookiesFromChromeSqliteDb } from './chromeSqlite/shared.js';
import { readKeychainGenericPasswordFirst } from './chromium/macosKeychain.js';
import { resolveCookiesDbFromProfileOrRoots } from './chromium/paths.js';

export async function getCookiesFromChromeSqliteMac(
	options: { profile?: string; includeExpired?: boolean; debug?: boolean },
	origins: string[],
	allowlistNames: Set<string> | null
): Promise<GetCookiesResult> {
	const dbPath = resolveChromeCookiesDb(options.profile);
	if (!dbPath) {
		return { cookies: [], warnings: ['Chrome cookies database not found.'] };
	}

	const warnings: string[] = [];
	// On macOS, Chrome stores its "Safe Storage" secret in Keychain.
	// `security find-generic-password` is stable and avoids any native Node keychain modules.
	const passwordResult = await readKeychainGenericPasswordFirst({
		account: 'Chrome',
		services: ['Chrome Safe Storage'],
		timeoutMs: 3_000,
		label: 'Chrome Safe Storage',
	});
	if (!passwordResult.ok) {
		warnings.push(passwordResult.error);
		return { cookies: [], warnings };
	}

	const chromePassword = passwordResult.password.trim();
	if (!chromePassword) {
		warnings.push('macOS Keychain returned an empty Chrome Safe Storage password.');
		return { cookies: [], warnings };
	}

	// Chromium uses PBKDF2(password, "saltysalt", 1003, 16, sha1) for AES-128-CBC cookie values on macOS.
	const key = deriveAes128CbcKeyFromPassword(chromePassword, { iterations: 1003 });
	const decrypt = (encryptedValue: Uint8Array, opts: { stripHashPrefix: boolean }): string | null =>
		decryptChromiumAes128CbcCookieValue(encryptedValue, [key], {
			stripHashPrefix: opts.stripHashPrefix,
			treatUnknownPrefixAsPlaintext: true,
		});

	const dbOptions: { dbPath: string; profile?: string; includeExpired?: boolean; debug?: boolean } =
		{
			dbPath,
		};
	if (options.profile) dbOptions.profile = options.profile;
	if (options.includeExpired !== undefined) dbOptions.includeExpired = options.includeExpired;
	if (options.debug !== undefined) dbOptions.debug = options.debug;

	const result = await getCookiesFromChromeSqliteDb(dbOptions, origins, allowlistNames, decrypt);
	result.warnings.unshift(...warnings);
	return result;
}

function resolveChromeCookiesDb(profile?: string): string | null {
	const home = homedir();
	/* c8 ignore next */
	const roots =
		process.platform === 'darwin'
			? [path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')]
			: [];
	const args: Parameters<typeof resolveCookiesDbFromProfileOrRoots>[0] = { roots };
	if (profile !== undefined) args.profile = profile;
	return resolveCookiesDbFromProfileOrRoots(args);
}
