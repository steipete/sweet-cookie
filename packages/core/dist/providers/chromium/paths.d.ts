export type ResolvedCookiesDb = {
    dbPath: string;
    profile?: string;
};
export declare const ALL_CHROMIUM_PROFILES: unique symbol;
export type ChromiumProfileSelector = string | typeof ALL_CHROMIUM_PROFILES;
export declare function looksLikePath(value: string): boolean;
export declare function expandPath(input: string): string;
export declare function safeStat(candidate: string): {
    isFile: () => boolean;
    isDirectory: () => boolean;
} | null;
export declare function resolveCookiesDbFromProfileOrRoots(options: {
    profile?: ChromiumProfileSelector;
    roots: string[];
}): string | null;
export declare function resolveCookiesDbsFromProfileOrRoots(options: {
    profile?: ChromiumProfileSelector;
    roots: string[];
    cookieStoreOrder?: "legacy-first" | "network-first";
}): ResolvedCookiesDb[];
export declare function profileNameFromDbPath(dbPath: string): string | undefined;
//# sourceMappingURL=paths.d.ts.map