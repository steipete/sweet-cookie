import { describe, expect, it } from "vitest";

import { exportedCookieKey, mapChromeCookie } from "../src/cookie-export.js";

function chromeCookie(overrides: Partial<chrome.cookies.Cookie> = {}): chrome.cookies.Cookie {
	return {
		domain: ".example.com",
		name: "sid",
		storeId: "0",
		value: "value",
		session: true,
		hostOnly: false,
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		...overrides,
	};
}

function exportedChromeCookie(
	overrides: Partial<chrome.cookies.Cookie> = {},
): NonNullable<ReturnType<typeof mapChromeCookie>> {
	const mapped = mapChromeCookie(chromeCookie(overrides));
	if (!mapped) {
		throw new Error("unpartitioned cookies must be exported");
	}
	return mapped;
}

describe("extension cookie export", () => {
	it("preserves explicit host-only scope", () => {
		expect(exportedChromeCookie({ domain: "example.com", hostOnly: true })).toMatchObject({
			domain: "example.com",
			hostOnly: true,
		});
		expect(exportedChromeCookie({ hostOnly: false })).toMatchObject({
			domain: "example.com",
			hostOnly: false,
		});
	});

	it("excludes cookies carrying partition provenance", () => {
		for (const partitionKey of [
			{},
			{ topLevelSite: "https://example.com" },
			{ hasCrossSiteAncestor: false, topLevelSite: "https://example.com" },
		]) {
			expect(mapChromeCookie(chromeCookie({ partitionKey }))).toBeNull();
		}
	});

	it("keeps cookies without partition provenance", () => {
		for (const partitionKey of [undefined, null]) {
			const cookie = chromeCookie();
			Reflect.set(cookie, "partitionKey", partitionKey);
			expect(mapChromeCookie(cookie)).toMatchObject({ name: "sid", value: "value" });
		}
	});

	it("does not dedupe host-only and domain cookies together", () => {
		const hostCookie = exportedChromeCookie({ domain: "example.com", hostOnly: true });
		const domainCookie = exportedChromeCookie({ hostOnly: false });

		expect(exportedCookieKey(hostCookie, "0")).not.toBe(exportedCookieKey(domainCookie, "0"));
	});

	it("keeps scope as an independent key coordinate", () => {
		for (const name of ["sid", "csrf"]) {
			for (const domain of ["example.com", "sub.example.com"]) {
				for (const path of ["/", "/account"]) {
					for (const storeId of ["0", "profile-1"]) {
						const shared = { domain, name, path, storeId };
						const hostCookie = exportedChromeCookie({ ...shared, hostOnly: true });
						const domainCookie = exportedChromeCookie({ ...shared, hostOnly: false });

						expect(exportedCookieKey(hostCookie, storeId)).not.toBe(
							exportedCookieKey(domainCookie, storeId),
						);
						expect(exportedCookieKey(hostCookie, storeId)).toBe(
							exportedCookieKey({ ...hostCookie }, storeId),
						);
					}
				}
			}
		}
	});
});
