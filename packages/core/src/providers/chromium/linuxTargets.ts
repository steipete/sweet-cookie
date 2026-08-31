import { homedir } from "node:os";
import path from "node:path";

import type { GetCookiesOptions } from "../../types.js";
import {
	resolveCookiesDbsFromProfileOrRoots,
	type ChromiumProfileSelector,
	type ResolvedCookiesDb,
} from "./paths.js";

type ChromiumBrowserId = NonNullable<GetCookiesOptions["chromiumBrowser"]>;
type LinuxChromiumBrowserId = Exclude<ChromiumBrowserId, "arc">;
type LinuxChromiumTarget = {
	[Browser in LinuxChromiumBrowserId]: {
		id: Browser;
		keyringApp: Browser;
		profileRoots: string[];
	};
}[LinuxChromiumBrowserId];

export type ResolvedLinuxChromiumCookiesDb = ResolvedCookiesDb & {
	browser: LinuxChromiumBrowserId;
	keyringApp: LinuxChromiumBrowserId;
};

export function resolveLinuxChromiumCookiesDbs(options: {
	chromiumBrowser?: ChromiumBrowserId;
	profile?: ChromiumProfileSelector;
}): ResolvedLinuxChromiumCookiesDb[] {
	const targets = linuxChromiumTargets().filter(
		(target) => options.chromiumBrowser === undefined || target.id === options.chromiumBrowser,
	);
	const fallbackTarget = targets[0];
	if (!fallbackTarget) {
		return [];
	}

	const args: Parameters<typeof resolveCookiesDbsFromProfileOrRoots>[0] = {
		roots: targets.flatMap((target) => target.profileRoots),
	};
	if (options.profile !== undefined) {
		args.profile = options.profile;
	}

	return resolveCookiesDbsFromProfileOrRoots(args).map((db) => {
		const target =
			targets.find((candidate) => targetContainsDb(candidate, db.dbPath)) ?? fallbackTarget;
		return {
			...db,
			browser: target.id,
			keyringApp: target.keyringApp,
		};
	});
}

function linuxChromiumTargets(): LinuxChromiumTarget[] {
	const home = homedir();
	const xdgConfigHomeRaw = process.env["XDG_CONFIG_HOME"]?.trim();
	const xdgConfigHome =
		xdgConfigHomeRaw && path.isAbsolute(xdgConfigHomeRaw)
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
				path.join(
					home,
					".var",
					"app",
					"com.brave.Browser",
					"config",
					"BraveSoftware",
					"Brave-Browser",
				),
			],
		},
	];
}

function targetContainsDb(target: LinuxChromiumTarget, dbPath: string): boolean {
	return target.profileRoots.some((root) => {
		const relative = path.relative(root, dbPath);
		return (
			relative !== "" &&
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative)
		);
	});
}
