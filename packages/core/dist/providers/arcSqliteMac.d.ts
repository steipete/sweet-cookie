import type { GetCookiesResult } from '../types.js';
export declare function getCookiesFromArcSqliteMac(options: {
    profile?: string;
    includeExpired?: boolean;
    debug?: boolean;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=arcSqliteMac.d.ts.map