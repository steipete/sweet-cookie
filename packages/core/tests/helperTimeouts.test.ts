import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

import { getCookies } from "../src/public.js";
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

	it.each(["chrome", "edge"] as const)(
		"passes getCookies timeouts to Linux %s helpers",
		async (browser) => {
			const actualPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "linux" });
			try {
				for (const timeoutMs of [100, 9_000, undefined]) {
					for (const backend of ["gnome", "kwallet"]) {
						state.calls = [];
						vi.stubEnv("SWEET_COOKIE_LINUX_KEYRING", backend);
						await getCookies({
							url: "https://example.com/",
							browsers: [browser],
							...(timeoutMs === undefined ? {} : { timeoutMs }),
						});
						expect(state.calls).toEqual(
							(backend === "gnome"
								? ["secret-tool", "secret-tool"]
								: ["dbus-send", "kwallet-query"]
							).map((command) => ({ command, timeoutMs: timeoutMs ?? 3_000 })),
						);
					}
				}
			} finally {
				Object.defineProperty(process, "platform", { value: actualPlatform });
			}
		},
	);

	it.each([
		["Chrome", getLinuxChromeSafeStoragePassword],
		["Brave", getLinuxBraveSafeStoragePassword],
	])("passes timeouts through the Linux %s wrapper", async (_name, getPassword) => {
		await getPassword({ backend: "gnome", timeoutMs: 123 });
		expect(state.calls.map((call) => call.timeoutMs)).toEqual([123, 123]);
	});

	it.each(["chrome", "edge"] as const)(
		"passes getCookies timeouts to Windows %s helpers",
		async (browser) => {
			const actualPlatform = process.platform;
			state.directory = mkdtempSync(path.join(tmpdir(), "sweet-cookie-timeout-"));
			Object.defineProperty(process, "platform", { value: "win32" });
			try {
				writeFileSync(
					path.join(state.directory, "Local State"),
					JSON.stringify({
						os_crypt: { encrypted_key: Buffer.from("DPAPIsid").toString("base64") },
					}),
				);
				for (const timeoutMs of [100, 9_000, undefined]) {
					state.calls = [];
					await getCookies({
						url: "https://example.com/",
						browsers: [browser],
						...(timeoutMs === undefined ? {} : { timeoutMs }),
					});
					expect(state.calls).toEqual([{ command: "powershell", timeoutMs: timeoutMs ?? 5_000 }]);
				}
			} finally {
				Object.defineProperty(process, "platform", { value: actualPlatform });
				rmSync(state.directory, { recursive: true, force: true });
			}
		},
	);
});
