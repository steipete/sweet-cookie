import { describe, expect, it } from "vitest";

import { formatCookies, parseCliArgs, runCli } from "../src/cli.js";

describe("CLI", () => {
	it("parses a bare domain and browser/header options", () => {
		const parsed = parseCliArgs([
			"github.com",
			"--browser",
			"chrome,firefox",
			"--browser",
			"chrome",
			"--format",
			"header",
			"--name",
			"user_session,logged_in",
		]);

		expect(parsed).toMatchObject({
			ok: true,
			options: {
				url: "https://github.com/",
				browsers: ["chrome", "firefox"],
				format: "header",
				names: ["user_session", "logged_in"],
			},
		});
	});

	it("parses profile, origin, mode, and inline options", () => {
		const parsed = parseCliArgs([
			"https://app.example.com/path",
			"--origin=https://accounts.example.com",
			"--profile",
			"Default",
			"--chromium-browser",
			"brave",
			"--mode",
			"first",
			"--include-expired",
			"--timeout-ms",
			"5000",
			"--inline-file",
			"/tmp/cookies.json",
		]);

		expect(parsed).toMatchObject({
			ok: true,
			options: {
				url: "https://app.example.com/path",
				origins: ["https://accounts.example.com"],
				profile: "Default",
				chromiumBrowser: "brave",
				mode: "first",
				includeExpired: true,
				timeoutMs: 5000,
				inlineCookiesFile: "/tmp/cookies.json",
			},
		});
	});

	it("parses backend-specific profile and inline variants", () => {
		const parsed = parseCliArgs([
			"example.com",
			"--browsers=edge,safari",
			"--chrome-profile",
			"ChromeProfile",
			"--edge-profile",
			"EdgeProfile",
			"--firefox-profile",
			"FirefoxProfile",
			"--safari-cookies-file",
			"/tmp/Cookies.binarycookies",
			"--inline-json",
			'{"cookies":[]}',
			"--inline-base64",
			"eyJjb29raWVzIjpbXX0=",
			"--debug",
		]);

		expect(parsed).toMatchObject({
			ok: true,
			options: {
				url: "https://example.com/",
				browsers: ["edge", "safari"],
				chromeProfile: "ChromeProfile",
				edgeProfile: "EdgeProfile",
				firefoxProfile: "FirefoxProfile",
				safariCookiesFile: "/tmp/Cookies.binarycookies",
				inlineCookiesJson: '{"cookies":[]}',
				inlineCookiesBase64: "eyJjb29raWVzIjpbXX0=",
				debug: true,
			},
		});
	});

	it("rejects invalid browsers", () => {
		const parsed = parseCliArgs(["github.com", "--browser", "opera"]);
		expect(parsed).toMatchObject({
			ok: false,
			exitCode: 1,
			message: "Invalid --browser: opera",
		});
	});

	it("rejects invalid CLI arguments", () => {
		expect(parseCliArgs([])).toMatchObject({ ok: false, exitCode: 1, usage: true });
		expect(parseCliArgs(["--help"])).toMatchObject({ ok: false, exitCode: 0, usage: true });
		expect(parseCliArgs(["example.com", "--format", "yaml"])).toMatchObject({
			ok: false,
			message: "Invalid --format: yaml",
		});
		expect(parseCliArgs(["example.com", "--mode", "latest"])).toMatchObject({
			ok: false,
			message: "Invalid --mode: latest",
		});
		expect(parseCliArgs(["example.com", "--chromium-browser", "edge"])).toMatchObject({
			ok: false,
			message: "Invalid --chromium-browser: edge",
		});
		expect(parseCliArgs(["example.com", "--timeout-ms", "0"])).toMatchObject({
			ok: false,
			message: "Invalid --timeout-ms: 0",
		});
		expect(parseCliArgs(["example.com", "--name"])).toMatchObject({
			ok: false,
			message: "Missing value for --name",
		});
		expect(parseCliArgs(["example.com", "--wat"])).toMatchObject({
			ok: false,
			message: "Missing value for --wat",
		});
		expect(parseCliArgs(["one.example", "two.example"])).toMatchObject({
			ok: false,
			message: "Unexpected argument: two.example",
		});
	});

	it("formats cookie header output", () => {
		const text = formatCookies(
			[
				{ name: "b", value: "2", domain: "example.com" },
				{ name: "a", value: "1", domain: "example.com" },
				{ name: "a", value: "newer", domain: "example.com" },
			],
			"header",
		);

		expect(text).toBe("Cookie: a=1; b=2");
	});

	it("runs with inline JSON and writes JSON output", async () => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const code = await runCli(
			[
				"example.com",
				"--inline-json",
				JSON.stringify({ cookies: [{ name: "sid", value: "1", domain: "example.com" }] }),
			],
			{
				stdout: { write: (chunk: string) => stdout.push(chunk) },
				stderr: { write: (chunk: string) => stderr.push(chunk) },
			},
		);

		expect(code).toBe(0);
		expect(stderr).toEqual([]);
		expect(JSON.parse(stdout.join(""))).toEqual({
			cookies: [{ name: "sid", value: "1", domain: "example.com" }],
		});
	});

	it("routes usage and parse errors to the expected streams", async () => {
		const helpStdout: string[] = [];
		const helpCode = await runCli(["--help"], {
			stdout: { write: (chunk: string) => helpStdout.push(chunk) },
			stderr: { write: () => undefined },
		});
		expect(helpCode).toBe(0);
		expect(helpStdout.join("")).toContain("Usage: sweet-cookie");

		const errorStderr: string[] = [];
		const errorCode = await runCli(["example.com", "--format", "yaml"], {
			stdout: { write: () => undefined },
			stderr: { write: (chunk: string) => errorStderr.push(chunk) },
		});
		expect(errorCode).toBe(1);
		expect(errorStderr.join("")).toBe("Invalid --format: yaml\n");
	});
});
