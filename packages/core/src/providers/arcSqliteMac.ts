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

export async function getCookiesFromArcSqliteMac(
	options: { profile?: string; includeExpired?: boolean; debug?: boolean },
	origins: string[],
	allowlistNames: Set<string> | null
): Promise<GetCookiesResult> {
	const dbPath = resolveArcCookiesDb(options.profile);
	if (!dbPath) {
		return { cookies: [], warnings: ['Arc cookies database not found.'] };
	}

	const warnings: string[] = [];
	// Arc uses "Arc Safe Storage" keychain entry (different from Chrome)
	const passwordResult = await readKeychainGenericPasswordFirst({
		account: 'Arc',
		services: ['Arc Safe Storage'],
		timeoutMs: 3_000,
		label: 'Arc Safe Storage',
	});
	if (!passwordResult.ok) {
		warnings.push(passwordResult.error);
		return { cookies: [], warnings };
	}

	const arcPassword = passwordResult.password.trim();
	if (!arcPassword) {
		warnings.push('macOS Keychain returned an empty Arc Safe Storage password.');
		return { cookies: [], warnings };
	}

	// Arc uses PBKDF2 with the base64 password string directly (NOT decoded).
	// This is the same approach as Chrome - password is used as-is.
	// PBKDF2(password, "saltysalt", 1003, 16, sha1) for AES-128-CBC.
	const key = deriveAes128CbcKeyFromPassword(arcPassword, { iterations: 1003 });

	// Arc always uses the 32-byte hash prefix (like modern Chrome >= 24)
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

	// Update source to indicate Arc browser
	for (const cookie of result.cookies) {
		if (cookie.source) {
			cookie.source.browser = 'arc';
		}
	}

	result.warnings.unshift(...warnings);
	return result;
}

function resolveArcCookiesDb(profile?: string): string | null {
	const home = homedir();
	// Arc stores cookies in ~/Library/Application Support/Arc/User Data/<Profile>/Cookies
	const roots =
		process.platform === 'darwin'
			? [path.join(home, 'Library', 'Application Support', 'Arc', 'User Data')]
			: [];
	const args: Parameters<typeof resolveCookiesDbFromProfileOrRoots>[0] = { roots };
	if (profile !== undefined) args.profile = profile;
	return resolveCookiesDbFromProfileOrRoots(args);
}
