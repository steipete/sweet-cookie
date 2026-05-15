import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
	expandPath,
	looksLikePath,
	profileNameFromDbPath,
	resolveCookiesDbsFromProfileOrRoots,
	type ChromiumProfileSelector,
	type ResolvedCookiesDb,
} from "./paths.js";

export function resolveChromiumCookiesDbLinux(options: {
	configDirName: string;
	profile?: ChromiumProfileSelector;
}): string | null {
	return resolveChromiumCookiesDbsLinux(options)[0]?.dbPath ?? null;
}

export function resolveChromiumCookiesDbsLinux(options: {
	configDirName: string;
	profile?: ChromiumProfileSelector;
}): ResolvedCookiesDb[] {
	const home = homedir();
	const configHome = process.env["XDG_CONFIG_HOME"]?.trim() || path.join(home, ".config");
	const root = path.join(configHome, options.configDirName);

	if (typeof options.profile === "string" && looksLikePath(options.profile)) {
		const candidate = expandPath(options.profile);
		if (candidate.endsWith("Cookies") && existsSync(candidate)) {
			const profile = profileNameFromDbPath(candidate);
			return profile ? [{ dbPath: candidate, profile }] : [{ dbPath: candidate }];
		}
		const direct = path.join(candidate, "Cookies");
		if (existsSync(direct)) {
			return [{ dbPath: direct, profile: path.basename(candidate) }];
		}
		const network = path.join(candidate, "Network", "Cookies");
		if (existsSync(network)) {
			return [{ dbPath: network, profile: path.basename(candidate) }];
		}
		return [];
	}

	const args: Parameters<typeof resolveCookiesDbsFromProfileOrRoots>[0] = { roots: [root] };
	if (options.profile !== undefined) {
		args.profile = options.profile;
	}
	return resolveCookiesDbsFromProfileOrRoots(args);
}
