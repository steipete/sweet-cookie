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

const DEFAULT_CHROMIUM_KEYCHAIN = {
	account: 'Chrome',
	services: ['Chrome Safe Storage'],
	label: 'Chrome Safe Storage',
};

const CHROMIUM_BROWSER_TARGETS = [
	{
		id: 'chrome' as const,
		root: 'Google/Chrome',
		keychain: DEFAULT_CHROMIUM_KEYCHAIN,
	},
	{
		id: 'brave' as const,
		root: 'BraveSoftware/Brave-Browser',
		keychain: {
			account: 'Brave',
			services: ['Brave Safe Storage'],
			label: 'Brave Safe Storage',
		},
	},
	{
		id: 'arc' as const,
		root: 'Arc/User Data',
		keychain: {
			account: 'Arc',
			services: ['Arc Safe Storage'],
			label: 'Arc Safe Storage',
		},
	},
	{
		id: 'chromium' as const,
		root: 'Chromium',
		keychain: {
			account: 'Chromium',
			services: ['Chromium Safe Storage'],
			label: 'Chromium Safe Storage',
		},
	},
];

export type ChromiumBrowserId = 'chrome' | 'brave' | 'arc' | 'chromium';

export async function getCookiesFromChromeSqliteMac(
	options: {
		profile?: string;
		includeExpired?: boolean;
		debug?: boolean;
		timeoutMs?: number;
		chromiumBrowser?: ChromiumBrowserId;
	},
	origins: string[],
	allowlistNames: Set<string> | null
): Promise<GetCookiesResult> {
	const dbPath = resolveChromeCookiesDb(options.profile, options.chromiumBrowser);
	if (!dbPath) {
		return { cookies: [], warnings: ['Chrome cookies database not found.'] };
	}

	const warnings: string[] = [];
	// On macOS, Chromium stores its "Safe Storage" secret in Keychain.
	// `security find-generic-password` is stable and avoids any native Node keychain modules.
	const keychain = resolveKeychainForDb(dbPath);
	const passwordResult = await readKeychainGenericPasswordFirst({
		account: keychain.account,
		services: keychain.services,
		timeoutMs: options.timeoutMs ?? 3_000,
		label: keychain.label,
	});
	if (!passwordResult.ok) {
		warnings.push(passwordResult.error);
		return { cookies: [], warnings };
	}

	const chromePassword = passwordResult.password.trim();
	if (!chromePassword) {
		warnings.push(`macOS Keychain returned an empty ${keychain.label} password.`);
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

function resolveKeychainForDb(dbPath: string): {
	account: string;
	services: string[];
	label: string;
} {
	const lower = dbPath.toLowerCase();
	for (const target of CHROMIUM_BROWSER_TARGETS) {
		if (lower.includes(target.root.toLowerCase())) {
			return target.keychain;
		}
	}
	return DEFAULT_CHROMIUM_KEYCHAIN;
}

function resolveChromeCookiesDb(
	profile?: string,
	chromiumBrowser?: ChromiumBrowserId
): string | null {
	const home = homedir();
	const selectedTargets = chromiumBrowser
		? CHROMIUM_BROWSER_TARGETS.filter((target) => target.id === chromiumBrowser)
		: CHROMIUM_BROWSER_TARGETS.filter((target) => target.id === 'chrome' || target.id === 'brave');
	/* c8 ignore next */
	const roots =
		process.platform === 'darwin'
			? selectedTargets.map((target) =>
					path.join(home, 'Library', 'Application Support', ...target.root.split('/'))
				)
			: [];
	const args: Parameters<typeof resolveCookiesDbFromProfileOrRoots>[0] = { roots };
	if (profile !== undefined) args.profile = profile;
	return resolveCookiesDbFromProfileOrRoots(args);
}
