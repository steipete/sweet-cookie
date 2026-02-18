import type { GetCookiesResult } from '../types.js';
export declare function getCookiesFromChromeSqliteMac(options: {
    profile?: string;
    includeExpired?: boolean;
    debug?: boolean;
    timeoutMs?: number;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=chromeSqliteMac.d.ts.map