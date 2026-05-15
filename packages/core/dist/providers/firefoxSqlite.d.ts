import { ALL_PROFILES, type GetCookiesResult } from "../types.js";
export declare function getCookiesFromFirefox(options: {
    profile?: string | typeof ALL_PROFILES;
    includeExpired?: boolean;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=firefoxSqlite.d.ts.map