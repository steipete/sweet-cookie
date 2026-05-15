import { existsSync } from "node:fs";
import path from "node:path";

import {
	expandPath,
	looksLikePath,
	profileNameFromDbPath,
	resolveCookiesDbsFromProfileOrRoots,
	type ChromiumProfileSelector,
} from "./paths.js";

export function resolveChromiumPathsWindows(options: {
	localAppDataVendorPath: string;
	profile?: ChromiumProfileSelector;
}): { dbPath: string | null; userDataDir: string | null } {
	const resolved = resolveChromiumPathsWindowsAll(options)[0];
	if (resolved) {
		return { dbPath: resolved.dbPath, userDataDir: resolved.userDataDir };
	}
	if (typeof options.profile === "string" && looksLikePath(options.profile)) {
		const expanded = expandPath(options.profile);
		if (existsSync(path.join(expanded, "Local State"))) {
			return { dbPath: null, userDataDir: expanded };
		}
	}
	const localAppData = process.env["LOCALAPPDATA"];
	const root = localAppData ? path.join(localAppData, options.localAppDataVendorPath) : null;
	return { dbPath: null, userDataDir: root };
}

export function resolveChromiumPathsWindowsAll(options: {
	localAppDataVendorPath: string;
	profile?: ChromiumProfileSelector;
}): Array<{ dbPath: string; userDataDir: string; profile?: string }> {
	const localAppData = process.env["LOCALAPPDATA"];
	const root = localAppData ? path.join(localAppData, options.localAppDataVendorPath) : null;

	if (typeof options.profile === "string" && looksLikePath(options.profile)) {
		const expanded = expandPath(options.profile);
		const candidates = expanded.endsWith("Cookies")
			? [expanded]
			: [
					path.join(expanded, "Network", "Cookies"),
					path.join(expanded, "Cookies"),
					path.join(expanded, "Default", "Network", "Cookies"),
				];
		for (const candidate of candidates) {
			if (!existsSync(candidate)) {
				continue;
			}
			const userDataDir = findUserDataDir(candidate);
			if (!userDataDir) {
				return [];
			}
			const profile = profileNameFromDbPath(candidate);
			return profile
				? [{ dbPath: candidate, userDataDir, profile }]
				: [{ dbPath: candidate, userDataDir }];
		}
		if (existsSync(path.join(expanded, "Local State"))) {
			return [];
		}
	}

	if (!root) {
		return [];
	}
	const args: Parameters<typeof resolveCookiesDbsFromProfileOrRoots>[0] = { roots: [root] };
	if (options.profile !== undefined) {
		args.profile = options.profile;
	}
	return resolveCookiesDbsFromProfileOrRoots(args).map((item) => {
		const resolved: { dbPath: string; userDataDir: string; profile?: string } = {
			dbPath: item.dbPath,
			userDataDir: root,
		};
		if (item.profile !== undefined) {
			resolved.profile = item.profile;
		}
		return resolved;
	});
}

function findUserDataDir(cookiesDbPath: string): string | null {
	let current = path.dirname(cookiesDbPath);
	for (let i = 0; i < 6; i += 1) {
		const localState = path.join(current, "Local State");
		if (existsSync(localState)) {
			return current;
		}
		const next = path.dirname(current);
		if (next === current) {
			break;
		}
		current = next;
	}
	return null;
}
