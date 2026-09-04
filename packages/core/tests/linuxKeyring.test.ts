import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	getLinuxChromiumSafeStoragePassword,
	resolveLinuxKeyringBackend,
} from "../src/providers/chromeSqlite/linuxKeyring.js";

const itIfPosix = process.platform === "win32" ? it.skip : it;

const keyringCases = [
	{
		app: "chrome" as const,
		service: "Chrome Safe Storage",
		account: "Chrome",
		application: "chrome",
		folder: "Chrome Keys",
	},
	{
		app: "chromium" as const,
		service: "Chromium Safe Storage",
		account: "Chromium",
		application: "chromium",
		folder: "Chromium Keys",
	},
	{
		app: "brave" as const,
		service: "Brave Safe Storage",
		account: "Brave",
		application: "brave",
		folder: "Brave Keys",
	},
];

function prependToPath(dir: string): void {
	const parts = [dir, process.env.PATH ?? ""].filter(Boolean);
	vi.stubEnv("PATH", parts.join(path.delimiter));
}

/**
 * Creates a secret-tool shim that returns different passwords based on arguments.
 * This simulates the GNOME keyring behavior where different lookup methods return different results.
 */
function writeSecretToolShim(
	binDir: string,
	options: {
		serviceAccountPassword?: string;
		applicationPassword?: string;
	},
): void {
	mkdirSync(binDir, { recursive: true });

	const shim = path.join(binDir, "secret-tool");
	// Script checks args to determine which password to return
	const script = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
// Check for application-based lookup (fallback method)
if (args.includes('application')) {
	process.stdout.write(${JSON.stringify(options.applicationPassword ?? "")});
	process.exit(0);
}
// Check for service/account lookup (primary method)
if (args.includes('service') && args.includes('account')) {
	process.stdout.write(${JSON.stringify(options.serviceAccountPassword ?? "")});
	process.exit(0);
}
process.exit(1);
`;
	writeFileSync(shim, script, { encoding: "utf8" });
	if (process.platform !== "win32") {
		chmodSync(shim, 0o755);
	}
}

function writeCommandShim(
	binDir: string,
	command: string,
	responses: Array<{ args: string[]; stdout: string }>,
): void {
	mkdirSync(binDir, { recursive: true });
	const shim = path.join(binDir, command);
	const script = `#!/usr/bin/env node
const responses = ${JSON.stringify(responses)};
const args = process.argv.slice(2);
const response = responses.find((item) => JSON.stringify(item.args) === JSON.stringify(args));
if (!response) {
  process.stderr.write(JSON.stringify(args));
  process.exit(2);
}
process.stdout.write(response.stdout);
`;
	writeFileSync(shim, script, { encoding: "utf8" });
	if (process.platform !== "win32") {
		chmodSync(shim, 0o755);
	}
}

describe("linux keyring", () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it("selects KWallet for a KDE desktop", () => {
		vi.stubEnv("SWEET_COOKIE_LINUX_KEYRING", "");
		vi.stubEnv("XDG_CURRENT_DESKTOP", "GNOME:KDE");
		vi.stubEnv("KDE_FULL_SESSION", "");

		expect(resolveLinuxKeyringBackend()).toBe("kwallet");
	});

	it("selects GNOME when the desktop is not KDE", () => {
		vi.stubEnv("SWEET_COOKIE_LINUX_KEYRING", "");
		vi.stubEnv("XDG_CURRENT_DESKTOP", "GNOME");
		vi.stubEnv("KDE_FULL_SESSION", "");

		expect(resolveLinuxKeyringBackend()).toBe("gnome");
	});

	it("honors an explicit keyring backend", () => {
		vi.stubEnv("SWEET_COOKIE_LINUX_KEYRING", "basic");
		vi.stubEnv("XDG_CURRENT_DESKTOP", "KDE");
		vi.stubEnv("KDE_FULL_SESSION", "true");

		expect(resolveLinuxKeyringBackend()).toBe("basic");
	});

	itIfPosix("returns password from service/account lookup when available (Chrome)", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-"));
		const binDir = path.join(dir, "bin");

		writeSecretToolShim(binDir, {
			serviceAccountPassword: "primary-password\n",
			applicationPassword: "fallback-password\n",
		});
		prependToPath(binDir);

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: "gnome",
			app: "chrome",
		});

		expect(result.password).toBe("primary-password");
		expect(result.warnings).toEqual([]);
	});

	itIfPosix(
		"falls back to application lookup when service/account returns empty (Chrome)",
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-"));
			const binDir = path.join(dir, "bin");

			// Primary method returns empty, fallback should be used
			writeSecretToolShim(binDir, {
				serviceAccountPassword: "", // Empty - simulates chrome_libsecret_os_crypt_password_v2 systems
				applicationPassword: "fallback-password\n",
			});
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({
				backend: "gnome",
				app: "chrome",
			});

			expect(result.password).toBe("fallback-password");
			expect(result.warnings).toEqual([]);
		},
	);

	itIfPosix(
		"falls back to application lookup when service/account returns empty (Edge)",
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-"));
			const binDir = path.join(dir, "bin");

			// Primary method returns empty, fallback should be used
			writeSecretToolShim(binDir, {
				serviceAccountPassword: "",
				applicationPassword: "edge-fallback-password\n",
			});
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({
				backend: "gnome",
				app: "edge",
			});

			expect(result.password).toBe("edge-fallback-password");
			expect(result.warnings).toEqual([]);
		},
	);

	itIfPosix(
		"falls back to application lookup when service/account returns empty (Brave)",
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-"));
			const binDir = path.join(dir, "bin");

			writeSecretToolShim(binDir, {
				serviceAccountPassword: "",
				applicationPassword: "brave-fallback-password\n",
			});
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({
				backend: "gnome",
				app: "brave",
			});

			expect(result.password).toBe("brave-fallback-password");
			expect(result.warnings).toEqual([]);
		},
	);

	itIfPosix("returns warning when both lookups fail", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-"));
		const binDir = path.join(dir, "bin");

		// Both methods return empty
		writeSecretToolShim(binDir, {
			serviceAccountPassword: "",
			applicationPassword: "",
		});
		prependToPath(binDir);

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: "gnome",
			app: "chrome",
		});

		expect(result.password).toBe("");
		expect(result.warnings).toContain(
			"Failed to read Linux keyring via secret-tool; v11 cookies may be unavailable.",
		);
	});

	it("uses env override when set", async () => {
		vi.stubEnv("SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD", "override-password");

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: "gnome",
			app: "chrome",
		});

		expect(result.password).toBe("override-password");
		expect(result.warnings).toEqual([]);
	});

	it("uses Brave env override when set", async () => {
		vi.stubEnv("SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD", "brave-override-password");

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: "gnome",
			app: "brave",
		});

		expect(result.password).toBe("brave-override-password");
		expect(result.warnings).toEqual([]);
	});

	it("uses Chromium env override when set", async () => {
		vi.stubEnv("SWEET_COOKIE_CHROMIUM_SAFE_STORAGE_PASSWORD", "chromium-override-password");

		const result = await getLinuxChromiumSafeStoragePassword({
			backend: "gnome",
			app: "chromium",
		});

		expect(result).toEqual({ password: "chromium-override-password", warnings: [] });
	});

	itIfPosix.each(keyringCases)(
		"uses exact secret-tool service/account arguments for $app",
		async ({ app, service, account }) => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-args-"));
			const binDir = path.join(dir, "bin");
			writeCommandShim(binDir, "secret-tool", [
				{
					args: ["lookup", "service", service, "account", account],
					stdout: "service-password\n",
				},
			]);
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({ backend: "gnome", app });

			expect(result).toEqual({ password: "service-password", warnings: [] });
		},
	);

	itIfPosix.each(keyringCases)(
		"uses exact secret-tool application arguments for $app",
		async ({ app, service, account, application }) => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-args-"));
			const binDir = path.join(dir, "bin");
			writeCommandShim(binDir, "secret-tool", [
				{ args: ["lookup", "service", service, "account", account], stdout: "" },
				{ args: ["lookup", "application", application], stdout: "application-password\n" },
			]);
			prependToPath(binDir);

			const result = await getLinuxChromiumSafeStoragePassword({ backend: "gnome", app });

			expect(result).toEqual({ password: "application-password", warnings: [] });
		},
	);

	itIfPosix.each(keyringCases)(
		"uses exact KWallet service and folder arguments for $app",
		async ({ app, service, folder }) => {
			const dir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-keyring-args-"));
			const binDir = path.join(dir, "bin");
			writeCommandShim(binDir, "dbus-send", [
				{
					args: [
						"--session",
						"--print-reply=literal",
						"--dest=org.kde.kwalletd6",
						"/modules/kwalletd6",
						"org.kde.KWallet.networkWallet",
					],
					stdout: "testwallet\n",
				},
			]);
			writeCommandShim(binDir, "kwallet-query", [
				{
					args: ["--read-password", service, "--folder", folder, "testwallet"],
					stdout: "kwallet-password\n",
				},
			]);
			prependToPath(binDir);
			vi.stubEnv("KDE_SESSION_VERSION", "6");

			const result = await getLinuxChromiumSafeStoragePassword({ backend: "kwallet", app });

			expect(result).toEqual({ password: "kwallet-password", warnings: [] });
		},
	);

	it("returns empty password for basic backend", async () => {
		const result = await getLinuxChromiumSafeStoragePassword({
			backend: "basic",
			app: "chrome",
		});

		expect(result.password).toBe("");
		expect(result.warnings).toEqual([]);
	});
});
