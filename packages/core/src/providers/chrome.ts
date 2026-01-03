import type { Cookie, GetCookiesResult } from '../types.js';
import { getCookiesFromChromeSqliteLinux } from './chromeSqliteLinux.js';
import type { ChromiumBrowserId } from './chromeSqliteMac.js';
import { getCookiesFromChromeSqliteMac } from './chromeSqliteMac.js';
import { getCookiesFromChromeSqliteWindows } from './chromeSqliteWindows.js';

export async function getCookiesFromChrome(
	options: { profile?: string; timeoutMs?: number; includeExpired?: boolean; debug?: boolean; chromiumBrowser?: ChromiumBrowserId },
	origins: string[],
	allowlistNames: Set<string> | null
): Promise<GetCookiesResult> {
	const warnings: string[] = [];

	// Platform dispatch only. All real logic lives in the per-OS providers.
	if (process.platform === 'darwin') {
		const r = await getCookiesFromChromeSqliteMac(options, origins, allowlistNames);
		warnings.push(...r.warnings);
		const cookies: Cookie[] = r.cookies;
		return { cookies, warnings };
	}

	if (process.platform === 'linux') {
		const r = await getCookiesFromChromeSqliteLinux(options, origins, allowlistNames);
		warnings.push(...r.warnings);
		const cookies: Cookie[] = r.cookies;
		return { cookies, warnings };
	}

	if (process.platform === 'win32') {
		const r = await getCookiesFromChromeSqliteWindows(options, origins, allowlistNames);
		warnings.push(...r.warnings);
		const cookies: Cookie[] = r.cookies;
		return { cookies, warnings };
	}

	return { cookies: [], warnings };
}
