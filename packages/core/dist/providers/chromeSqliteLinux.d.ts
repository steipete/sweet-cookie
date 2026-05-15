import type { GetCookiesResult } from "../types.js";
import type { ChromiumProfileSelector } from "./chromium/paths.js";
export declare function getCookiesFromChromeSqliteLinux(options: {
    profile?: ChromiumProfileSelector;
    includeExpired?: boolean;
    debug?: boolean;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=chromeSqliteLinux.d.ts.map