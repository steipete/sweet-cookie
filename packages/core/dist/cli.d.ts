#!/usr/bin/env node
import type { BrowserName, Cookie, GetCookiesOptions } from "./types.js";
type OutputFormat = "json" | "header";
type CliOptions = {
    url: string;
    format: OutputFormat;
    browsers?: BrowserName[];
    names?: string[];
    origins?: string[];
    profile?: string;
    chromeProfile?: string;
    edgeProfile?: string;
    firefoxProfile?: string;
    safariCookiesFile?: string;
    chromiumBrowser?: NonNullable<GetCookiesOptions["chromiumBrowser"]>;
    mode?: NonNullable<GetCookiesOptions["mode"]>;
    includeExpired?: boolean;
    timeoutMs?: number;
    debug?: boolean;
    inlineCookiesFile?: string;
    inlineCookiesJson?: string;
    inlineCookiesBase64?: string;
};
type ParseResult = {
    ok: true;
    options: CliOptions;
} | {
    ok: false;
    exitCode: number;
    message: string;
    usage?: boolean;
};
export declare function parseCliArgs(args: string[]): ParseResult;
export declare function runCli(args: string[], io?: {
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
}): Promise<number>;
export declare function formatCookies(cookies: readonly Cookie[], format: OutputFormat): string;
export {};
//# sourceMappingURL=cli.d.ts.map