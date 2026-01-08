import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { decryptChromiumAes256GcmCookieValue } from './chromeSqlite/crypto.js';
import { getCookiesFromChromeSqliteDb } from './chromeSqlite/shared.js';
import { getWindowsChromiumMasterKey } from './chromium/windowsMasterKey.js';
import { resolveChromiumPathsWindows } from './chromium/windowsPaths.js';
export async function getCookiesFromArcSqliteWindows(options, origins, allowlistNames) {
    const storeVendorPath = findArcWindowsStoreVendorPath();
    if (!storeVendorPath) {
        return { cookies: [], warnings: ['Arc cookies database not found.'] };
    }
    const resolveArgs = {
        // Arc on Windows stores data in %LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_*\LocalCache\Local\Arc\User Data
        localAppDataVendorPath: storeVendorPath,
    };
    if (options.profile !== undefined)
        resolveArgs.profile = options.profile;
    const { dbPath, userDataDir } = resolveChromiumPathsWindows(resolveArgs);
    if (!dbPath || !userDataDir) {
        return { cookies: [], warnings: ['Arc cookies database not found.'] };
    }
    // On Windows, Arc stores an AES key in `Local State` encrypted with DPAPI (CurrentUser).
    // That master key is then used for AES-256-GCM cookie values (`v10`/`v11`/`v20` prefixes).
    const masterKey = await getWindowsChromiumMasterKey(userDataDir, 'Arc');
    if (!masterKey.ok) {
        return { cookies: [], warnings: [masterKey.error] };
    }
    const decrypt = (encryptedValue, opts) => {
        return decryptChromiumAes256GcmCookieValue(encryptedValue, masterKey.value, {
            stripHashPrefix: opts.stripHashPrefix,
        });
    };
    const dbOptions = {
        dbPath,
    };
    if (options.profile)
        dbOptions.profile = options.profile;
    if (options.includeExpired !== undefined)
        dbOptions.includeExpired = options.includeExpired;
    if (options.debug !== undefined)
        dbOptions.debug = options.debug;
    const result = await getCookiesFromChromeSqliteDb(dbOptions, origins, allowlistNames, decrypt);
    // Update source to indicate Arc browser
    for (const cookie of result.cookies) {
        if (cookie.source) {
            cookie.source.browser = 'arc';
        }
    }
    return result;
}
function findArcWindowsStoreVendorPath() {
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under strict TS.
    const localAppData = process.env['LOCALAPPDATA'];
    if (!localAppData)
        return null;
    const packagesDir = path.join(localAppData, 'Packages');
    if (!existsSync(packagesDir))
        return null;
    const entries = readdirSync(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('TheBrowserCompany.Arc_'))
            continue;
        const userDataDir = path.join(packagesDir, entry.name, 'LocalCache', 'Local', 'Arc', 'User Data');
        if (!existsSync(userDataDir))
            continue;
        return path.relative(localAppData, userDataDir);
    }
    return null;
}
//# sourceMappingURL=arcSqliteWindows.js.map