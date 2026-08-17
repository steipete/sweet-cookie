export type SweetCookieSameSite = "Strict" | "Lax" | "None";

export type ExportedCookie = {
	name: string;
	value: string;
	domain?: string;
	hostOnly?: boolean;
	path?: string;
	expires?: number;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: SweetCookieSameSite;
};

export function mapChromeCookie(cookie: chrome.cookies.Cookie): ExportedCookie | null {
	const partitionKey = (cookie as { partitionKey?: unknown }).partitionKey;
	if (partitionKey !== undefined && partitionKey !== null) {
		return null;
	}

	const result: ExportedCookie = {
		name: cookie.name,
		value: cookie.value,
		hostOnly: cookie.hostOnly,
	};

	const domain = cookie.domain?.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
	if (domain) {
		result.domain = domain;
	}

	if (cookie.path) {
		result.path = cookie.path;
	}

	if (
		!cookie.session &&
		typeof cookie.expirationDate === "number" &&
		Number.isFinite(cookie.expirationDate)
	) {
		result.expires = Math.round(cookie.expirationDate);
	}

	if (cookie.secure) {
		result.secure = true;
	}
	if (cookie.httpOnly) {
		result.httpOnly = true;
	}

	const sameSite = normalizeSameSite(cookie.sameSite);
	if (sameSite) {
		result.sameSite = sameSite;
	}

	return result;
}

export function exportedCookieKey(cookie: ExportedCookie, storeId: string): string {
	const scope = cookie.hostOnly === true ? "host" : "domain";
	return `${cookie.name}|${cookie.domain ?? ""}|${scope}|${cookie.path ?? ""}|${storeId}`;
}

function normalizeSameSite(
	value: chrome.cookies.Cookie["sameSite"],
): SweetCookieSameSite | undefined {
	if (value === "strict") {
		return "Strict";
	}
	if (value === "lax") {
		return "Lax";
	}
	if (value === "no_restriction") {
		return "None";
	}
	return undefined;
}
