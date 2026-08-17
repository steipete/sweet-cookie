import { tryDecodeBase64Json } from "../util/base64.js";
import { readTextFileIfExists } from "../util/fs.js";
import { hostMatchesCookieDomain } from "../util/hostMatch.js";
export async function getCookiesFromInline(inline, origins, allowlistNames) {
    const warnings = [];
    // Inline sources can be:
    // - the payload itself (JSON or base64)
    // - a file path that contains JSON/base64
    //
    // We do a small heuristic: treat `*.json`/`*.base64` and explicit "file" sources as file paths first.
    const rawPayload = inline.source.endsWith("file") ||
        inline.payload.endsWith(".json") ||
        inline.payload.endsWith(".base64")
        ? ((await readTextFileIfExists(inline.payload)) ?? inline.payload)
        : inline.payload;
    // If it looks like base64, decode it to JSON. Otherwise use it as-is.
    const decoded = tryDecodeBase64Json(rawPayload) ?? rawPayload;
    const parsed = tryParseCookiePayload(decoded);
    if (!parsed) {
        return { cookies: [], warnings };
    }
    const hostAllow = new Set(origins.map((o) => new URL(o).hostname));
    const cookies = [];
    let isolatedCookieCount = 0;
    for (const cookie of parsed.cookies) {
        if (!cookie?.name) {
            continue;
        }
        if (allowlistNames && allowlistNames.size > 0 && !allowlistNames.has(cookie.name)) {
            continue;
        }
        if (hasUnsupportedIsolationProvenance(cookie)) {
            isolatedCookieCount++;
            continue;
        }
        const domain = cookie.domain ?? (cookie.url ? safeHostnameFromUrl(cookie.url) : undefined);
        if (domain &&
            hostAllow.size > 0 &&
            !matchesAnyHost(hostAllow, domain, cookie.hostOnly === true)) {
            continue;
        }
        cookies.push(cookie);
    }
    if (isolatedCookieCount > 0) {
        warnings.push(`${isolatedCookieCount} inline cookie(s) with partition or container provenance were excluded because replay cannot preserve their isolation context.`);
    }
    return { cookies, warnings };
}
function hasUnsupportedIsolationProvenance(cookie) {
    const value = cookie;
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value;
    if (record["partitionKey"] !== undefined && record["partitionKey"] !== null) {
        return true;
    }
    const topFrameSiteKey = typeof record["top_frame_site_key"] === "string" ? record["top_frame_site_key"].trim() : "";
    const originAttributes = typeof record["originAttributes"] === "string" ? record["originAttributes"].trim() : "";
    const partitionedAttribute = record["isPartitionedAttributeSet"] === 1 ||
        record["isPartitionedAttributeSet"] === "1" ||
        record["isPartitionedAttributeSet"] === true;
    return Boolean(topFrameSiteKey || originAttributes || partitionedAttribute);
}
function tryParseCookiePayload(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return { cookies: parsed };
        }
        if (parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.cookies)) {
            return { cookies: parsed.cookies };
        }
        return null;
    }
    catch {
        return null;
    }
}
function matchesAnyHost(hosts, cookieDomain, hostOnly) {
    for (const host of hosts) {
        if (hostMatchesCookieDomain(host, cookieDomain, hostOnly)) {
            return true;
        }
    }
    return false;
}
function safeHostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=inline.js.map