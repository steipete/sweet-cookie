#!/usr/bin/env node

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import {
	decryptChromiumAes128CbcCookieValue,
	deriveAes128CbcKeyFromPassword,
} from "../packages/core/dist/providers/chromeSqlite/crypto.js";
import {
	getLinuxChromiumSafeStoragePassword,
	resolveLinuxKeyringBackend,
} from "../packages/core/dist/providers/chromeSqlite/linuxKeyring.js";
import { getCookiesFromChromeSqliteLinux } from "../packages/core/dist/providers/chromeSqliteLinux.js";
import { resolveLinuxChromiumCookiesDbs } from "../packages/core/dist/providers/chromium/linuxTargets.js";

const supportedBrowsers = new Set(["brave", "chrome", "chromium"]);
const passwordOverrides = [
	"SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD",
	"SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD",
	"SWEET_COOKIE_CHROMIUM_SAFE_STORAGE_PASSWORD",
	"SWEET_COOKIE_EDGE_SAFE_STORAGE_PASSWORD",
];

const browser = parseBrowser(process.argv.slice(2));
await proveRealLinuxBrowser(browser);

function parseBrowser(args) {
	if (args.includes("--help") || args.includes("-h")) {
		console.log("Usage: node scripts/prove-linux-browser.mjs [brave|chrome|chromium]");
		process.exit(0);
	}
	if (args.length > 1 || (args[0] && !supportedBrowsers.has(args[0]))) {
		throw new Error("Expected one browser: brave, chrome, or chromium.");
	}
	return args[0] ?? "brave";
}

async function proveRealLinuxBrowser(browserId) {
	const keyringBackend = resolveLinuxKeyringBackend();
	validateEnvironment(keyringBackend);

	const resolvedDb = resolveLinuxChromiumCookiesDbs({ chromiumBrowser: browserId })[0];
	if (!resolvedDb) {
		throw new Error(`No default ${browserId} cookie database was discovered.`);
	}
	if (resolvedDb.browser !== browserId || resolvedDb.keyringApp !== browserId) {
		throw new Error("The discovered database did not retain the requested browser identity.");
	}

	const keyringResult = await getLinuxChromiumSafeStoragePassword({
		app: browserId,
		backend: keyringBackend,
	});
	if (keyringResult.warnings.length > 0 || !keyringResult.password) {
		throw new Error("The desktop keyring did not return the browser Safe Storage password.");
	}

	const snapshot = snapshotCookiesDb(resolvedDb.dbPath);
	try {
		const candidate = findDecryptableV11Cookie(snapshot.dbPath, keyringResult.password);
		if (!candidate) {
			throw new Error(
				`No decryptable v11 cookie was found for ${browserId}. Browse with it and retry.`,
			);
		}

		const result = await getCookiesFromChromeSqliteLinux(
			{ chromiumBrowser: browserId, profile: resolvedDb.dbPath, includeExpired: true },
			[candidate.origin],
			new Set([candidate.name]),
		);
		const providerMatch = result.cookies.some(
			(cookie) =>
				cookie.name === candidate.name &&
				cookie.domain === candidate.domain &&
				cookie.path === candidate.path &&
				cookie.value === candidate.value,
		);
		if (!providerMatch) {
			throw new Error("The Linux provider did not return the independently decrypted v11 cookie.");
		}

		console.log(
			JSON.stringify(
				{
					proof: "real-linux-browser-keyring-v11",
					browser: browserId,
					installation: classifyInstallation(resolvedDb.dbPath),
					profile: resolvedDb.profile ?? "unknown",
					profileAccess: "read-only source copied to temporary snapshots",
					keyring: {
						backend: keyringBackend,
						overrideUsed: false,
						passwordRetrieved: true,
					},
					cookie: {
						prefix: "v11",
						independentlyDecrypted: true,
						providerRoundTrip: true,
						sensitiveFieldsPrinted: false,
					},
					providerWarnings: result.warnings.length,
				},
				null,
				2,
			),
		);
	} finally {
		snapshot.cleanup();
	}
}

function validateEnvironment(keyringBackend) {
	if (process.platform !== "linux") {
		throw new Error("This proof must run on Linux.");
	}
	const activeOverrides = passwordOverrides.filter((key) => process.env[key]?.trim());
	if (activeOverrides.length > 0 || process.env["SWEET_COOKIE_LINUX_KEYRING"]?.trim()) {
		throw new Error("Unset all SWEET_COOKIE keyring and password overrides before running proof.");
	}
	if (!process.env["DBUS_SESSION_BUS_ADDRESS"]?.trim()) {
		throw new Error("DBUS_SESSION_BUS_ADDRESS must point to the active desktop session bus.");
	}
	if (keyringBackend === "basic") {
		throw new Error("The proof requires the GNOME or KWallet keyring backend.");
	}
	const requiredCommands =
		keyringBackend === "kwallet" ? ["dbus-send", "kwallet-query"] : ["secret-tool"];
	for (const command of requiredCommands) {
		const probe = spawnSync(command, ["--help"], { stdio: "ignore" });
		if (probe.error) {
			throw new Error(`${command} is required for the selected ${keyringBackend} backend.`);
		}
	}
}

function snapshotCookiesDb(sourceDbPath) {
	const tempDir = mkdtempSync(path.join(tmpdir(), "sweet-cookie-linux-proof-"));
	const dbPath = path.join(tempDir, "Cookies");
	try {
		copyFileSync(sourceDbPath, dbPath);
		copySidecar(sourceDbPath, dbPath, "-wal");
		copySidecar(sourceDbPath, dbPath, "-shm");
	} catch (error) {
		rmSync(tempDir, { recursive: true, force: true });
		throw error;
	}
	return {
		dbPath,
		cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
	};
}

function copySidecar(sourceDbPath, targetDbPath, suffix) {
	const source = `${sourceDbPath}${suffix}`;
	if (existsSync(source)) {
		copyFileSync(source, `${targetDbPath}${suffix}`);
	}
}

function findDecryptableV11Cookie(dbPath, password) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
		const metaVersion = Number.parseInt(String(metaRow?.value ?? "0"), 10);
		const rows = db
			.prepare(
				"SELECT host_key, name, path, encrypted_value FROM cookies " +
					"WHERE hex(substr(encrypted_value, 1, 3)) = '763131' " +
					"AND host_key != '' AND name != '' ORDER BY expires_utc DESC LIMIT 200",
			)
			.all();
		const key = deriveAes128CbcKeyFromPassword(password, { iterations: 1 });
		for (const row of rows) {
			if (
				typeof row.host_key !== "string" ||
				typeof row.name !== "string" ||
				!(row.encrypted_value instanceof Uint8Array)
			) {
				continue;
			}
			const domain = row.host_key.startsWith(".") ? row.host_key.slice(1) : row.host_key;
			let origin;
			try {
				origin = new URL(`https://${domain}/`).toString();
			} catch {
				continue;
			}
			const value = decryptChromiumAes128CbcCookieValue(row.encrypted_value, [key], {
				stripHashPrefix: Number.isFinite(metaVersion) && metaVersion >= 24,
				treatUnknownPrefixAsPlaintext: false,
			});
			if (value !== null) {
				return {
					domain,
					name: row.name,
					origin,
					path: typeof row.path === "string" && row.path ? row.path : "/",
					value,
				};
			}
		}
		return null;
	} finally {
		db.close();
	}
}

function classifyInstallation(dbPath) {
	if (dbPath.includes("/snap/")) {
		return "snap";
	}
	if (dbPath.includes("/.var/app/")) {
		return "flatpak";
	}
	return "native";
}
