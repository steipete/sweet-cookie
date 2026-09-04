import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "vitest";

const itIfLinux = process.platform === "linux" ? it : it.skip;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

itIfLinux("reports KWallet after completing a KDE proof without secret-tool", () => {
	const root = mkdtempSync(path.join(tmpdir(), "sweet-cookie-kwallet-proof-"));
	const homeDir = path.join(root, "home");
	const configDir = path.join(homeDir, ".config");
	const profileDir = path.join(configDir, "BraveSoftware", "Brave-Browser", "Default");
	const binDir = path.join(root, "bin");
	const password = "synthetic-kwallet-password";
	mkdirSync(profileDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	writeChromiumCookieDb(path.join(profileDir, "Cookies"), password);
	writeCommand(path.join(binDir, "dbus-send"), "syntheticwallet");
	writeCommand(path.join(binDir, "kwallet-query"), password);

	try {
		const result = spawnSync(
			process.execPath,
			[path.join(repoRoot, "scripts", "prove-linux-browser.mjs"), "brave"],
			{
				cwd: repoRoot,
				encoding: "utf8",
				env: {
					...process.env,
					DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/synthetic-bus",
					HOME: homeDir,
					KDE_FULL_SESSION: "true",
					KDE_SESSION_VERSION: "6",
					PATH: binDir,
					SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD: "",
					SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD: "",
					SWEET_COOKIE_CHROMIUM_SAFE_STORAGE_PASSWORD: "",
					SWEET_COOKIE_EDGE_SAFE_STORAGE_PASSWORD: "",
					SWEET_COOKIE_LINUX_KEYRING: "",
					XDG_CONFIG_HOME: configDir,
					XDG_CURRENT_DESKTOP: "KDE",
				},
			},
		);

		expect(result.status, result.stderr).toBe(0);
		const output: unknown = result.status === 0 ? JSON.parse(result.stdout) : null;
		expect(output).toMatchObject({
			browser: "brave",
			keyring: {
				backend: "kwallet",
				overrideUsed: false,
				passwordRetrieved: true,
			},
			cookie: {
				prefix: "v11",
				independentlyDecrypted: true,
				providerRoundTrip: true,
				sensitiveFieldsPrinted: false,
			},
			providerWarnings: 0,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function writeChromiumCookieDb(dbPath: string, password: string): void {
	const key = pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
	const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
	const payload = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from("synthetic-proof")]);
	const encryptedValue = Buffer.concat([
		Buffer.from("v11"),
		cipher.update(payload),
		cipher.final(),
	]);

	const db = new DatabaseSync(dbPath);
	try {
		db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER);");
		db.exec(
			"CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER);",
		);
		db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("version", 24);
		db.prepare(
			"INSERT INTO cookies (host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).run(".example.com", "proof", "", encryptedValue, "/", 0, 1, 1, 0);
	} finally {
		db.close();
	}
}

function writeCommand(filePath: string, output: string): void {
	writeFileSync(filePath, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`);
	chmodSync(filePath, 0o755);
}
