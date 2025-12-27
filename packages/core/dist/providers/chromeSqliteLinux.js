import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { decryptChromiumAes128CbcCookieValue, deriveAes128CbcKeyFromPassword, } from './chromeSqlite/crypto.js';
import { getLinuxChromeSafeStoragePassword } from './chromeSqlite/linuxKeyring.js';
import { getCookiesFromChromeSqliteDb } from './chromeSqlite/shared.js';
export async function getCookiesFromChromeSqliteLinux(options, origins, allowlistNames) {
    const dbPath = resolveChromeCookiesDbLinux(options.profile);
    if (!dbPath) {
        return { cookies: [], warnings: ['Chrome cookies database not found.'] };
    }
    const { password, warnings: keyringWarnings } = await getLinuxChromeSafeStoragePassword();
    // Linux uses multiple schemes depending on distro/keyring availability.
    // - v10 often uses the hard-coded "peanuts" password
    // - v11 uses "Chrome Safe Storage" from the keyring (may be empty/unavailable)
    const v10Key = deriveAes128CbcKeyFromPassword('peanuts', { iterations: 1 });
    const emptyKey = deriveAes128CbcKeyFromPassword('', { iterations: 1 });
    const v11Key = deriveAes128CbcKeyFromPassword(password, { iterations: 1 });
    const decrypt = (encryptedValue, opts) => {
        const prefix = Buffer.from(encryptedValue).subarray(0, 3).toString('utf8');
        if (prefix === 'v10') {
            return decryptChromiumAes128CbcCookieValue(encryptedValue, [v10Key, emptyKey], {
                stripHashPrefix: opts.stripHashPrefix,
                treatUnknownPrefixAsPlaintext: false,
            });
        }
        if (prefix === 'v11') {
            return decryptChromiumAes128CbcCookieValue(encryptedValue, [v11Key, emptyKey], {
                stripHashPrefix: opts.stripHashPrefix,
                treatUnknownPrefixAsPlaintext: false,
            });
        }
        return null;
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
    result.warnings.unshift(...keyringWarnings);
    return result;
}
function resolveChromeCookiesDbLinux(profile) {
    const home = homedir();
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under strict TS.
    const configHome = process.env['XDG_CONFIG_HOME']?.trim() || path.join(home, '.config');
    const root = path.join(configHome, 'google-chrome');
    if (profile && looksLikePath(profile)) {
        const candidate = expandPath(profile, home);
        if (candidate.endsWith('Cookies') && existsSync(candidate))
            return candidate;
        const direct = path.join(candidate, 'Cookies');
        if (existsSync(direct))
            return direct;
        const network = path.join(candidate, 'Network', 'Cookies');
        if (existsSync(network))
            return network;
        return null;
    }
    const profileDir = profile && profile.trim().length > 0 ? profile.trim() : 'Default';
    const candidates = [
        path.join(root, profileDir, 'Cookies'),
        path.join(root, profileDir, 'Network', 'Cookies'),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate))
            return candidate;
    }
    return null;
}
function looksLikePath(value) {
    return value.includes('/') || value.includes('\\');
}
function expandPath(input, home) {
    if (input.startsWith('~/'))
        return path.join(home, input.slice(2));
    return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}
//# sourceMappingURL=chromeSqliteLinux.js.map