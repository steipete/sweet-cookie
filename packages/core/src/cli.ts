#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getCookies, toCookieHeader } from "./public.js";
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

type ParseResult =
	| { ok: true; options: CliOptions }
	| { ok: false; exitCode: number; message: string; usage?: boolean };

const USAGE = `Usage: sweet-cookie <domain-or-url> [options]

Options:
  --browser <name>              Browser source: chrome, edge, firefox, safari. Repeat or comma-separate.
  --browsers <list>             Alias for --browser.
  --format <json|header>        Output format. Default: json.
  --name <name>                 Cookie name allowlist. Repeat or comma-separate.
  --origin <url>                Extra origin to include. Repeat or comma-separate.
  --profile <value>             Shared Chromium profile selector.
  --chrome-profile <value>      Chrome profile selector/path.
  --edge-profile <value>        Edge profile selector/path.
  --firefox-profile <value>     Firefox profile selector/path.
  --safari-cookies-file <path>  Safari Cookies.binarycookies override.
  --chromium-browser <name>     macOS chrome backend target: chrome, brave, arc, chromium.
  --mode <merge|first>          Browser merge mode. Default: merge.
  --include-expired             Include expired cookies.
  --timeout-ms <ms>             OS helper timeout.
  --debug                       Emit provider debug warnings.
  --inline-file <path>          Inline cookie JSON/base64 file.
  --inline-json <json>          Inline cookie JSON payload.
  --inline-base64 <base64>      Inline cookie base64 payload.
  -h, --help                    Show this help.
`;

export function parseCliArgs(args: string[]): ParseResult {
	let target: string | undefined;
	let format: OutputFormat = "json";
	let mode: GetCookiesOptions["mode"] | undefined;
	let chromiumBrowser: GetCookiesOptions["chromiumBrowser"] | undefined;
	let includeExpired: boolean | undefined;
	let timeoutMs: number | undefined;
	let debug: boolean | undefined;
	let profile: string | undefined;
	let chromeProfile: string | undefined;
	let edgeProfile: string | undefined;
	let firefoxProfile: string | undefined;
	let safariCookiesFile: string | undefined;
	let inlineCookiesFile: string | undefined;
	let inlineCookiesJson: string | undefined;
	let inlineCookiesBase64: string | undefined;
	const browserTokens: string[] = [];
	const names: string[] = [];
	const origins: string[] = [];

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (!arg) {
			continue;
		}
		if (arg === "-h" || arg === "--help") {
			return { ok: false, exitCode: 0, message: USAGE, usage: true };
		}
		if (arg === "--include-expired") {
			includeExpired = true;
			continue;
		}
		if (arg === "--debug") {
			debug = true;
			continue;
		}
		if (arg.startsWith("--")) {
			const { name, value, consumedNext } = readOptionValue(args, i);
			if (consumedNext) {
				i += 1;
			}
			if (value === undefined) {
				return fail(`Missing value for ${name}`);
			}

			if (name === "--browser" || name === "--browsers") {
				browserTokens.push(...splitList(value));
			} else if (name === "--format") {
				if (value !== "json" && value !== "header") {
					return fail(`Invalid --format: ${value}`);
				}
				format = value;
			} else if (name === "--name") {
				names.push(...splitList(value));
			} else if (name === "--origin") {
				origins.push(...splitList(value).map(normalizeUrlInput));
			} else if (name === "--profile") {
				profile = value;
			} else if (name === "--chrome-profile") {
				chromeProfile = value;
			} else if (name === "--edge-profile") {
				edgeProfile = value;
			} else if (name === "--firefox-profile") {
				firefoxProfile = value;
			} else if (name === "--safari-cookies-file") {
				safariCookiesFile = value;
			} else if (name === "--chromium-browser") {
				if (value !== "chrome" && value !== "brave" && value !== "arc" && value !== "chromium") {
					return fail(`Invalid --chromium-browser: ${value}`);
				}
				chromiumBrowser = value;
			} else if (name === "--mode") {
				if (value !== "merge" && value !== "first") {
					return fail(`Invalid --mode: ${value}`);
				}
				mode = value;
			} else if (name === "--timeout-ms") {
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed <= 0) {
					return fail(`Invalid --timeout-ms: ${value}`);
				}
				timeoutMs = parsed;
			} else if (name === "--inline-file") {
				inlineCookiesFile = value;
			} else if (name === "--inline-json") {
				inlineCookiesJson = value;
			} else if (name === "--inline-base64") {
				inlineCookiesBase64 = value;
			} else {
				return fail(`Unknown option: ${name}`);
			}
			continue;
		}

		if (target !== undefined) {
			return fail(`Unexpected argument: ${arg}`);
		}
		target = arg;
	}

	if (!target) {
		return { ok: false, exitCode: 1, message: USAGE, usage: true };
	}

	const browsers = normalizeBrowsers(browserTokens);
	if (browsers instanceof Error) {
		return fail(browsers.message);
	}

	const options: CliOptions = {
		url: normalizeUrlInput(target),
		format,
	};
	assignIfDefined(options, "browsers", browsers);
	assignIfNonEmpty(options, "names", names);
	assignIfNonEmpty(options, "origins", origins);
	assignIfDefined(options, "profile", profile);
	assignIfDefined(options, "chromeProfile", chromeProfile);
	assignIfDefined(options, "edgeProfile", edgeProfile);
	assignIfDefined(options, "firefoxProfile", firefoxProfile);
	assignIfDefined(options, "safariCookiesFile", safariCookiesFile);
	assignIfDefined(options, "chromiumBrowser", chromiumBrowser);
	assignIfDefined(options, "mode", mode);
	assignIfDefined(options, "includeExpired", includeExpired);
	assignIfDefined(options, "timeoutMs", timeoutMs);
	assignIfDefined(options, "debug", debug);
	assignIfDefined(options, "inlineCookiesFile", inlineCookiesFile);
	assignIfDefined(options, "inlineCookiesJson", inlineCookiesJson);
	assignIfDefined(options, "inlineCookiesBase64", inlineCookiesBase64);

	return { ok: true, options };
}

export async function runCli(
	args: string[],
	io: {
		stdout: Pick<NodeJS.WriteStream, "write">;
		stderr: Pick<NodeJS.WriteStream, "write">;
	} = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
	const parsed = parseCliArgs(args);
	if (!parsed.ok) {
		const stream = parsed.exitCode === 0 || parsed.usage ? io.stdout : io.stderr;
		stream.write(parsed.message.endsWith("\n") ? parsed.message : `${parsed.message}\n`);
		return parsed.exitCode;
	}

	const { format, ...cookieOptions } = parsed.options;
	try {
		const result = await getCookies(cookieOptions);
		for (const warning of result.warnings) {
			io.stderr.write(`warning: ${warning}\n`);
		}
		io.stdout.write(`${formatCookies(result.cookies, format)}\n`);
		return 0;
	} catch (error) {
		io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}

export function formatCookies(cookies: readonly Cookie[], format: OutputFormat): string {
	if (format === "header") {
		return `Cookie: ${toCookieHeader(cookies, { dedupeByName: true })}`;
	}
	return JSON.stringify({ cookies }, null, 2);
}

function readOptionValue(
	args: string[],
	index: number,
): { name: string; value?: string; consumedNext: boolean } {
	const raw = args[index] ?? "";
	const eq = raw.indexOf("=");
	if (eq !== -1) {
		return { name: raw.slice(0, eq), value: raw.slice(eq + 1), consumedNext: false };
	}
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) {
		return { name: raw, consumedNext: false };
	}
	return { name: raw, value, consumedNext: true };
}

function normalizeUrlInput(input: string): string {
	const trimmed = input.trim();
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		return trimmed;
	}
	return `https://${trimmed}/`;
}

function splitList(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeBrowsers(tokens: string[]): BrowserName[] | undefined | Error {
	if (!tokens.length) {
		return undefined;
	}
	const browsers: BrowserName[] = [];
	for (const token of tokens) {
		const normalized = token.toLowerCase();
		if (
			normalized !== "chrome" &&
			normalized !== "edge" &&
			normalized !== "firefox" &&
			normalized !== "safari"
		) {
			return new Error(`Invalid --browser: ${token}`);
		}
		if (!browsers.includes(normalized)) {
			browsers.push(normalized);
		}
	}
	return browsers;
}

function fail(message: string): ParseResult {
	return { ok: false, exitCode: 1, message };
}

function assignIfDefined<T extends object, K extends keyof T>(
	target: T,
	key: K,
	value: T[K],
): void {
	if (value !== undefined) {
		target[key] = value;
	}
}

function assignIfNonEmpty<T extends object, K extends keyof T>(
	target: T,
	key: K,
	value: T[K],
): void {
	if (Array.isArray(value) && value.length) {
		target[key] = value;
	}
}

function isCliEntrypoint(argvPath: string | undefined): boolean {
	if (!argvPath) {
		return false;
	}
	try {
		return realpathSync(argvPath) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}

if (isCliEntrypoint(process.argv[1])) {
	process.exitCode = await runCli(process.argv.slice(2));
}
