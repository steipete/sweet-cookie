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

describe("extension cookie export", () => {
	it("preserves explicit host-only scope", () => {
		expect(mapChromeCookie(chromeCookie({ domain: "example.com", hostOnly: true }))).toMatchObject({
			domain: "example.com",
			hostOnly: true,
		});
		expect(mapChromeCookie(chromeCookie({ hostOnly: false }))).toMatchObject({
			domain: "example.com",
			hostOnly: false,
		});
	});

	it("does not dedupe host-only and domain cookies together", () => {
		const hostCookie = mapChromeCookie(chromeCookie({ domain: "example.com", hostOnly: true }));
		const domainCookie = mapChromeCookie(chromeCookie({ hostOnly: false }));

		expect(exportedCookieKey(hostCookie, "0")).not.toBe(exportedCookieKey(domainCookie, "0"));
	});

	it("keeps scope as an independent key coordinate", () => {
		for (const name of ["sid", "csrf"]) {
			for (const domain of ["example.com", "sub.example.com"]) {
				for (const path of ["/", "/account"]) {
					for (const storeId of ["0", "profile-1"]) {
						const shared = { domain, name, path, storeId };
						const hostCookie = mapChromeCookie(chromeCookie({ ...shared, hostOnly: true }));
						const domainCookie = mapChromeCookie(chromeCookie({ ...shared, hostOnly: false }));

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
