import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	directory: "",
	calls: [] as Array<{ command: string; timeoutMs: number | undefined }>,
}));

vi.mock("../src/util/exec.js", () => ({
	execCapture: async (command: string, _args: string[], options: { timeoutMs?: number }) => {
		state.calls.push({ command, timeoutMs: options.timeoutMs });
		return { code: 0, stdout: command === "powershell" ? "c2lk" : "", stderr: "" };
	},
}));
vi.mock("../src/providers/chromium/linuxTargets.js", () => ({
	resolveLinuxChromiumCookiesDbs: () => [{ dbPath: "cookies", keyringApp: "chrome" }],
}));
vi.mock("../src/providers/chromium/linuxPaths.js", () => ({
	resolveChromiumCookiesDbsLinux: () => [{ dbPath: "cookies" }],
}));
vi.mock("../src/providers/chromium/windowsPaths.js", () => ({
	resolveChromiumPathsWindowsAll: () => [{ dbPath: "cookies", userDataDir: state.directory }],
}));
vi.mock("../src/providers/chromeSqlite/shared.js", () => ({
	getCookiesFromChromeSqliteDb: async () => ({ cookies: [], warnings: [] }),
}));

import { getCookiesFromChromeSqliteLinux } from "../src/providers/chromeSqliteLinux.js";
import { getCookiesFromEdgeSqliteLinux } from "../src/providers/edgeSqliteLinux.js";
import { getCookiesFromChromeSqliteWindows } from "../src/providers/chromeSqliteWindows.js";
import { getCookiesFromEdgeSqliteWindows } from "../src/providers/edgeSqliteWindows.js";
import {
	getLinuxBraveSafeStoragePassword,
	getLinuxChromeSafeStoragePassword,
} from "../src/providers/chromeSqlite/linuxKeyring.js";

describe("OS helper timeouts", () => {
	beforeEach(() => {
		state.calls = [];
		vi.unstubAllEnvs();
		vi.stubEnv("SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD", "");
		vi.stubEnv("SWEET_COOKIE_EDGE_SAFE_STORAGE_PASSWORD", "");
		vi.stubEnv("SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD", "");
	});

	it.each([
		["Chrome", getCookiesFromChromeSqliteLinux],
		["Edge", getCookiesFromEdgeSqliteLinux],
	])("passes timeouts through the Linux %s provider", async (_name, provider) => {
		for (const timeoutMs of [100, 9_000, undefined]) {
			for (const backend of ["gnome", "kwallet"]) {
				state.calls = [];
				vi.stubEnv("SWEET_COOKIE_LINUX_KEYRING", backend);
				await provider(timeoutMs === undefined ? {} : { timeoutMs }, ["https://example.com"], null);
				expect(state.calls).toEqual(
					(backend === "gnome"
						? ["secret-tool", "secret-tool"]
						: ["dbus-send", "kwallet-query"]
					).map((command) => ({ command, timeoutMs: timeoutMs ?? 3_000 })),
				);
			}
		}
	});

	it.each([
		["Chrome", getLinuxChromeSafeStoragePassword],
		["Brave", getLinuxBraveSafeStoragePassword],
	])("passes timeouts through the Linux %s wrapper", async (_name, getPassword) => {
		await getPassword({ backend: "gnome", timeoutMs: 123 });
		expect(state.calls.map((call) => call.timeoutMs)).toEqual([123, 123]);
	});

	it.each([
		["Chrome", getCookiesFromChromeSqliteWindows],
		["Edge", getCookiesFromEdgeSqliteWindows],
	])("passes timeouts through the Windows %s provider", async (_name, provider) => {
		state.directory = mkdtempSync(path.join(tmpdir(), "sweet-cookie-timeout-"));
		writeFileSync(
			path.join(state.directory, "Local State"),
			JSON.stringify({ os_crypt: { encrypted_key: Buffer.from("DPAPIsid").toString("base64") } }),
		);
		for (const timeoutMs of [100, 9_000, undefined]) {
			state.calls = [];
			await provider(timeoutMs === undefined ? {} : { timeoutMs }, ["https://example.com"], null);
			expect(state.calls).toEqual([{ command: "powershell", timeoutMs: timeoutMs ?? 5_000 }]);
		}
	});
});
