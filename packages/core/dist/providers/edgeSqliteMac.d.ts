import type { GetCookiesResult } from "../types.js";
import { type ChromiumProfileSelector } from "./chromium/paths.js";
export declare function getCookiesFromEdgeSqliteMac(options: {
    profile?: ChromiumProfileSelector;
    includeExpired?: boolean;
    debug?: boolean;
    timeoutMs?: number;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=edgeSqliteMac.d.ts.map