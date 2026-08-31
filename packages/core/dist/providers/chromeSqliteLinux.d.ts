import type { GetCookiesOptions, GetCookiesResult } from "../types.js";
import type { ChromiumProfileSelector } from "./chromium/paths.js";
type ChromiumBrowserId = NonNullable<GetCookiesOptions["chromiumBrowser"]>;
export declare function getCookiesFromChromeSqliteLinux(options: {
    profile?: ChromiumProfileSelector;
    includeExpired?: boolean;
    debug?: boolean;
    chromiumBrowser?: ChromiumBrowserId;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
export {};
//# sourceMappingURL=chromeSqliteLinux.d.ts.map