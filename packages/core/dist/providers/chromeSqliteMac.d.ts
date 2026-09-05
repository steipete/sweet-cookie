import type { GetCookiesResult } from "../types.js";
import { type ChromiumProfileSelector } from "./chromium/paths.js";
export type ChromiumBrowserId = "chrome" | "brave" | "arc" | "chromium" | "dia";
export declare function getCookiesFromChromeSqliteMac(options: {
    profile?: ChromiumProfileSelector;
    includeExpired?: boolean;
    debug?: boolean;
    timeoutMs?: number;
    chromiumBrowser?: ChromiumBrowserId;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
export declare function resolveKeychainForDb(dbPath: string, chromiumBrowser?: ChromiumBrowserId): {
    account: string;
    services: string[];
    label: string;
};
//# sourceMappingURL=chromeSqliteMac.d.ts.map