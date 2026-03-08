import type { GetCookiesResult } from '../types.js';
import type { ChromiumBrowserId } from './chromeSqliteMac.js';
export declare function getCookiesFromChrome(options: {
    profile?: string;
    timeoutMs?: number;
    includeExpired?: boolean;
    debug?: boolean;
    chromiumBrowser?: ChromiumBrowserId;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=chrome.d.ts.map