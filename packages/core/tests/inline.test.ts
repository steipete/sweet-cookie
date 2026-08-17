import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getCookiesFromInline } from "../src/providers/inline.js";

describe("inline provider", () => {
	it("accepts { cookies } JSON and filters by host", async () => {
		const payload = {
			cookies: [
				{ name: "sid", value: "a", domain: "chatgpt.com", path: "/" },
				{ name: "sid2", value: "b", domain: "example.com", path: "/" },
			],
		};
		const res = await getCookiesFromInline(
			{ source: "inline-json", payload: JSON.stringify(payload) },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies.map((c) => c.name)).toEqual(["sid"]);
	});

	it("does not send host-only cookies to subdomains", async () => {
		const payload = {
			cookies: [
				{
					name: "host-only",
					value: "a",
					domain: "chatgpt.com",
					hostOnly: true,
					path: "/",
				},
				{
					name: "domain",
					value: "b",
					domain: "chatgpt.com",
					hostOnly: false,
					path: "/",
				},
			],
		};
		const res = await getCookiesFromInline(
			{ source: "inline-json", payload: JSON.stringify(payload) },
			["https://sub.chatgpt.com/"],
			null,
		);

		expect(res.cookies.map((cookie) => cookie.name)).toEqual(["domain"]);
	});

	it("rejects inline cookies carrying partition or container provenance", async () => {
		const payload = {
			cookies: [
				{ name: "plain", value: "a", domain: "chatgpt.com", path: "/" },
				{
					name: "chips",
					value: "b",
					domain: "chatgpt.com",
					path: "/",
					partitionKey: { topLevelSite: "https://example.com" },
				},
				{
					name: "container",
					value: "c",
					domain: "chatgpt.com",
					path: "/",
					originAttributes: "^userContextId=2",
				},
				{
					name: "partitioned-firefox",
					value: "d",
					domain: "chatgpt.com",
					path: "/",
					isPartitionedAttributeSet: 1,
				},
			],
		};
		const res = await getCookiesFromInline(
			{ source: "inline-json", payload: JSON.stringify(payload) },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies.map((cookie) => cookie.name)).toEqual(["plain"]);
		expect(res.warnings).toEqual([
			"3 inline cookie(s) with partition or container provenance were excluded because replay cannot preserve their isolation context.",
		]);
	});

	it("rejects every supported non-empty isolation marker and accepts empty markers", async () => {
		const rejectedMarkers: Record<string, unknown>[] = [
			{ partitionKey: {} },
			{ partitionKey: "" },
			{ top_frame_site_key: "https://top.example" },
			{ originAttributes: "^userContextId=2" },
			{ isPartitionedAttributeSet: 1 },
			{ isPartitionedAttributeSet: "1" },
			{ isPartitionedAttributeSet: true },
		];
		const acceptedMarkers: Record<string, unknown>[] = [
			{},
			{ partitionKey: null },
			{ top_frame_site_key: "   " },
			{ originAttributes: "" },
			{ isPartitionedAttributeSet: 0 },
			{ isPartitionedAttributeSet: "0" },
			{ isPartitionedAttributeSet: false },
		];
		const cookie = (name: string, marker: Record<string, unknown>) => ({
			name,
			value: "value",
			domain: "chatgpt.com",
			path: "/",
			...marker,
		});
		const payload = {
			cookies: [
				...rejectedMarkers.map((marker, index) => cookie(`rejected-${index}`, marker)),
				...acceptedMarkers.map((marker, index) => cookie(`accepted-${index}`, marker)),
			],
		};

		const res = await getCookiesFromInline(
			{ source: "inline-json", payload: JSON.stringify(payload) },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies.map(({ name }) => name)).toEqual(
			acceptedMarkers.map((_, index) => `accepted-${index}`),
		);
		expect(res.warnings).toEqual([
			`${rejectedMarkers.length} inline cookie(s) with partition or container provenance were excluded because replay cannot preserve their isolation context.`,
		]);
	});

	it("accepts base64 payloads", async () => {
		const payload = { cookies: [{ name: "sid", value: "a", domain: "chatgpt.com", path: "/" }] };
		const json = JSON.stringify(payload);
		const base64 = Buffer.from(json, "utf8").toString("base64");

		const res = await getCookiesFromInline(
			{ source: "inline-base64", payload: base64 },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies).toHaveLength(1);
	});

	it("accepts file payloads and allowlists names", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-inline-"));
		const file = path.join(dir, "cookies.json");
		writeFileSync(
			file,
			JSON.stringify({
				cookies: [
					{ name: "a", value: "1", domain: "chatgpt.com", path: "/" },
					{ name: "b", value: "2", domain: "chatgpt.com", path: "/" },
				],
			}),
			"utf8",
		);

		const res = await getCookiesFromInline(
			{ source: "inline-file", payload: file },
			["https://chatgpt.com/"],
			new Set(["b"]),
		);
		expect(res.cookies.map((c) => c.name)).toEqual(["b"]);
	});

	it("can infer domain from cookie.url", async () => {
		const payload = {
			cookies: [{ name: "sid", value: "a", url: "https://chatgpt.com/", path: "/" }],
		};
		const res = await getCookiesFromInline(
			{ source: "inline-json", payload: JSON.stringify(payload) },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies).toHaveLength(1);
	});
});
