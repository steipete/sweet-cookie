import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
export const ALL_CHROMIUM_PROFILES = Symbol("sweet-cookie.ALL_CHROMIUM_PROFILES");
export function looksLikePath(value) {
    return value.includes("/") || value.includes("\\");
}
export function expandPath(input) {
    if (input.startsWith("~/")) {
        return path.join(homedir(), input.slice(2));
    }
    return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}
export function safeStat(candidate) {
    try {
        return statSync(candidate);
    }
    catch {
        return null;
    }
}
export function resolveCookiesDbFromProfileOrRoots(options) {
    return resolveCookiesDbsFromProfileOrRoots(options)[0]?.dbPath ?? null;
}
export function resolveCookiesDbsFromProfileOrRoots(options) {
    const candidates = [];
    if (typeof options.profile === "string" && looksLikePath(options.profile)) {
        const expanded = expandPath(options.profile);
        const stat = safeStat(expanded);
        if (stat?.isFile()) {
            return [
                withOptionalProfile(expanded, profileNameFromDbPath(expanded), storeIdFromDbPath(expanded)),
            ];
        }
        candidates.push(path.join(expanded, "Cookies"));
        candidates.push(path.join(expanded, "Network", "Cookies"));
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return [withOptionalProfile(candidate, path.basename(expanded), expanded)];
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
            const dbPath = resolveCookiesDbInProfileDir(path.join(root, "Default"), options.cookieStoreOrder);
            if (dbPath) {
                return [{ dbPath, profile: "Default" }];
            }
        }
        return [];
    }
    const resolved = [];
    const includeStoreId = options.roots.length > 1;
    for (const root of options.roots) {
        if (!existsSync(root)) {
            continue;
        }
        const profileDirs = requestedProfile
            ? resolveProfileDirNames(root, requestedProfile)
            : discoverProfileDirNames(root);
        for (const profileDir of profileDirs) {
            const dbPath = resolveCookiesDbInProfileDir(path.join(root, profileDir), options.cookieStoreOrder);
            if (dbPath) {
                const item = { dbPath, profile: profileDir };
                if (includeStoreId) {
                    item.storeId = root;
                }
                resolved.push(item);
            }
        }
    }
    return dedupeResolvedDbs(resolved);
}
function resolveProfileDirNames(root, profile) {
    const names = [profile];
    const aliases = readChromiumProfileAliases(root);
    for (const [profileDir, displayName] of aliases) {
        if (displayName === profile && !names.includes(profileDir)) {
            names.push(profileDir);
        }
    }
    return names;
}
function discoverProfileDirNames(root) {
    const names = [];
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
function readChromiumProfileAliases(root) {
    try {
        const localState = JSON.parse(readFileSync(path.join(root, "Local State"), "utf8"));
        const infoCache = typeof localState === "object" && localState !== null
            ? localState.profile?.info_cache
            : undefined;
        if (typeof infoCache !== "object" || infoCache === null) {
            return new Map();
        }
        const aliases = new Map();
        for (const [profileDir, value] of Object.entries(infoCache)) {
            if (typeof value !== "object" || value === null) {
                continue;
            }
            const name = value.name;
            if (typeof name === "string" && name.trim()) {
                aliases.set(profileDir, name);
            }
        }
        return aliases;
    }
    catch {
        return new Map();
    }
}
function resolveCookiesDbInProfileDir(profileDir, order = "legacy-first") {
    const legacy = path.join(profileDir, "Cookies");
    const network = path.join(profileDir, "Network", "Cookies");
    const candidates = order === "network-first" ? [network, legacy] : [legacy, network];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
function safeReaddir(dir) {
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    }
    catch {
        return [];
    }
}
export function profileNameFromDbPath(dbPath) {
    const parent = path.basename(path.dirname(dbPath));
    if (parent === "Network") {
        return path.basename(path.dirname(path.dirname(dbPath)));
    }
    return parent || undefined;
}
export function storeIdFromDbPath(dbPath) {
    const parent = path.basename(path.dirname(dbPath));
    return parent === "Network" ? path.dirname(path.dirname(dbPath)) : path.dirname(dbPath);
}
function dedupeResolvedDbs(resolved) {
    const seen = new Set();
    const deduped = [];
    for (const item of resolved) {
        if (seen.has(item.dbPath)) {
            continue;
        }
        seen.add(item.dbPath);
        deduped.push(item);
    }
    return deduped;
}
function withOptionalProfile(dbPath, profile, storeId) {
    const resolved = { dbPath };
    if (profile !== undefined) {
        resolved.profile = profile;
    }
    if (storeId !== undefined) {
        resolved.storeId = storeId;
    }
    return resolved;
}
//# sourceMappingURL=paths.js.map