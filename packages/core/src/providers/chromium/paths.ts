import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function looksLikePath(value: string): boolean {
	return value.includes('/') || value.includes('\\');
}

export function expandPath(input: string): string {
	if (input.startsWith('~/')) return path.join(homedir(), input.slice(2));
	return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

export function safeStat(
	candidate: string
): { isFile: () => boolean; isDirectory: () => boolean } | null {
	try {
		return statSync(candidate);
	} catch {
		return null;
	}
}

export function resolveCookiesDbFromProfileOrRoots(options: {
	profile?: string;
	roots: string[];
}): string | null {
	const candidates: string[] = [];

	if (options.profile && looksLikePath(options.profile)) {
		const expanded = expandPath(options.profile);
		const stat = safeStat(expanded);
		if (stat?.isFile()) return expanded;
		candidates.push(path.join(expanded, 'Cookies'));
		candidates.push(path.join(expanded, 'Network', 'Cookies'));
	} else {
		const profileDir =
			options.profile && options.profile.trim().length > 0 ? options.profile.trim() : 'Default';
		for (const root of options.roots) {
			candidates.push(path.join(root, profileDir, 'Cookies'));
			candidates.push(path.join(root, profileDir, 'Network', 'Cookies'));
		}
	}

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return null;
}
