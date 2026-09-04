import { homedir } from "node:os";
import path from "node:path";
import { resolveCookiesDbsFromProfileOrRoots, } from "./paths.js";
export function resolveLinuxChromiumCookiesDbs(options) {
    const allTargets = linuxChromiumTargets();
    const discoveryTargets = allTargets.filter((target) => target.id === (options.chromiumBrowser ?? "chrome"));
    const fallbackTarget = discoveryTargets[0];
    if (!fallbackTarget) {
        return [];
    }
    const identityTargets = options.chromiumBrowser === undefined ? allTargets : discoveryTargets;
    const args = {
        roots: discoveryTargets.flatMap((target) => target.profileRoots),
    };
    if (options.profile !== undefined) {
        args.profile = options.profile;
    }
    return resolveCookiesDbsFromProfileOrRoots(args).map((db) => {
        const target = identityTargets.find((candidate) => targetContainsDb(candidate, db.dbPath)) ??
            identityTargets.find((candidate) => targetMatchesExplicitDb(candidate, db.dbPath)) ??
            fallbackTarget;
        return {
            ...db,
            browser: target.id,
            keyringApp: target.keyringApp,
        };
    });
}
function linuxChromiumTargets() {
    const home = homedir();
    const xdgConfigHomeRaw = process.env["XDG_CONFIG_HOME"]?.trim();
    const xdgConfigHome = xdgConfigHomeRaw && path.isAbsolute(xdgConfigHomeRaw)
        ? xdgConfigHomeRaw
        : path.join(home, ".config");
    return [
        {
            id: "chrome",
            explicitPathMarkers: [],
            keyringApp: "chrome",
            profileRoots: [
                path.join(xdgConfigHome, "google-chrome"),
                path.join(home, ".var", "app", "com.google.Chrome", "config", "google-chrome"),
            ],
        },
        {
            id: "chromium",
            explicitPathMarkers: [],
            keyringApp: "chromium",
            profileRoots: [
                path.join(xdgConfigHome, "chromium"),
                path.join(home, "snap", "chromium", "common", "chromium"),
                path.join(home, ".var", "app", "org.chromium.Chromium", "config", "chromium"),
            ],
        },
        {
            id: "brave",
            explicitPathMarkers: ["bravesoftware", "brave-browser", "brave browser"],
            keyringApp: "brave",
            profileRoots: [
                path.join(xdgConfigHome, "BraveSoftware", "Brave-Browser"),
                path.join(home, "snap", "brave", "common", "BraveSoftware", "Brave-Browser"),
                path.join(home, ".var", "app", "com.brave.Browser", "config", "BraveSoftware", "Brave-Browser"),
            ],
        },
    ];
}
function targetMatchesExplicitDb(target, dbPath) {
    const normalizedDbPath = dbPath.toLowerCase();
    return target.explicitPathMarkers.some((marker) => normalizedDbPath.includes(marker));
}
function targetContainsDb(target, dbPath) {
    return target.profileRoots.some((root) => {
        const relative = path.relative(root, dbPath);
        return (relative !== "" &&
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative));
    });
}
//# sourceMappingURL=linuxTargets.js.map