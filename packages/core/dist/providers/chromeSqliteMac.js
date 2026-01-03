import { homedir } from 'node:os';
import path from 'node:path';
import { decryptChromiumAes128CbcCookieValue, deriveAes128CbcKeyFromPassword, } from './chromeSqlite/crypto.js';
import { getCookiesFromChromeSqliteDb } from './chromeSqlite/shared.js';
import { readKeychainGenericPasswordFirst } from './chromium/macosKeychain.js';
import { resolveCookiesDbFromProfileOrRoots } from './chromium/paths.js';
// Chromium-based browsers and their keychain entries (tried in order)
const CHROMIUM_BROWSERS = [
    {
        id: 'chrome',
        name: 'Chrome',
        root: 'Google/Chrome',
        service: 'Chrome Safe Storage',
        account: 'Chrome',
    },
    {
        id: 'brave',
        name: 'Brave',
        root: 'BraveSoftware/Brave-Browser',
        service: 'Brave Safe Storage',
        account: 'Brave',
    },
    {
        id: 'arc',
        name: 'Arc',
        root: 'Arc/User Data',
        service: 'Arc Safe Storage',
        account: 'Arc',
    },
    {
        id: 'chromium',
        name: 'Chromium',
        root: 'Chromium',
        service: 'Chromium Safe Storage',
        account: 'Chromium',
    },
];
export async function getCookiesFromChromeSqliteMac(options, origins, allowlistNames) {
    const allWarnings = [];
    // If a specific Chromium browser is requested, only try that one
    const browsersToTry = options.chromiumBrowser
        ? CHROMIUM_BROWSERS.filter((b) => b.id === options.chromiumBrowser)
        : CHROMIUM_BROWSERS;
    // Try each Chromium browser in order until we find cookies
    for (const browser of browsersToTry) {
        if (options.debug) {
            allWarnings.push(`[debug] Trying ${browser.name}...`);
        }
        const result = await tryChromiumBrowser(browser, options, origins, allowlistNames);
        if (options.debug && result.warnings.length > 0) {
            allWarnings.push(...result.warnings.map((w) => `[${browser.name}] ${w}`));
        }
        if (result.cookies.length > 0) {
            result.warnings.unshift(...allWarnings);
            return result;
        }
    }
    // If no cookies found, return all accumulated warnings
    return { cookies: [], warnings: allWarnings };
}
async function tryChromiumBrowser(browser, options, origins, allowlistNames) {
    const dbPath = resolveChromiumCookiesDb(browser.root, options.profile);
    if (!dbPath) {
        return { cookies: [], warnings: [] };
    }
    const warnings = [];
    // On macOS, Chromium browsers store their "Safe Storage" secret in Keychain.
    // `security find-generic-password` is stable and avoids any native Node keychain modules.
    const passwordResult = await readKeychainGenericPasswordFirst({
        account: browser.account,
        services: [browser.service],
        timeoutMs: options.timeoutMs ?? 3_000,
        label: browser.service,
    });
    if (!passwordResult.ok) {
        warnings.push(passwordResult.error);
        return { cookies: [], warnings };
    }
    const browserPassword = passwordResult.password.trim();
    if (!browserPassword) {
        warnings.push(`macOS Keychain returned an empty ${browser.service} password.`);
        return { cookies: [], warnings };
    }
    // Chromium uses PBKDF2(password, "saltysalt", 1003, 16, sha1) for AES-128-CBC cookie values on macOS.
    const key = deriveAes128CbcKeyFromPassword(browserPassword, { iterations: 1003 });
    const decrypt = (encryptedValue, opts) => decryptChromiumAes128CbcCookieValue(encryptedValue, [key], {
        stripHashPrefix: opts.stripHashPrefix,
        treatUnknownPrefixAsPlaintext: true,
    });
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
    result.warnings.unshift(...warnings);
    return result;
}
function resolveChromiumCookiesDb(browserRoot, profile) {
    const home = homedir();
    /* c8 ignore next */
    const roots = process.platform === 'darwin'
        ? [path.join(home, 'Library', 'Application Support', browserRoot)]
        : [];
    const args = { roots };
    if (profile !== undefined)
        args.profile = profile;
    return resolveCookiesDbFromProfileOrRoots(args);
}
// Keep for backwards compatibility
function resolveChromeCookiesDb(profile) {
    return resolveChromiumCookiesDb('Google/Chrome', profile);
}
//# sourceMappingURL=chromeSqliteMac.js.map