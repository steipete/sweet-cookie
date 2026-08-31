import { homedir } from "node:os";
import path from "node:path";
import { resolveCookiesDbsFromProfileOrRoots, } from "./paths.js";
export function resolveLinuxChromiumCookiesDbs(options) {
    const targets = linuxChromiumTargets().filter((target) => options.chromiumBrowser === undefined || target.id === options.chromiumBrowser);
    const fallbackTarget = targets[0];
    if (!fallbackTarget) {
        return [];
    }
    const args = {
        roots: targets.flatMap((target) => target.profileRoots),
    };
    if (options.profile !== undefined) {
        args.profile = options.profile;
    }
    return resolveCookiesDbsFromProfileOrRoots(args).map((db) => {
        const target = targets.find((candidate) => targetContainsDb(candidate, db.dbPath)) ?? fallbackTarget;
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
            keyringApp: "chrome",
            profileRoots: [
                path.join(xdgConfigHome, "google-chrome"),
                path.join(home, ".var", "app", "com.google.Chrome", "config", "google-chrome"),
            ],
        },
        {
            id: "chromium",
            keyringApp: "chromium",
            profileRoots: [
                path.join(xdgConfigHome, "chromium"),
                path.join(home, "snap", "chromium", "common", "chromium"),
                path.join(home, ".var", "app", "org.chromium.Chromium", "config", "chromium"),
            ],
        },
        {
            id: "brave",
            keyringApp: "brave",
            profileRoots: [
                path.join(xdgConfigHome, "BraveSoftware", "Brave-Browser"),
                path.join(home, ".var", "app", "com.brave.Browser", "config", "BraveSoftware", "Brave-Browser"),
            ],
        },
    ];
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