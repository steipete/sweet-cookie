import type { GetCookiesOptions } from "../../types.js";
import { type ChromiumProfileSelector, type ResolvedCookiesDb } from "./paths.js";
type ChromiumBrowserId = NonNullable<GetCookiesOptions["chromiumBrowser"]>;
type LinuxChromiumBrowserId = Exclude<ChromiumBrowserId, "arc">;
export type ResolvedLinuxChromiumCookiesDb = ResolvedCookiesDb & {
    browser: LinuxChromiumBrowserId;
    keyringApp: LinuxChromiumBrowserId;
};
export declare function resolveLinuxChromiumCookiesDbs(options: {
    chromiumBrowser?: ChromiumBrowserId;
    profile?: ChromiumProfileSelector;
}): ResolvedLinuxChromiumCookiesDb[];
export {};
//# sourceMappingURL=linuxTargets.d.ts.map