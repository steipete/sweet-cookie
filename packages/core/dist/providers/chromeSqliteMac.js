import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execCapture } from '../util/exec.js';
import { decryptChromiumAes128CbcCookieValue, deriveAes128CbcKeyFromPassword, } from './chromeSqlite/crypto.js';
import { getCookiesFromChromeSqliteDb } from './chromeSqlite/shared.js';
export async function getCookiesFromChromeSqliteMac(options, origins, allowlistNames) {
    const dbPath = resolveChromeCookiesDb(options.profile);
    if (!dbPath) {
        return { cookies: [], warnings: ['Chrome cookies database not found.'] };
    }
    const warnings = [];
    // On macOS, Chrome stores its "Safe Storage" secret in Keychain.
    // `security find-generic-password` is stable and avoids any native Node keychain modules.
    const passwordResult = await execCapture('security', ['find-generic-password', '-w', '-a', 'Chrome', '-s', 'Chrome Safe Storage'], { timeoutMs: 3_000 });
    if (passwordResult.code !== 0) {
        warnings.push(`Failed to read macOS Keychain (Chrome Safe Storage): ${passwordResult.stderr.trim() || `exit ${passwordResult.code}`}`);
        return { cookies: [], warnings };
    }
    const chromePassword = passwordResult.stdout.trim();
    if (!chromePassword) {
        warnings.push('macOS Keychain returned an empty Chrome Safe Storage password.');
        return { cookies: [], warnings };
    }
    // Chromium uses PBKDF2(password, "saltysalt", 1003, 16, sha1) for AES-128-CBC cookie values on macOS.
    const key = deriveAes128CbcKeyFromPassword(chromePassword, { iterations: 1003 });
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
function resolveChromeCookiesDb(profile) {
    const home = homedir();
    /* c8 ignore next */
    const roots = process.platform === 'darwin'
        ? [path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')]
        : [];
    const candidates = [];
    if (profile && looksLikePath(profile)) {
        const expanded = expandPath(profile);
        const stat = safeStat(expanded);
        if (stat?.isFile())
            return expanded;
        candidates.push(path.join(expanded, 'Cookies'));
        candidates.push(path.join(expanded, 'Network', 'Cookies'));
    }
    else {
        const profileDir = profile && profile.trim().length > 0 ? profile.trim() : 'Default';
        for (const root of roots) {
            candidates.push(path.join(root, profileDir, 'Cookies'));
            candidates.push(path.join(root, profileDir, 'Network', 'Cookies'));
        }
    }
    for (const candidate of candidates) {
        if (existsSync(candidate))
            return candidate;
    }
    return null;
}
function safeStat(candidate) {
    try {
        return statSync(candidate);
    }
    catch {
        return null;
    }
}
function expandPath(input) {
    if (input.startsWith('~/'))
        return path.join(homedir(), input.slice(2));
    return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}
function looksLikePath(value) {
    return value.includes('/') || value.includes('\\');
}
//# sourceMappingURL=chromeSqliteMac.js.map