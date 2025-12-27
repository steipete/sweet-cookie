import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { decryptChromiumAes256GcmCookieValue } from './chromeSqlite/crypto.js';
import { getCookiesFromChromeSqliteDb } from './chromeSqlite/shared.js';
import { dpapiUnprotect } from './chromeSqlite/windowsDpapi.js';
export async function getCookiesFromChromeSqliteWindows(options, origins, allowlistNames) {
    const { dbPath, userDataDir } = resolveChromePathsWindows(options.profile);
    if (!dbPath || !userDataDir) {
        return { cookies: [], warnings: ['Chrome cookies database not found.'] };
    }
    // On Windows, Chrome stores an AES key in `Local State` encrypted with DPAPI (CurrentUser).
    // That master key is then used for AES-256-GCM cookie values (`v10`/`v11`/`v20` prefixes).
    const masterKey = await getWindowsChromeMasterKey(userDataDir);
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
    return await getCookiesFromChromeSqliteDb(dbOptions, origins, allowlistNames, decrypt);
}
async function getWindowsChromeMasterKey(userDataDir) {
    const localStatePath = path.join(userDataDir, 'Local State');
    if (!existsSync(localStatePath)) {
        return { ok: false, error: 'Chrome Local State file not found.' };
    }
    let encryptedKeyB64 = null;
    try {
        const raw = readFileSync(localStatePath, 'utf8');
        const parsed = JSON.parse(raw);
        encryptedKeyB64 =
            typeof parsed.os_crypt?.encrypted_key === 'string' ? parsed.os_crypt.encrypted_key : null;
    }
    catch (error) {
        return {
            ok: false,
            error: `Failed to parse Chrome Local State: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    if (!encryptedKeyB64)
        return { ok: false, error: 'Chrome Local State missing os_crypt.encrypted_key.' };
    let encryptedKey;
    try {
        encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
    }
    catch {
        return { ok: false, error: 'Chrome Local State contains an invalid encrypted_key.' };
    }
    const prefix = Buffer.from('DPAPI', 'utf8');
    if (!encryptedKey.subarray(0, prefix.length).equals(prefix)) {
        return { ok: false, error: 'Chrome encrypted_key does not start with DPAPI prefix.' };
    }
    const unprotected = await dpapiUnprotect(encryptedKey.subarray(prefix.length));
    if (!unprotected.ok) {
        return { ok: false, error: `DPAPI decrypt failed: ${unprotected.error}` };
    }
    return { ok: true, value: unprotected.value };
}
function resolveChromePathsWindows(profile) {
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under strict TS.
    const localAppData = process.env['LOCALAPPDATA'];
    const root = localAppData ? path.join(localAppData, 'Google', 'Chrome', 'User Data') : null;
    if (profile && looksLikePath(profile)) {
        const expanded = expandPath(profile);
        const candidates = expanded.endsWith('Cookies')
            ? [expanded]
            : [
                path.join(expanded, 'Network', 'Cookies'),
                path.join(expanded, 'Cookies'),
                path.join(expanded, 'Default', 'Network', 'Cookies'),
            ];
        for (const candidate of candidates) {
            if (!existsSync(candidate))
                continue;
            const userDataDir = findUserDataDir(candidate);
            return { dbPath: candidate, userDataDir };
        }
        if (existsSync(path.join(expanded, 'Local State'))) {
            return { dbPath: null, userDataDir: expanded };
        }
    }
    const profileDir = profile && profile.trim().length > 0 ? profile.trim() : 'Default';
    if (!root)
        return { dbPath: null, userDataDir: null };
    const candidates = [
        path.join(root, profileDir, 'Network', 'Cookies'),
        path.join(root, profileDir, 'Cookies'),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate))
            return { dbPath: candidate, userDataDir: root };
    }
    return { dbPath: null, userDataDir: root };
}
function findUserDataDir(cookiesDbPath) {
    let current = path.dirname(cookiesDbPath);
    for (let i = 0; i < 6; i += 1) {
        const localState = path.join(current, 'Local State');
        if (existsSync(localState))
            return current;
        const next = path.dirname(current);
        if (next === current)
            break;
        current = next;
    }
    return null;
}
function looksLikePath(value) {
    return value.includes('/') || value.includes('\\');
}
function expandPath(input) {
    if (input.startsWith('~/'))
        return path.join(homedir(), input.slice(2));
    return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}
//# sourceMappingURL=chromeSqliteWindows.js.map