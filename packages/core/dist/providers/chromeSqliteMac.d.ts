import type { GetCookiesResult } from '../types.js';
export type ChromiumBrowserId = 'chrome' | 'brave' | 'arc' | 'chromium';
export declare function getCookiesFromChromeSqliteMac(options: {
    profile?: string;
    includeExpired?: boolean;
    debug?: boolean;
    timeoutMs?: number;
    chromiumBrowser?: ChromiumBrowserId;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=chromeSqliteMac.d.ts.map