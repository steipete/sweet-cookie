import type { GetCookiesResult } from '../types.js';
export declare function getCookiesFromArc(options: {
    profile?: string;
    timeoutMs?: number;
    includeExpired?: boolean;
    debug?: boolean;
}, origins: string[], allowlistNames: Set<string> | null): Promise<GetCookiesResult>;
//# sourceMappingURL=arc.d.ts.map