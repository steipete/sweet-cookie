import type { Cookie, GetCookiesResult } from "../types.js";
import type { ChromiumProfileSelector } from "./chromium/paths.js";
import { getCookiesFromEdgeSqliteLinux } from "./edgeSqliteLinux.js";
import { getCookiesFromEdgeSqliteMac } from "./edgeSqliteMac.js";
import { getCookiesFromEdgeSqliteWindows } from "./edgeSqliteWindows.js";

export async function getCookiesFromEdge(
	options: {
		profile?: ChromiumProfileSelector;
		timeoutMs?: number;
		includeExpired?: boolean;
		debug?: boolean;
	},
	origins: string[],
	allowlistNames: Set<string> | null,
): Promise<GetCookiesResult> {
	const warnings: string[] = [];

	// Platform dispatch only. All real logic lives in the per-OS providers.
	if (process.platform === "darwin") {
		const r = await getCookiesFromEdgeSqliteMac(options, origins, allowlistNames);
		warnings.push(...r.warnings);
		const cookies: Cookie[] = r.cookies;
		return { cookies, warnings };
	}

	if (process.platform === "linux") {
		const r = await getCookiesFromEdgeSqliteLinux(options, origins, allowlistNames);
		warnings.push(...r.warnings);
		const cookies: Cookie[] = r.cookies;
		return { cookies, warnings };
	}

	if (process.platform === "win32") {
		const r = await getCookiesFromEdgeSqliteWindows(options, origins, allowlistNames);
		warnings.push(...r.warnings);
		const cookies: Cookie[] = r.cookies;
		return { cookies, warnings };
	}

	return { cookies: [], warnings };
}
