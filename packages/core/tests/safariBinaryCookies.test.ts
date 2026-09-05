import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getCookiesFromSafari } from "../src/providers/safariBinaryCookies.js";

const itIfDarwin = process.platform === "darwin" ? it : it.skip;

function writeCString(buf: Buffer, offset: number, value: string): number {
	const bytes = Buffer.from(value, "utf8");
	bytes.copy(buf, offset);
	buf[offset + bytes.length] = 0;
	return offset + bytes.length + 1;
}

function buildSafariBinaryCookiesFile(rawUrl = "https://chatgpt.com/"): Buffer {
	const cookie = Buffer.alloc(96);
	cookie.writeUInt32LE(96, 0);
	cookie.writeUInt32LE(0, 4);
	cookie.writeUInt32LE(5, 8); // secure + httpOnly
	cookie.writeUInt32LE(0, 12);

	cookie.writeUInt32LE(56, 16); // urlOffset
	cookie.writeUInt32LE(80, 20); // nameOffset
	cookie.writeUInt32LE(84, 24); // pathOffset
	cookie.writeUInt32LE(86, 28); // valueOffset

	cookie.writeDoubleLE(100, 40); // mac epoch seconds

	writeCString(cookie, 56, rawUrl);
	writeCString(cookie, 80, "sid");
	writeCString(cookie, 84, "/");
	writeCString(cookie, 86, "value");

	const page = Buffer.alloc(16 + cookie.length);
	page.writeUInt32BE(0x00000100, 0);
	page.writeUInt32LE(1, 4);
	page.writeUInt32LE(16, 8);
	cookie.copy(page, 16);

	const header = Buffer.alloc(8);
	header.write("cook", 0, "utf8");
	header.writeUInt32BE(1, 4);

	const pageSize = Buffer.alloc(4);
	pageSize.writeUInt32BE(page.length, 0);

	return Buffer.concat([header, pageSize, page]);
}

function buildSafariBinaryCookiesFileWithoutUrl(): Buffer {
	const cookie = Buffer.alloc(96);
	cookie.writeUInt32LE(96, 0);
	cookie.writeUInt32LE(0, 4);
	cookie.writeUInt32LE(5, 8); // secure + httpOnly
	cookie.writeUInt32LE(0, 12);

	cookie.writeUInt32LE(0, 16); // urlOffset (0 => missing)
	cookie.writeUInt32LE(80, 20); // nameOffset
	cookie.writeUInt32LE(84, 24); // pathOffset
	cookie.writeUInt32LE(86, 28); // valueOffset

	cookie.writeDoubleLE(100, 40); // mac epoch seconds

	writeCString(cookie, 80, "sid");
	writeCString(cookie, 84, "/");
	writeCString(cookie, 86, "value");

	const page = Buffer.alloc(16 + cookie.length);
	page.writeUInt32BE(0x00000100, 0);
	page.writeUInt32LE(1, 4);
	page.writeUInt32LE(16, 8);
	cookie.copy(page, 16);

	const header = Buffer.alloc(8);
	header.write("cook", 0, "utf8");
	header.writeUInt32BE(1, 4);

	const pageSize = Buffer.alloc(4);
	pageSize.writeUInt32BE(page.length, 0);

	return Buffer.concat([header, pageSize, page]);
}

describe("safari binarycookies provider", () => {
	itIfDarwin("decodes Cookies.binarycookies", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");
		writeFileSync(file, buildSafariBinaryCookiesFile());

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.name).toBe("sid");
		expect(res.cookies[0]?.domain).toBe("chatgpt.com");
		expect(res.cookies[0]?.hostOnly).toBe(true);
		expect(res.cookies[0]?.secure).toBe(true);
		expect(res.cookies[0]?.httpOnly).toBe(true);
		expect(res.cookies[0]?.source?.browser).toBe("safari");
	});

	itIfDarwin("preserves Safari domain-cookie scope", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");
		writeFileSync(file, buildSafariBinaryCookiesFile(".chatgpt.com"));

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://sub.chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(1);
		expect(res.cookies[0]?.domain).toBe("chatgpt.com");
		expect(res.cookies[0]?.hostOnly).toBe(false);
	});

	itIfDarwin("does not send Safari host-only cookies to subdomains", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");
		writeFileSync(file, buildSafariBinaryCookiesFile("https://chatgpt.com/"));

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://sub.chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("filters expired cookies when includeExpired=false", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");
		writeFileSync(file, buildSafariBinaryCookiesFile());

		const res = await getCookiesFromSafari(
			{ includeExpired: false, file },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("filters by allowlist", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");
		writeFileSync(file, buildSafariBinaryCookiesFile());

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			new Set(["nope"]),
		);

		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("skips cookies without a domain", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");
		writeFileSync(file, buildSafariBinaryCookiesFileWithoutUrl());

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("reports warnings for unreadable files", async () => {
		const res = await getCookiesFromSafari(
			{ includeExpired: true, file: "/path/does/not/exist/Cookies.binarycookies" },
			["https://chatgpt.com/"],
			null,
		);

		expect(res.cookies).toHaveLength(0);
		expect(res.warnings.join("\n")).toContain("Failed to read Safari cookies");
	});

	itIfDarwin("returns empty for invalid file header", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");
		writeFileSync(file, Buffer.from("nope", "utf8"));

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("returns empty for invalid page header", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");

		const header = Buffer.alloc(8);
		header.write("cook", 0, "utf8");
		header.writeUInt32BE(1, 4);
		const pageSize = Buffer.alloc(4);
		pageSize.writeUInt32BE(16, 0);
		const page = Buffer.alloc(16);
		page.writeUInt32BE(0, 0);

		writeFileSync(file, Buffer.concat([header, pageSize, page]));

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("handles cookie records that are too small", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");

		const page = Buffer.alloc(16);
		page.writeUInt32BE(0x00000100, 0);
		page.writeUInt32LE(1, 4);
		page.writeUInt32LE(16, 8);

		const header = Buffer.alloc(8);
		header.write("cook", 0, "utf8");
		header.writeUInt32BE(1, 4);
		const pageSize = Buffer.alloc(4);
		pageSize.writeUInt32BE(page.length, 0);

		writeFileSync(file, Buffer.concat([header, pageSize, page]));

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("handles pages with cookieCount=0", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");

		const page = Buffer.alloc(16);
		page.writeUInt32BE(0x00000100, 0);
		page.writeUInt32LE(0, 4);

		const header = Buffer.alloc(8);
		header.write("cook", 0, "utf8");
		header.writeUInt32BE(1, 4);
		const pageSize = Buffer.alloc(4);
		pageSize.writeUInt32BE(page.length, 0);

		writeFileSync(file, Buffer.concat([header, pageSize, page]));

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies).toHaveLength(0);
	});

	itIfDarwin("handles cookie records with invalid size", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-safari-"));
		const file = path.join(dir, "Cookies.binarycookies");

		const cookie = Buffer.alloc(64);
		cookie.writeUInt32LE(10_000, 0);

		const page = Buffer.alloc(16 + cookie.length);
		page.writeUInt32BE(0x00000100, 0);
		page.writeUInt32LE(1, 4);
		page.writeUInt32LE(16, 8);
		cookie.copy(page, 16);

		const header = Buffer.alloc(8);
		header.write("cook", 0, "utf8");
		header.writeUInt32BE(1, 4);
		const pageSize = Buffer.alloc(4);
		pageSize.writeUInt32BE(page.length, 0);

		writeFileSync(file, Buffer.concat([header, pageSize, page]));

		const res = await getCookiesFromSafari(
			{ includeExpired: true, file },
			["https://chatgpt.com/"],
			null,
		);
		expect(res.cookies).toHaveLength(0);
	});
});
