import { getCookiesFromArcSqliteMac } from './arcSqliteMac.js';
import { getCookiesFromArcSqliteWindows } from './arcSqliteWindows.js';
export async function getCookiesFromArc(options, origins, allowlistNames) {
    const warnings = [];
    // Platform dispatch only. All real logic lives in the per-OS providers.
    if (process.platform === 'darwin') {
        const r = await getCookiesFromArcSqliteMac(options, origins, allowlistNames);
        warnings.push(...r.warnings);
        const cookies = r.cookies;
        return { cookies, warnings };
    }
    if (process.platform === 'win32') {
        const r = await getCookiesFromArcSqliteWindows(options, origins, allowlistNames);
        warnings.push(...r.warnings);
        const cookies = r.cookies;
        return { cookies, warnings };
    }
    // Arc is not available on Linux
    return { cookies: [], warnings };
}
//# sourceMappingURL=arc.js.map