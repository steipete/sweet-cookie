import { getCookiesFromChrome } from "./providers/chrome.js";
import { getCookiesFromEdge } from "./providers/edge.js";
import { getCookiesFromFirefox } from "./providers/firefoxSqlite.js";
import { getCookiesFromInline } from "./providers/inline.js";
import { getCookiesFromSafari } from "./providers/safariBinaryCookies.js";
import { ALL_PROFILES } from "./types.js";
import { ALL_CHROMIUM_PROFILES } from "./providers/chromium/paths.js";
import type {
	BrowserName,
	Cookie,
	CookieHeaderOptions,
	GetCookiesOptions,
	GetCookiesResult,
	PathType,
	ProfileType,
} from "./types.js";
import { normalizeOrigins } from "./util/origins.js";

const DEFAULT_BROWSERS: BrowserName[] = ["chrome", "safari", "firefox"];

/**
 * Read cookies for a URL from one or more browser backends (and/or inline payloads).
 *
 * Supported backends:
 * - `chrome`: macOS / Windows / Linux (Chromium-based; default discovery targets Google Chrome paths, and on macOS also checks Brave roots)
 * - `edge`: macOS / Windows / Linux (Chromium-based; default discovery targets Microsoft Edge paths)
 * - `firefox`: macOS / Windows / Linux
 * - `safari`: macOS only (`Cookies.binarycookies`)
 *
 * Runtime requirements:
 * - Node >= 22 (uses `node:sqlite`) or Bun (uses `bun:sqlite`)
 *
 * The function returns `{ cookies, warnings }`:
 * - `cookies`: best-effort results, filtered by `url`/`origins` and optional `names` allowlist
 * - `warnings`: non-fatal diagnostics (no raw cookie values)
 */
export async function getCookies(options: GetCookiesOptions): Promise<GetCookiesResult> {
	const warnings: string[] = [];
	const url = options.url;
	const origins = normalizeOrigins(url, options.origins);
	if (origins.length === 0) {
		return { cookies: [], warnings };
	}
	const names = normalizeNames(options.names);
	let browsers: BrowserName[];
	if (Array.isArray(options.browsers) && options.browsers.length > 0) {
		browsers = options.browsers;
	} else {
		browsers = parseBrowsersEnv() ?? DEFAULT_BROWSERS;
	}
	const mode = options.mode ?? parseModeEnv() ?? "merge";

	const inlineSources = await resolveInlineSources(options);
	// Inline sources are the most reliable path (they bypass DB locks + keychain prompts).
	// We short-circuit on the first inline source that yields any cookies.
	for (const source of inlineSources) {
		const inlineResult = await getCookiesFromInline(source, origins, names);
		warnings.push(...inlineResult.warnings);
		if (inlineResult.cookies.length) {
			return { cookies: inlineResult.cookies, warnings };
		}
	}

	const merged = new Map<string, Cookie>();
	const mergedPrimaryKeys = new Set<string>();

	for (const browser of browsers) {
		let result: GetCookiesResult;
		if (browser === "chrome") {
			const chromeOptions: Parameters<typeof getCookiesFromChrome>[0] = {};
			const chromeProfile =
				options.chromeProfile ?? options.profile ?? readEnv("SWEET_COOKIE_CHROME_PROFILE");
			if (options.timeoutMs !== undefined) {
				chromeOptions.timeoutMs = options.timeoutMs;
			}
			if (options.includeExpired !== undefined) {
				chromeOptions.includeExpired = options.includeExpired;
			}
			if (options.debug !== undefined) {
				chromeOptions.debug = options.debug;
			}
			if (options.chromiumBrowser !== undefined) {
				chromeOptions.chromiumBrowser = options.chromiumBrowser;
			}

			result = await collectProfileResults((profile) => {
				const profileOptions = { ...chromeOptions };
				if (profile !== undefined) {
					profileOptions.profile = profile === ALL_PROFILES ? ALL_CHROMIUM_PROFILES : profile;
				}
				return getCookiesFromChrome(profileOptions, origins, names);
			}, chromeProfile);
		} else if (browser === "edge") {
			const edgeOptions: Parameters<typeof getCookiesFromEdge>[0] = {};
			const edgeProfile =
				options.edgeProfile ??
				options.profile ??
				readEnv("SWEET_COOKIE_EDGE_PROFILE") ??
				readEnv("SWEET_COOKIE_CHROME_PROFILE");
			if (options.timeoutMs !== undefined) {
				edgeOptions.timeoutMs = options.timeoutMs;
			}
			if (options.includeExpired !== undefined) {
				edgeOptions.includeExpired = options.includeExpired;
			}
			if (options.debug !== undefined) {
				edgeOptions.debug = options.debug;
			}

			result = await collectProfileResults((profile) => {
				const profileOptions = { ...edgeOptions };
				if (profile !== undefined) {
					profileOptions.profile = profile === ALL_PROFILES ? ALL_CHROMIUM_PROFILES : profile;
				}
				return getCookiesFromEdge(profileOptions, origins, names);
			}, edgeProfile);
		} else if (browser === "firefox") {
			const firefoxOptions: Parameters<typeof getCookiesFromFirefox>[0] = {};
			const firefoxProfile = options.firefoxProfile ?? readEnv("SWEET_COOKIE_FIREFOX_PROFILE");
			if (options.includeExpired !== undefined) {
				firefoxOptions.includeExpired = options.includeExpired;
			}

			result = await collectProfileResults((profile) => {
				const profileOptions = { ...firefoxOptions };
				if (profile !== undefined) {
					profileOptions.profile = profile;
				}
				return getCookiesFromFirefox(profileOptions, origins, names);
			}, firefoxProfile);
		} else {
			const safariOptions: Parameters<typeof getCookiesFromSafari>[0] = {};
			if (options.includeExpired !== undefined) {
				safariOptions.includeExpired = options.includeExpired;
			}

			const safariWarnings: string[] = [];
			const safariCookies = new Map<string, Cookie>();
			for (const file of normalizePathSelectors(options.safariCookiesFile)) {
				const fileOptions = { ...safariOptions };
				if (file !== undefined) {
					fileOptions.file = file;
				}
				const safariResult = await getCookiesFromSafari(fileOptions, origins, names);
				safariWarnings.push(...safariResult.warnings);
				for (const cookie of safariResult.cookies) {
					const key = `${cookie.name}|${cookie.domain ?? ""}|${cookie.path ?? ""}`;
					if (!safariCookies.has(key)) {
						safariCookies.set(key, cookie);
					}
				}
			}
			result = { cookies: Array.from(safariCookies.values()), warnings: safariWarnings };
		}

		warnings.push(...result.warnings);

		if (mode === "first" && result.cookies.length) {
			// "first" returns the first backend that produced anything (plus accumulated warnings).
			return { cookies: result.cookies, warnings };
		}

		const primaryKeysBeforeBrowser = new Set(mergedPrimaryKeys);
		const primaryKeysFromBrowser = new Set<string>();
		for (const cookie of result.cookies) {
			const primaryKey = mergeCookieKey(cookie, {
				includeProfileInKey: false,
				includeStoreInKey: false,
			});
			primaryKeysFromBrowser.add(primaryKey);
			if (primaryKeysBeforeBrowser.has(primaryKey)) {
				continue;
			}
			const storageKey = mergeCookieKey(cookie, {
				includeProfileInKey: true,
				includeStoreInKey: true,
			});
			if (!merged.has(storageKey)) {
				merged.set(storageKey, cookie);
			}
		}
		for (const key of primaryKeysFromBrowser) {
			mergedPrimaryKeys.add(key);
		}
	}

	return { cookies: Array.from(merged.values()), warnings };
}

function mergeCookieKey(
	cookie: Cookie,
	options: { includeProfileInKey: boolean; includeStoreInKey: boolean },
): string {
	const domain = cookie.domain ?? "";
	const pathValue = cookie.path ?? "";
	const profile = options.includeProfileInKey ? (cookie.source?.profile ?? "") : "";
	const storeId = options.includeStoreInKey ? (cookie.source?.storeId ?? "") : "";
	return `${cookie.name}|${domain}|${pathValue}|${profile}|${storeId}`;
}

async function collectProfileResults(
	readProfile: (profile: string | typeof ALL_PROFILES | undefined) => Promise<GetCookiesResult>,
	profile: ProfileType | undefined,
): Promise<GetCookiesResult> {
	const selectors = normalizeProfileSelectors(profile);
	const warnings: string[] = [];
	const merged = new Map<string, Cookie>();
	const includeProfileInKey = selectors.length > 1 || selectors[0] === ALL_PROFILES;

	for (const selector of selectors) {
		const result = await readProfile(selector);
		warnings.push(...result.warnings);
		for (const cookie of result.cookies) {
			const profileKey = includeProfileInKey ? (cookie.source?.profile ?? "") : "";
			const storeKey = cookie.source?.storeId ?? "";
			const key = `${cookie.name}|${cookie.domain ?? ""}|${cookie.path ?? ""}|${profileKey}|${storeKey}`;
			if (!merged.has(key)) {
				merged.set(key, cookie);
			}
		}
	}

	return { cookies: Array.from(merged.values()), warnings };
}

function normalizeProfileSelectors(
	profile: ProfileType | undefined,
): Array<string | typeof ALL_PROFILES | undefined> {
	if (profile === undefined) {
		return [undefined];
	}
	if (profile === ALL_PROFILES) {
		return [ALL_PROFILES];
	}
	if (Array.isArray(profile)) {
		const cleaned = profile.map((value) => value.trim()).filter(Boolean);
		return cleaned.length ? cleaned : [undefined];
	}
	const cleaned = profile.trim();
	return cleaned ? [cleaned] : [undefined];
}

function normalizePathSelectors(pathValue: PathType | undefined): Array<string | undefined> {
	if (pathValue === undefined) {
		return [undefined];
	}
	if (Array.isArray(pathValue)) {
		const cleaned = pathValue.map((value) => value.trim()).filter(Boolean);
		return cleaned.length ? cleaned : [undefined];
	}
	const cleaned = pathValue.trim();
	return cleaned ? [cleaned] : [undefined];
}

/**
 * Convert cookies to an HTTP `Cookie` header value.
 *
 * This is a helper for typical Node fetch clients / HTTP libraries.
 * It does not validate cookie RFC edge cases; it simply joins `name=value` pairs.
 */
export function toCookieHeader(
	cookies: readonly Cookie[],
	options: CookieHeaderOptions = {},
): string {
	const sort = options.sort ?? "name";
	const dedupeByName = options.dedupeByName ?? false;

	const items = cookies
		.filter((cookie) => cookie?.name && typeof cookie.value === "string")
		.map((cookie) => ({ name: cookie.name, value: cookie.value }));

	const ordered =
		sort === "name" ? items.slice().sort((a, b) => a.name.localeCompare(b.name)) : items;

	if (!dedupeByName) {
		return ordered.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
	}

	const seen = new Set<string>();
	const deduped: { name: string; value: string }[] = [];
	for (const cookie of ordered) {
		const key = cookie.name;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(cookie);
	}

	return deduped.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function normalizeNames(names?: string[]): Set<string> | null {
	if (!names?.length) {
		return null;
	}
	const cleaned = names.map((n) => n.trim()).filter(Boolean);
	if (!cleaned.length) {
		return null;
	}
	return new Set(cleaned);
}

async function resolveInlineSources(
	options: GetCookiesOptions,
): Promise<Array<{ source: string; payload: string }>> {
	const sources: Array<{ source: string; payload: string }> = [];
	if (options.inlineCookiesJson) {
		sources.push({ source: "inline-json", payload: options.inlineCookiesJson });
	}
	if (options.inlineCookiesBase64) {
		sources.push({ source: "inline-base64", payload: options.inlineCookiesBase64 });
	}
	if (options.inlineCookiesFile) {
		sources.push({ source: "inline-file", payload: options.inlineCookiesFile });
	}

	return sources;
}

function parseBrowsersEnv(): GetCookiesOptions["browsers"] | undefined {
	const raw = readEnv("SWEET_COOKIE_BROWSERS") ?? readEnv("SWEET_COOKIE_SOURCES");
	if (!raw) {
		return undefined;
	}
	const tokens = raw
		.split(/[,\s]+/)
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	const out: Array<"chrome" | "edge" | "firefox" | "safari"> = [];
	for (const token of tokens) {
		if (token === "chrome" || token === "edge" || token === "firefox" || token === "safari") {
			if (!out.includes(token)) {
				out.push(token);
			}
		}
	}
	return out.length ? out : undefined;
}

function parseModeEnv(): GetCookiesOptions["mode"] | undefined {
	const raw = readEnv("SWEET_COOKIE_MODE");
	if (!raw) {
		return undefined;
	}
	const normalized = raw.trim().toLowerCase();
	if (normalized === "merge" || normalized === "first") {
		return normalized;
	}
	return undefined;
}

function readEnv(key: string): string | undefined {
	const value = process.env[key];
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed.length ? trimmed : undefined;
}
