import type { GetCookiesResult } from "../types.js";
import { type ChromiumProfileSelector } from "./chromium/paths.js";
export type ChromiumBrowserId = "chrome" | "brave" | "arc" | "chromium";
export declare function getCookiesFromChromeSqliteMac(options: {
    profile?: ChromiumProfileSelector;
    includeExpired?: boolean;
    debug?: boolean;
    timeoutMs?: number;
    chromiumBrowser?: ChromiumBrowserId;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=chromeSqliteMac.d.ts.map