import { type ChromiumProfileSelector } from "./paths.js";
export declare function resolveChromiumPathsWindows(options: {
    localAppDataVendorPath: string;
    profile?: ChromiumProfileSelector;
}): {
    dbPath: string | null;
    userDataDir: string | null;
};
export declare function resolveChromiumPathsWindowsAll(options: {
    localAppDataVendorPath: string;
    profile?: ChromiumProfileSelector;
}): Array<{
    dbPath: string;
    userDataDir: string;
    profile?: string;
}>;
//# sourceMappingURL=windowsPaths.d.ts.map