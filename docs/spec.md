# Sweet Cookie — Cookie Extraction Spec

## Goal

Standardize cookie extraction for TypeScript tools:

- `@steipete/sweet-cookie` (library): one API to load cookies from inline payloads + local browsers.
- `apps/extension` (Chrome MV3): optional “escape hatch” exporter for cases where local reads fail (locked down OS, app-bound cookies, keychain prompts, etc).

Primary use-cases:

- Use cookies for HTTP clients (build `Cookie` header).
- Use cookies for browser automation (CDP-ish cookie objects).
- Prefer zero native module builds; rely on Node/Bun built-ins + OS tooling.

## Non-goals

- Re-implement every Chromium encryption scheme across platforms.
- Cross-profile extraction via the extension (extensions can’t read other Chrome profiles).
- Bypassing browser security boundaries (extension reads only what it’s permitted to read).
- Headless automation. (Library is “read cookies”, not “drive browser”.)

## Library (`@steipete/sweet-cookie`)

### API surface

Exports:

- `getCookies(options: GetCookiesOptions): Promise<{ cookies: Cookie[]; warnings: string[] }>`
- `toCookieHeader(cookies: Cookie[], options?): string`

High-signal options:

- `url`: primary target URL (host drives filtering)
- `origins`: extra origins (OAuth, multi-domain auth)
- `names`: allowlist cookie names
- `browsers`: ordered sources (`chrome|edge|safari|firefox`); default is `chrome`, `safari`, `firefox`
- `mode`: `merge` (default) or `first`
- `profile`: shared Chromium alias (`chromeProfile` / `edgeProfile`)
- `chromeProfile`: Chrome profile name/path
- `chromiumBrowser`: macOS-only explicit `chrome|brave|arc|chromium` target for the `chrome` backend
- `edgeProfile`: Edge profile name/path
- `firefoxProfile`: Firefox profile name/path
- `safariCookiesFile`: override path to `Cookies.binarycookies`
- `timeoutMs`: timeout for OS helpers (keychain/keyring/DPAPI)
- `debug`: extra provider warnings (never raw values)
- `includeExpired`: include expired cookies
- Inline inputs (escape hatch):
  - `inlineCookiesJson`, `inlineCookiesBase64`, `inlineCookiesFile`

### Provider order

1. Inline sources (if any). First non-empty wins; local browsers are skipped once inline yields cookies.
2. Local browsers in declared order:
   - **Chrome**
     - copy DB → query via `node:sqlite` (Node) or `bun:sqlite` (Bun)
     - macOS default discovery checks Google Chrome and Brave roots; `chromiumBrowser` can pin Chrome, Brave, Arc, or Chromium explicitly
     - decrypt:
       - macOS: Keychain `security` (Chrome Safe Storage)
       - Windows: DPAPI unwrap (Local State) + AES-GCM
       - Linux: v10 (peanuts) + v11 (keyring via `secret-tool` or `kwallet-query` + `dbus-send`)
     - Linux safe-storage overrides support Chrome, Edge, and Brave env passwords
     - Linux/Windows Brave and other Chromium-family profiles work when the caller passes an explicit `chromeProfile` path to that profile/DB
     - app-bound cookies: expect failures; prefer inline/export
   - **Edge**
     - copy DB → query via `node:sqlite` (Node) or `bun:sqlite` (Bun)
     - `edgeProfile` falls back to `SWEET_COOKIE_CHROME_PROFILE` when `SWEET_COOKIE_EDGE_PROFILE` is unset
     - decrypt follows the Chromium path for the current OS
   - **Firefox**
     - Bun: `bun:sqlite`
     - Node: `node:sqlite`
   - **Safari**
     - parse `Cookies.binarycookies` directly (no WebKit db dependency)

### Output contract

`Cookie[]` is “CDP-ish” and tool-friendly:

- `name`, `value`, `domain`, `path`
- optional: `expires` (unix seconds), `secure`, `httpOnly`, `sameSite`
- `source` includes `browser` and optional `profile` (for debugging)

## Extension (`apps/extension`)

### Outputs (formats)

### 1) JSON (preferred)

Export a JSON file containing:

- top-level metadata: `version`, `generatedAt`, `source`, `browser`, `targetUrl`, `origins`
- `cookies`: array of cookie objects compatible with common “CDP-ish” shapes

Example shape:

```json
{
	"version": 1,
	"generatedAt": "2025-12-27T18:00:00.000Z",
	"source": "sweet-cookie",
	"browser": "chrome",
	"targetUrl": "https://chatgpt.com/",
	"origins": ["https://chatgpt.com/"],
	"cookies": [
		{
			"name": "__Secure-next-auth.session-token",
			"value": "…",
			"domain": "chatgpt.com",
			"path": "/",
			"secure": true,
			"httpOnly": true,
			"sameSite": "Lax",
			"expires": 1767225600
		}
	]
}
```

Notes:

- Some CDP APIs require `url` instead of `domain`; consumers can derive `url` from `targetUrl` + `domain` if needed.
- `expires` should be unix seconds when available; omit when session cookie.

### 2) Base64 payload (clipboard-friendly)

Same JSON as (1), then base64-encode the full JSON string.

## Inputs / UI

Popup UX (actual):

- Target URL input, prefilled from the active tab when available
- Extra origins (multi-line), optional
- Cookie allowlist (comma-separated names), optional
- `Copy JSON`, `Copy base64`, `Download`
- Preview area:
  - before export: config summary (`origins`, allowlist count, ready state)
  - after export: cookie count, top domains, redacted sample values

Defaults:

- `targetUrl` = active tab URL
- `origins` = `{targetUrl.origin}` plus any configured extras
- `allowlist` = empty (export all)
- invalid extra-origin lines are ignored
- persisted in `chrome.storage.local`: `extraOrigins`, `allowlist`

## Permissions model (Manifest V3)

Manifest:

- `cookies`
- `storage`
- `activeTab`
- optional host permissions: `*://*/*`

Runtime:

- On export, compute required origins and call `chrome.permissions.request({ origins })`
- Requested permissions use `protocol//hostname/*` patterns derived from normalized origins
- If denied, show a clear error; user retries by clicking export again
- `activeTab` is only used to prefill the target URL from the current tab

Why:

- Keeps install footprint small.
- Makes the permission request explicit at the point of export.

## Cookie collection algorithm

Inputs:

- `origins[]` (fully-qualified, https preferred)
- optional `allowlistNames: Set<string>`

Steps:

1. Normalize origins (force trailing `/`, drop query/hash)
2. For each origin:
   - Query `chrome.cookies.getAll({ url: origin })`
3. Merge + dedupe:
   - key = `${cookie.name}|${cookie.domain}|${cookie.path}|${cookie.storeId}`
4. Filter:
   - if allowlist is present: keep only matching cookie names
5. Serialize:
   - Map Chrome extension cookie fields to Sweet Cookie cookie fields:
     - `name`, `value`, `domain`, `path`
     - `secure`, `httpOnly`
     - `sameSite` (map Chrome enum to `Strict|Lax|None` strings)
     - `expires`: from `expirationDate` (seconds); omit if missing
     - strip a leading `.` from `domain`; if no domain is present, fall back to the origin hostname
   - Do not persist raw cookies beyond the export action

Important: avoid re-implementing RFC cookie matching/order. If we export for reuse, "set cookies" is what matters; ordering is not.

## Security / safety constraints

- No automatic/background exports. User gesture only.
- No network exfiltration. No remote endpoints.
- No logging raw cookie values (ever). UI should show redacted values only.
- Offer allowlist names as a first-class control.
- Persist only `extraOrigins` / `allowlist`; never cookie values.

## Versioning

- `version` integer in the exported JSON.
- Bump only on breaking schema changes.
- Include `generatedAt`, `targetUrl`, `origins`, `source`.

## Notes

- The popup preview does not pre-read cookies; cookie/domain summary appears after export.
- Export format stays `version: 1`; bump only on breaking schema changes.
