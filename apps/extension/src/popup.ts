import { exportedCookieKey, mapChromeCookie, type ExportedCookie } from "./cookie-export.js";

type ExportPayload = {
	version: 1;
	generatedAt: string;
	source: "sweet-cookie";
	browser: "chrome";
	targetUrl: string;
	origins: string[];
	cookies: ExportedCookie[];
};

const els = {
	targetUrl: document.getElementById("targetUrl") as HTMLInputElement,
	extraOrigins: document.getElementById("extraOrigins") as HTMLTextAreaElement,
	allowlist: document.getElementById("allowlist") as HTMLInputElement,
	btnCopyJson: document.getElementById("btnCopyJson") as HTMLButtonElement,
	btnCopyBase64: document.getElementById("btnCopyBase64") as HTMLButtonElement,
	btnDownload: document.getElementById("btnDownload") as HTMLButtonElement,
	status: document.getElementById("status") as HTMLDivElement,
	previewBody: document.getElementById("previewBody") as HTMLDivElement,
};

const STORAGE_KEY = "sweet-cookie.settings.v1";

void bootstrap();

async function bootstrap(): Promise<void> {
	const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
	if (tab?.url) {
		els.targetUrl.value = tab.url;
	}

	const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
		| { extraOrigins?: string; allowlist?: string }
		| undefined;
	if (saved?.extraOrigins) {
		els.extraOrigins.value = saved.extraOrigins;
	}
	if (saved?.allowlist) {
		els.allowlist.value = saved.allowlist;
	}

	els.btnCopyJson.addEventListener("click", () => void handleExport("json"));
	els.btnCopyBase64.addEventListener("click", () => void handleExport("base64"));
	els.btnDownload.addEventListener("click", () => void handleExport("download"));

	els.targetUrl.addEventListener("input", schedulePreview);
	els.extraOrigins.addEventListener("input", schedulePreview);
	els.allowlist.addEventListener("input", schedulePreview);

	schedulePreview();
}

let previewTimer: number | null = null;
function schedulePreview(): void {
	if (previewTimer) {
		window.clearTimeout(previewTimer);
	}
	previewTimer = window.setTimeout(() => void refreshPreview(), 120);
}

async function refreshPreview(): Promise<void> {
	const targetUrl = els.targetUrl.value.trim();
	if (!targetUrl) {
		els.previewBody.textContent = "—";
		return;
	}

	const parsed = tryParseUrl(targetUrl);
	if (!parsed) {
		els.previewBody.textContent = "Invalid URL";
		return;
	}

	const origins = collectOrigins(parsed.origin, els.extraOrigins.value);
	const allowlist = parseAllowlist(els.allowlist.value);
	els.previewBody.textContent =
		`origins: ${origins.length}\n` +
		`allowlist: ${allowlist?.size ? `${allowlist.size} name(s)` : "none"}\n` +
		`ready: click export`;
}

async function handleExport(mode: "json" | "base64" | "download"): Promise<void> {
	setStatus("Working…");

	const targetUrl = els.targetUrl.value.trim();
	const parsed = tryParseUrl(targetUrl);
	if (!parsed) {
		setStatus("Invalid target URL.", "error");
		return;
	}

	const origins = collectOrigins(parsed.origin, els.extraOrigins.value);
	const allowlist = parseAllowlist(els.allowlist.value);

	await chrome.storage.local.set({
		[STORAGE_KEY]: {
			extraOrigins: els.extraOrigins.value,
			allowlist: els.allowlist.value,
		},
	});

	const originPerms = origins.map((origin) => originToPermission(origin));
	const granted = await chrome.permissions.request({ origins: originPerms });
	if (!granted) {
		setStatus("Permission denied. Cannot read cookies for requested origins.", "error");
		return;
	}

	const cookies = await collectCookies(origins, allowlist);
	const payload: ExportPayload = {
		version: 1,
		generatedAt: new Date().toISOString(),
		source: "sweet-cookie",
		browser: "chrome",
		targetUrl,
		origins,
		cookies,
	};

	const json = JSON.stringify(payload, null, 2);

	const preview = buildRedactedPreview(payload);
	els.previewBody.textContent = preview;

	if (mode === "json") {
		await navigator.clipboard.writeText(json);
		setStatus(`Copied JSON (${cookies.length} cookie(s)).`);
		return;
	}
	if (mode === "base64") {
		const base64 = encodeBase64(json);
		await navigator.clipboard.writeText(base64);
		setStatus(`Copied base64 (${cookies.length} cookie(s)).`);
		return;
	}

	downloadTextFile("sweet-cookie.cookies.json", json);
	setStatus(`Downloaded JSON (${cookies.length} cookie(s)).`);
}

function collectOrigins(primaryOrigin: string, extraOriginsText: string): string[] {
	const out = new Set<string>();
	out.add(ensureTrailingSlash(primaryOrigin));
	for (const line of extraOriginsText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const parsed = tryParseUrl(trimmed);
		if (!parsed) {
			continue;
		}
		out.add(ensureTrailingSlash(parsed.origin));
	}
	return Array.from(out);
}

function originToPermission(origin: string): string {
	const parsed = new URL(origin);
	return `${parsed.protocol}//${parsed.hostname}/*`;
}

function parseAllowlist(raw: string): Set<string> | null {
	const names = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return names.length ? new Set(names) : null;
}

async function collectCookies(
	origins: string[],
	allowlist: Set<string> | null,
): Promise<ExportedCookie[]> {
	const merged = new Map<string, ExportedCookie>();
	for (const origin of origins) {
		const found = await chrome.cookies.getAll({ url: origin });
		for (const cookie of found) {
			if (allowlist && allowlist.size > 0 && !allowlist.has(cookie.name)) {
				continue;
			}
			const mapped = mapChromeCookie(cookie);
			const key = exportedCookieKey(mapped, cookie.storeId ?? "");
			if (!merged.has(key)) {
				merged.set(key, { ...mapped, domain: mapped.domain ?? new URL(origin).hostname });
			}
		}
	}
	return Array.from(merged.values());
}

function encodeBase64(input: string): string {
	const utf8 = new TextEncoder().encode(input);
	let binary = "";
	for (const b of utf8) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary);
}

function downloadTextFile(filename: string, text: string): void {
	const blob = new Blob([text], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function buildRedactedPreview(payload: ExportPayload): string {
	const byDomain = new Map<string, number>();
	for (const cookie of payload.cookies) {
		const domain = cookie.domain ?? "unknown";
		byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
	}
	const domains = Array.from(byDomain.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([domain, count]) => `${domain}: ${count}`)
		.join("\n");

	const sample = payload.cookies
		.slice(0, 6)
		.map((c) => `${c.name}=${redact(c.value)}`)
		.join("\n");

	return `cookies: ${payload.cookies.length}\n\nby domain:\n${domains || "—"}\n\nsample:\n${sample || "—"}`;
}

function redact(value: string): string {
	const trimmed = value ?? "";
	if (trimmed.length <= 6) {
		return "••••••";
	}
	return `${trimmed.slice(0, 6)}…`;
}

function setStatus(message: string, kind: "ok" | "error" = "ok"): void {
	els.status.textContent = message;
	els.status.className = kind === "error" ? "status error" : "status";
}

function tryParseUrl(input: string): URL | null {
	try {
		return new URL(input);
	} catch {
		return null;
	}
}

function ensureTrailingSlash(origin: string): string {
	return origin.endsWith("/") ? origin : `${origin}/`;
}
