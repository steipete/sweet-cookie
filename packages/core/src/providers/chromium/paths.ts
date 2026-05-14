import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type ResolvedCookiesDb = {
	dbPath: string;
	profile?: string;
};

export const ALL_CHROMIUM_PROFILES = Symbol("sweet-cookie.ALL_CHROMIUM_PROFILES");
export type ChromiumProfileSelector = string | typeof ALL_CHROMIUM_PROFILES;

export function looksLikePath(value: string): boolean {
	return value.includes("/") || value.includes("\\");
}

export function expandPath(input: string): string {
	if (input.startsWith("~/")) {
		return path.join(homedir(), input.slice(2));
	}
	return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

export function safeStat(
	candidate: string,
): { isFile: () => boolean; isDirectory: () => boolean } | null {
	try {
		return statSync(candidate);
	} catch {
		return null;
	}
}

export function resolveCookiesDbFromProfileOrRoots(options: {
	profile?: ChromiumProfileSelector;
	roots: string[];
}): string | null {
	return resolveCookiesDbsFromProfileOrRoots(options)[0]?.dbPath ?? null;
}

export function resolveCookiesDbsFromProfileOrRoots(options: {
	profile?: ChromiumProfileSelector;
	roots: string[];
}): ResolvedCookiesDb[] {
	const candidates: string[] = [];

	if (typeof options.profile === "string" && looksLikePath(options.profile)) {
		const expanded = expandPath(options.profile);
		const stat = safeStat(expanded);
		if (stat?.isFile()) {
			return [withOptionalProfile(expanded, profileNameFromDbPath(expanded))];
		}
		candidates.push(path.join(expanded, "Cookies"));
		candidates.push(path.join(expanded, "Network", "Cookies"));
		for (const candidate of candidates) {
			if (existsSync(candidate)) {
				return [withOptionalProfile(candidate, path.basename(expanded))];
			}
		}
		return [];
	}

	const requestedProfile = typeof options.profile === "string" ? options.profile.trim() : undefined;
	if (!requestedProfile && options.profile !== ALL_CHROMIUM_PROFILES) {
		for (const root of options.roots) {
			if (!existsSync(root)) {
				continue;
			}
			const dbPath = resolveCookiesDbInProfileDir(path.join(root, "Default"));
			if (dbPath) {
				return [{ dbPath, profile: "Default" }];
			}
		}
		return [];
	}

	const resolved: ResolvedCookiesDb[] = [];
	for (const root of options.roots) {
		if (!existsSync(root)) {
			continue;
		}
		const profileDirs = requestedProfile
			? resolveProfileDirNames(root, requestedProfile)
			: discoverProfileDirNames(root);
		for (const profileDir of profileDirs) {
			const dbPath = resolveCookiesDbInProfileDir(path.join(root, profileDir));
			if (dbPath) {
				resolved.push({ dbPath, profile: profileDir });
			}
		}
	}

	return dedupeResolvedDbs(resolved);
}

function resolveProfileDirNames(root: string, profile: string): string[] {
	const names = [profile];
	const aliases = readChromiumProfileAliases(root);
	for (const [profileDir, displayName] of aliases) {
		if (displayName === profile && !names.includes(profileDir)) {
			names.push(profileDir);
		}
	}
	return names;
}

function discoverProfileDirNames(root: string): string[] {
	const names: string[] = [];
	for (const profileDir of readChromiumProfileAliases(root).keys()) {
		if (!names.includes(profileDir)) {
			names.push(profileDir);
		}
	}
	for (const entry of safeReaddir(root)) {
		const profileDir = path.join(root, entry);
		if (resolveCookiesDbInProfileDir(profileDir) && !names.includes(entry)) {
			names.push(entry);
		}
	}
	return names;
}

function readChromiumProfileAliases(root: string): Map<string, string> {
	try {
		const localState = JSON.parse(readFileSync(path.join(root, "Local State"), "utf8")) as unknown;
		const infoCache =
			typeof localState === "object" && localState !== null
				? (localState as { profile?: { info_cache?: unknown } }).profile?.info_cache
				: undefined;
		if (typeof infoCache !== "object" || infoCache === null) {
			return new Map();
		}
		const aliases = new Map<string, string>();
		for (const [profileDir, value] of Object.entries(infoCache)) {
			if (typeof value !== "object" || value === null) {
				continue;
			}
			const name = (value as { name?: unknown }).name;
			if (typeof name === "string" && name.trim()) {
				aliases.set(profileDir, name);
			}
		}
		return aliases;
	} catch {
		return new Map();
	}
}

function resolveCookiesDbInProfileDir(profileDir: string): string | null {
	const candidates = [
		path.join(profileDir, "Cookies"),
		path.join(profileDir, "Network", "Cookies"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function safeReaddir(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

function profileNameFromDbPath(dbPath: string): string | undefined {
	const parent = path.basename(path.dirname(dbPath));
	if (parent === "Network") {
		return path.basename(path.dirname(path.dirname(dbPath)));
	}
	return parent || undefined;
}

function dedupeResolvedDbs(resolved: ResolvedCookiesDb[]): ResolvedCookiesDb[] {
	const seen = new Set<string>();
	const deduped: ResolvedCookiesDb[] = [];
	for (const item of resolved) {
		if (seen.has(item.dbPath)) {
			continue;
		}
		seen.add(item.dbPath);
		deduped.push(item);
	}
	return deduped;
}

function withOptionalProfile(dbPath: string, profile: string | undefined): ResolvedCookiesDb {
	const resolved: ResolvedCookiesDb = { dbPath };
	if (profile !== undefined) {
		resolved.profile = profile;
	}
	return resolved;
}
