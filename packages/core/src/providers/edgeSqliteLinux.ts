import type { Cookie, GetCookiesResult } from "../types.js";
import {
	decryptChromiumAes128CbcCookieValue,
	deriveAes128CbcKeyFromPassword,
} from "./chromeSqlite/crypto.js";
import { getLinuxChromiumSafeStoragePassword } from "./chromeSqlite/linuxKeyring.js";
import { getCookiesFromChromeSqliteDb } from "./chromeSqlite/shared.js";
import { resolveChromiumCookiesDbsLinux } from "./chromium/linuxPaths.js";
import type { ChromiumProfileSelector } from "./chromium/paths.js";

export async function getCookiesFromEdgeSqliteLinux(
	options: { profile?: ChromiumProfileSelector; includeExpired?: boolean; debug?: boolean },
	origins: string[],
	allowlistNames: Set<string> | null,
): Promise<GetCookiesResult> {
	const args: Parameters<typeof resolveChromiumCookiesDbsLinux>[0] = {
		configDirName: "microsoft-edge",
	};
	if (options.profile !== undefined) {
		args.profile = options.profile;
	}
	const dbs = resolveChromiumCookiesDbsLinux(args);
	if (!dbs.length) {
		return { cookies: [], warnings: ["Edge cookies database not found."] };
	}

	const { password, warnings: keyringWarnings } = await getLinuxChromiumSafeStoragePassword({
		app: "edge",
	});

	// Linux uses multiple schemes depending on distro/keyring availability.
	// - v10 often uses the hard-coded "peanuts" password
	// - v11 uses "<browser> Safe Storage" from the keyring (may be empty/unavailable)
	const v10Key = deriveAes128CbcKeyFromPassword("peanuts", { iterations: 1 });
	const emptyKey = deriveAes128CbcKeyFromPassword("", { iterations: 1 });
	const v11Key = deriveAes128CbcKeyFromPassword(password, { iterations: 1 });

	const decrypt = (
		encryptedValue: Uint8Array,
		opts: { stripHashPrefix: boolean },
	): string | null => {
		const prefix = Buffer.from(encryptedValue).subarray(0, 3).toString("utf8");
		if (prefix === "v10") {
			return decryptChromiumAes128CbcCookieValue(encryptedValue, [v10Key, emptyKey], {
				stripHashPrefix: opts.stripHashPrefix,
				treatUnknownPrefixAsPlaintext: false,
			});
		}
		if (prefix === "v11") {
			return decryptChromiumAes128CbcCookieValue(encryptedValue, [v11Key, emptyKey], {
				stripHashPrefix: opts.stripHashPrefix,
				treatUnknownPrefixAsPlaintext: false,
			});
		}
		return null;
	};

	const warnings = [...keyringWarnings];
	const cookies: Cookie[] = [];
	for (const db of dbs) {
		const dbOptions: {
			dbPath: string;
			profile?: string;
			includeExpired?: boolean;
			debug?: boolean;
		} = { dbPath: db.dbPath };
		if (db.profile !== undefined) {
			dbOptions.profile = db.profile;
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
