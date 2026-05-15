import { homedir } from "node:os";
import path from "node:path";

import type { Cookie, GetCookiesResult } from "../types.js";
import {
	decryptChromiumAes128CbcCookieValue,
	deriveAes128CbcKeyFromPassword,
} from "./chromeSqlite/crypto.js";
import { getCookiesFromChromeSqliteDb } from "./chromeSqlite/shared.js";
import { readKeychainGenericPasswordFirst } from "./chromium/macosKeychain.js";
import {
	resolveCookiesDbsFromProfileOrRoots,
	type ChromiumProfileSelector,
	type ResolvedCookiesDb,
} from "./chromium/paths.js";

export async function getCookiesFromEdgeSqliteMac(
	options: {
		profile?: ChromiumProfileSelector;
		includeExpired?: boolean;
		debug?: boolean;
		timeoutMs?: number;
	},
	origins: string[],
	allowlistNames: Set<string> | null,
): Promise<GetCookiesResult> {
	const dbs = resolveEdgeCookiesDbs(options.profile);
	if (!dbs.length) {
		return { cookies: [], warnings: ["Edge cookies database not found."] };
	}

	const warnings: string[] = [];

	// On macOS, Edge stores its "Safe Storage" secret in Keychain (same scheme as Chrome).
	// `security find-generic-password` is stable and avoids any native Node keychain modules.
	const passwordResult = await readKeychainGenericPasswordFirst({
		account: "Microsoft Edge",
		services: ["Microsoft Edge Safe Storage", "Microsoft Edge"],
		timeoutMs: options.timeoutMs ?? 3_000,
		label: "Microsoft Edge Safe Storage",
	});
	if (!passwordResult.ok) {
		warnings.push(passwordResult.error);
		return { cookies: [], warnings };
	}

	const edgePassword = passwordResult.password.trim();
	if (!edgePassword) {
		warnings.push("macOS Keychain returned an empty Microsoft Edge Safe Storage password.");
		return { cookies: [], warnings };
	}

	// Chromium uses PBKDF2(password, "saltysalt", 1003, 16, sha1) for AES-128-CBC cookie values on macOS.
	const key = deriveAes128CbcKeyFromPassword(edgePassword, { iterations: 1003 });
	const decrypt = (encryptedValue: Uint8Array, opts: { stripHashPrefix: boolean }): string | null =>
		decryptChromiumAes128CbcCookieValue(encryptedValue, [key], {
			stripHashPrefix: opts.stripHashPrefix,
			treatUnknownPrefixAsPlaintext: true,
		});

	const cookies: Cookie[] = [];
	for (const db of dbs) {
		const dbOptions: {
			dbPath: string;
			profile?: string;
			storeId?: string;
			includeExpired?: boolean;
			debug?: boolean;
		} = { dbPath: db.dbPath };
		if (db.profile !== undefined) {
			dbOptions.profile = db.profile;
		}
		if (db.storeId !== undefined) {
			dbOptions.storeId = db.storeId;
		}
		if (options.includeExpired !== undefined) {
			dbOptions.includeExpired = options.includeExpired;
		}
		if (options.debug !== undefined) {
			dbOptions.debug = options.debug;
		}
		const result = await getCookiesFromChromeSqliteDb(dbOptions, origins, allowlistNames, decrypt);
		warnings.push(...result.warnings);
		cookies.push(...result.cookies);
	}
	return { cookies, warnings };
}

function resolveEdgeCookiesDbs(profile?: ChromiumProfileSelector): ResolvedCookiesDb[] {
	const home = homedir();
	/* c8 ignore next */
	const roots =
		process.platform === "darwin"
			? [path.join(home, "Library", "Application Support", "Microsoft Edge")]
			: [];
	const args: Parameters<typeof resolveCookiesDbsFromProfileOrRoots>[0] = { roots };
	if (profile !== undefined) {
		args.profile = profile;
	}
	return resolveCookiesDbsFromProfileOrRoots(args);
}
