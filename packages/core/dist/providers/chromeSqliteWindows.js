import path from "node:path";
import { decryptChromiumAes256GcmCookieValue } from "./chromeSqlite/crypto.js";
import { getCookiesFromChromeSqliteDb } from "./chromeSqlite/shared.js";
import { getWindowsChromiumMasterKey } from "./chromium/windowsMasterKey.js";
import { resolveChromiumPathsWindowsAll } from "./chromium/windowsPaths.js";
export async function getCookiesFromChromeSqliteWindows(options, origins, allowlistNames) {
    const resolveArgs = {
        localAppDataVendorPath: path.join("Google", "Chrome", "User Data"),
    };
    if (options.profile !== undefined) {
        resolveArgs.profile = options.profile;
    }
    const dbs = resolveChromiumPathsWindowsAll(resolveArgs);
    if (!dbs.length) {
        return { cookies: [], warnings: ["Chrome cookies database not found."] };
    }
    const warnings = [];
    const cookies = [];
    for (const db of dbs) {
        // On Windows, Chrome stores an AES key in `Local State` encrypted with DPAPI (CurrentUser).
        // That master key decrypts classic AES-256-GCM values (`v10`/`v11`); App-Bound `v20`
        // cookies may fail and are reported by the shared collector.
        const masterKey = await getWindowsChromiumMasterKey(db.userDataDir, "Chrome");
        if (!masterKey.ok) {
            warnings.push(masterKey.error);
            continue;
        }
        const decrypt = (encryptedValue, opts) => {
            return decryptChromiumAes256GcmCookieValue(encryptedValue, masterKey.value, {
                stripHashPrefix: opts.stripHashPrefix,
            });
        };
        const dbOptions = {
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
//# sourceMappingURL=chromeSqliteWindows.js.map