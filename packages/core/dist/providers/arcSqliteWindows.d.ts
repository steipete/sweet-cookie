import type { GetCookiesResult } from '../types.js';
export declare function getCookiesFromArcSqliteWindows(options: {
    profile?: string;
    includeExpired?: boolean;
    debug?: boolean;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=arcSqliteWindows.d.ts.map