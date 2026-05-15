import type { GetCookiesResult } from "../types.js";
import type { ChromiumProfileSelector } from "./chromium/paths.js";
export declare function getCookiesFromEdge(options: {
    profile?: ChromiumProfileSelector;
    timeoutMs?: number;
    includeExpired?: boolean;
    debug?: boolean;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=edge.d.ts.map