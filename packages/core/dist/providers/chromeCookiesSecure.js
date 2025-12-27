import { normalizeExpiration } from '../util/expire.js';
export async function getCookiesFromChrome(options, origins, allowlistNames) {
    const warnings = [];
    if (process.platform === 'win32') {
        warnings.push('Windows note: chrome-cookies-secure may fail on app-bound cookies (e.g. newer Chrome "v20" values). Prefer Sweet Cookie extension exports for those sessions.');
    }
    let mod;
    try {
        const imported = (await import('chrome-cookies-secure'));
        mod = (imported.default ?? imported);
        if (typeof mod.getCookiesPromised !== 'function') {
            warnings.push('chrome-cookies-secure does not expose getCookiesPromised().');
            return { cookies: [], warnings };
        }
    }
    catch (error) {
        if (isMissingChromeCookiesSecureModule(error)) {
            // Optional dependency; caller may fall back to other providers.
            return { cookies: [], warnings };
        }
        warnings.push(`Failed to load chrome-cookies-secure: ${error instanceof Error ? error.message : String(error)}`);
        return { cookies: [], warnings };
    }
    const cookies = [];
    for (const origin of origins) {
        const result = await settleWithTimeout(Promise.resolve(mod.getCookiesPromised(origin, 'puppeteer', options.profile)), options.timeoutMs ?? 5_000).catch((error) => {
            warnings.push(`Chrome cookie read failed for ${origin}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        });
        if (!result)
            continue;
        if (!Array.isArray(result))
            continue;
        for (const raw of result) {
            const normalized = normalizeChromeCookie(raw, origin, options.profile);
            if (!normalized)
                continue;
            if (allowlistNames && allowlistNames.size > 0 && !allowlistNames.has(normalized.name))
                continue;
            if (!options.includeExpired && isExpired(normalized.expires))
                continue;
            cookies.push(normalized);
        }
    }
    return { cookies: dedupeCookies(cookies), warnings };
}
function isMissingChromeCookiesSecureModule(error) {
    if (!error || typeof error !== 'object')
        return false;
    const code = Reflect.get(error, 'code');
    if (code !== 'ERR_MODULE_NOT_FOUND')
        return false;
    const message = Reflect.get(error, 'message');
    if (typeof message !== 'string')
        return false;
    return message.includes('chrome-cookies-secure');
}
function normalizeChromeCookie(raw, origin, profile) {
    if (!raw || typeof raw !== 'object')
        return null;
    const cookie = raw;
    const name = typeof cookie.name === 'string' ? cookie.name : null;
    const value = typeof cookie.value === 'string' ? cookie.value : null;
    if (!name || value === null)
        return null;
    const domainRaw = typeof cookie.domain === 'string' ? cookie.domain : undefined;
    const domain = domainRaw?.startsWith('.') ? domainRaw.slice(1) : domainRaw;
    const pathValue = typeof cookie.path === 'string' ? cookie.path : '/';
    const expires = normalizeExpiration(typeof cookie.expires === 'number' ? cookie.expires : undefined);
    const isSecureByDefault = new URL(origin).protocol === 'https:';
    const secure = typeof cookie.Secure === 'boolean'
        ? cookie.Secure
        : typeof cookie.secure === 'boolean'
            ? cookie.secure
            : isSecureByDefault;
    const httpOnly = typeof cookie.HttpOnly === 'boolean'
        ? cookie.HttpOnly
        : typeof cookie.httpOnly === 'boolean'
            ? cookie.httpOnly
            : false;
    const sameSite = normalizeSameSite(cookie.sameSite);
    const source = { browser: 'chrome', origin };
    if (profile)
        source.profile = profile;
    const normalized = {
        name,
        value,
        domain: domain ?? new URL(origin).hostname,
        path: pathValue,
        secure,
        httpOnly,
    };
    if (expires !== undefined)
        normalized.expires = expires;
    if (sameSite !== undefined)
        normalized.sameSite = sameSite;
    normalized.source = source;
    return normalized;
}
function normalizeSameSite(value) {
    if (value === 'Strict' || value === 'Lax' || value === 'None')
        return value;
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.toLowerCase();
    if (normalized === 'strict')
        return 'Strict';
    if (normalized === 'lax')
        return 'Lax';
    if (normalized === 'none' || normalized === 'no_restriction')
        return 'None';
    return undefined;
}
function isExpired(expires) {
    if (!expires)
        return false;
    const now = Math.floor(Date.now() / 1000);
    return expires > 0 && expires < now;
}
function dedupeCookies(cookies) {
    const merged = new Map();
    for (const cookie of cookies) {
        const key = `${cookie.name}|${cookie.domain ?? ''}|${cookie.path ?? ''}`;
        if (!merged.has(key))
            merged.set(key, cookie);
    }
    return Array.from(merged.values());
}
function settleWithTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
//# sourceMappingURL=chromeCookiesSecure.js.map