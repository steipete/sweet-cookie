import type { Cookie, GetCookiesOptions, GetCookiesResult } from "../types.js";
import {
	decryptChromiumAes128CbcCookieValue,
	deriveAes128CbcKeyFromPassword,
} from "./chromeSqlite/crypto.js";
import { getLinuxChromiumSafeStoragePassword } from "./chromeSqlite/linuxKeyring.js";
import { getCookiesFromChromeSqliteDb } from "./chromeSqlite/shared.js";
import { resolveLinuxChromiumCookiesDbs } from "./chromium/linuxTargets.js";
import type { ChromiumProfileSelector } from "./chromium/paths.js";

type ChromiumBrowserId = NonNullable<GetCookiesOptions["chromiumBrowser"]>;

export async function getCookiesFromChromeSqliteLinux(
	options: {
		profile?: ChromiumProfileSelector;
		includeExpired?: boolean;
		debug?: boolean;
		chromiumBrowser?: ChromiumBrowserId;
	},
	origins: string[],
	allowlistNames: Set<string> | null,
): Promise<GetCookiesResult> {
	const args: Parameters<typeof resolveLinuxChromiumCookiesDbs>[0] = {};
	if (options.profile !== undefined) {
		args.profile = options.profile;
	}
	if (options.chromiumBrowser !== undefined) {
		args.chromiumBrowser = options.chromiumBrowser;
	}
	const dbs = resolveLinuxChromiumCookiesDbs(args);
	if (!dbs.length) {
		return { cookies: [], warnings: ["Chrome cookies database not found."] };
	}

	const warnings: string[] = [];
	const cookies: Cookie[] = [];
	for (const db of dbs) {
		const { password, warnings: keyringWarnings } = await getLinuxChromiumSafeStoragePassword({
			app: db.keyringApp,
		});
		warnings.push(...keyringWarnings);

		// Linux uses multiple schemes depending on distro/keyring availability.
		// - v10 often uses the hard-coded "peanuts" password
		// - v11 uses the browser's "Safe Storage" entry from the keyring (may be empty/unavailable)
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

		const dbOptions: {
			dbPath: string;
			profile?: string;
			storeId?: string;
			includeExpired?: boolean;
			debug?: boolean;
		} = {
			dbPath: db.dbPath,
		};
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
