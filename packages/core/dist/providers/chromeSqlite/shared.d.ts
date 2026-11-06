import type { BrowserName, GetCookiesResult } from "../../types.js";
export declare function getCookiesFromChromeSqliteDb(options: {
    dbPath: string;
    profile?: string;
    storeId?: string;
    includeExpired?: boolean;
    debug?: boolean;
    browser?: BrowserName;
}, origins: string[], allowlistNames: Set<string> | null, decrypt: (encryptedValue: Uint8Array, options: {
    stripHashPrefix: boolean;
}) => string | null): Promise<GetCookiesResult>;
//# sourceMappingURL=shared.d.ts.map