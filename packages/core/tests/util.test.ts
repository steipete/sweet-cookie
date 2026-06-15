import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tryDecodeBase64Json } from "../src/util/base64.js";
import { execCapture } from "../src/util/exec.js";
import { normalizeExpiration } from "../src/util/expire.js";
import { readTextFileIfExists } from "../src/util/fs.js";
import { hostMatchesCookieDomain } from "../src/util/hostMatch.js";
import { supportsReadBigInts } from "../src/util/nodeSqlite.js";
import { normalizeOrigins } from "../src/util/origins.js";

describe("util", () => {
	it("normalizeOrigins() dedupes and drops invalid extras", () => {
		const origins = normalizeOrigins("https://chatgpt.com/path", [
			"https://chatgpt.com/foo",
			"https://chatgpt.com/",
			"not a url",
			"",
		]);
		expect(origins).toEqual(["https://chatgpt.com/"]);
	});

	it("normalizeOrigins() returns [] for invalid base url", () => {
		expect(normalizeOrigins("not a url", ["https://chatgpt.com/"])).toEqual([
			"https://chatgpt.com/",
		]);
		expect(normalizeOrigins("not a url")).toEqual([]);
	});

	it("normalizeOrigins() drops opaque origins (file://, about:blank)", () => {
		expect(normalizeOrigins("file:///etc/hosts")).toEqual([]);
		expect(normalizeOrigins("about:blank")).toEqual([]);
		expect(normalizeOrigins("https://example.com/", ["file:///other", "about:blank"])).toEqual([
			"https://example.com/",
		]);
	});

	it("normalizeExpiration() handles seconds/ms/chromium microseconds", () => {
		expect(normalizeExpiration(undefined)).toBeUndefined();
		expect(normalizeExpiration(0)).toBeUndefined();

		expect(normalizeExpiration(1_700_000_000)).toBe(1_700_000_000);
		expect(normalizeExpiration(1_700_000_000_000)).toBe(1_700_000_000);

		const chromiumMicros = (11_644_473_600 + 1_700_000_000) * 1_000_000;
		expect(normalizeExpiration(chromiumMicros)).toBe(1_700_000_000);
	});

	it("hostMatchesCookieDomain() matches subdomains", () => {
		expect(hostMatchesCookieDomain("chatgpt.com", "chatgpt.com")).toBe(true);
		expect(hostMatchesCookieDomain("a.chatgpt.com", "chatgpt.com")).toBe(true);
		expect(hostMatchesCookieDomain("a.chatgpt.com", ".chatgpt.com")).toBe(true);
		expect(hostMatchesCookieDomain("example.com", "chatgpt.com")).toBe(false);
	});

	it("tryDecodeBase64Json() decodes base64 strings", () => {
		const input = JSON.stringify({ ok: true });
		const base64 = Buffer.from(input, "utf8").toString("base64");
		expect(tryDecodeBase64Json(base64)).toBe(input);
	});

	it("tryDecodeBase64Json() decodes base64url strings", () => {
		const input = JSON.stringify({ ok: true });
		const base64url = Buffer.from(input, "utf8").toString("base64url");
		expect(tryDecodeBase64Json(base64url)).toBe(input);
	});

	it("tryDecodeBase64Json() returns null for non-json or empty input", () => {
		expect(tryDecodeBase64Json("")).toBeNull();
		expect(tryDecodeBase64Json("   ")).toBeNull();

		const notJson = Buffer.from("hello", "utf8").toString("base64");
		expect(tryDecodeBase64Json(notJson)).toBeNull();

		expect(tryDecodeBase64Json("not base64")).toBeNull();
	});

	it("readTextFileIfExists() reads files only", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-fs-"));
		const file = path.join(dir, "a.txt");
		writeFileSync(file, "hi", "utf8");
		mkdirSync(path.join(dir, "folder"));

		expect(await readTextFileIfExists(file)).toBe("hi");
		expect(await readTextFileIfExists(path.join(dir, "folder"))).toBeNull();
		expect(await readTextFileIfExists(path.join(dir, "missing.txt"))).toBeNull();
	});

	it("execCapture() captures stdout/stderr and supports timeouts", async () => {
		const ok = await execCapture(process.execPath, [
			"-e",
			'process.stdout.write("out"); process.stderr.write("err");',
		]);
		expect(ok.code).toBe(0);
		expect(ok.stdout).toBe("out");
		expect(ok.stderr).toBe("err");

		const neverDir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-exec-"));
		const script = path.join(neverDir, "sleep.js");
		writeFileSync(script, "setTimeout(() => {}, 100_000);", "utf8");

		const timed = await execCapture(process.execPath, [script], { timeoutMs: 25 });
		expect(timed.code).toBe(124);
		expect(timed.stderr).toContain("Timed out");
	});

	it("supportsReadBigInts() matches the supported Node range", () => {
		const original = process.versions;
		const setNode = (node: string): void => {
			Object.defineProperty(process, "versions", {
				configurable: true,
				value: { ...original, node },
			});
		};

		// Versions that must enable readBigInts. The Node 24.0-24.3 entries lock in
		// the fix from f7e594c so the gate cannot regress to the pre-2026-03-08
		// `major === 24 ? minor >= 4 : false` form, which silently broke Chrome
		// >=146 cookie reads on every Node version under 24.4. See issue #25.
		const supported = [
			"22.0.0",
			"22.5.0",
			"22.11.0",
			"22.22.2",
			"23.0.0",
			"24.0.0",
			"24.3.1",
			"24.4.0",
			"24.10.0",
			"25.0.0",
			"30.5.1",
			"99.9.9",
		];

		// Versions that must stay disabled: Node lines without the node:sqlite
		// surface this package depends on, plus malformed strings.
		const unsupported = ["18.20.4", "20.18.0", "21.7.3", "21.9.0", "", "abc.def.ghi"];

		try {
			for (const version of supported) {
				setNode(version);
				expect(supportsReadBigInts(), version).toBe(true);
			}
			for (const version of unsupported) {
				setNode(version);
				expect(supportsReadBigInts(), version).toBe(false);
			}
		} finally {
			Object.defineProperty(process, "versions", {
				configurable: true,
				value: original,
			});
		}
	});
});
