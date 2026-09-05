import type { GetCookiesResult } from "../types.js";
type InlineSource = {
    source: string;
    payload: string;
};
type InlineCookiesResult = GetCookiesResult & {
    excludedUnsupportedIsolation: boolean;
};
export declare function getCookiesFromInline(inline: InlineSource, origins: string[], allowlistNames: Set<string> | null): Promise<InlineCookiesResult>;
export {};
//# sourceMappingURL=inline.d.ts.map