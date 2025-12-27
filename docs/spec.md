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
- `browsers`: ordered sources (`chrome|safari|firefox`)
- `mode`: `merge` (default) or `first`
- `profile` / `chromeProfile`: Chrome profile name/path
- `firefoxProfile`: Firefox profile name/path
- `includeExpired`: include expired cookies
- Inline inputs (escape hatch):
  - `inlineCookiesJson`, `inlineCookiesBase64`, `inlineCookiesFile`

### Provider order

1) Inline sources (if any). First non-empty wins.
2) Local browsers in declared order:
   - **Chrome**
     - copy DB → query via `node:sqlite` (Node) or `bun:sqlite` (Bun)
     - decrypt:
       - macOS: Keychain `security` (Chrome Safe Storage)
       - Windows: DPAPI unwrap (Local State) + AES-GCM
      - Linux: v10 (peanuts) + v11 (keyring via `secret-tool` or `kwallet-query` + `dbus-send`)
     - app-bound cookies: expect failures; prefer inline/export
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

## Outputs (formats)

### 1) JSON (preferred)

Export a JSON file containing:
- `cookies`: array of cookie objects compatible with common “CDP-ish” shapes
- `meta`: versioning + provenance

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

Use-cases:
- quick transfer over chat

### 3) Puppeteer cookies (optional)

Some callers use Puppeteer’s cookie shape (`Secure`/`HttpOnly` capitalization). This is optional if you standardize on the library’s `Cookie` shape and only convert at the edges.

## Inputs / UI

Popup UX (minimal):
- Target URL input (default: current tab URL)
- Extra origins (multi-line), optional
- Cookie allowlist (comma-separated names), optional
- “Copy JSON”, “Copy base64”, “Download .json”
- “Dry preview” table: cookie count + domains + redacted values (first 6 chars)

Defaults:
- `targetUrl` = active tab URL
- `origins` = `{targetUrl.origin}` plus any configured extras
- `allowlist` = empty (export all) unless a preset is chosen

Presets (optional, for speed):
- “Site A” / “Site B” examples for repeated workflows

## Permissions model (Manifest V3)

We need:
- `cookies` permission
- host permissions for the relevant domains/origins

Prefer **optional host permissions** requested at runtime:
- On “Export”, compute required origins and call `chrome.permissions.request({ origins })`
- If denied, show a clear error and a “Grant permissions” retry button

Why:
- Keeps install footprint small.
- Makes the “this is reading cookies for these domains” explicit.

## Cookie collection algorithm

Inputs:
- `origins[]` (fully-qualified, https preferred)
- optional `allowlistNames: Set<string>`

Steps:
1) Normalize origins (force trailing `/`, drop query/hash)
2) For each origin:
   - Derive `domain` candidates:
     - If origin hostname is `localhost` or an IP: query via `url` matching (Chrome cookies API supports `url` filter).
     - Else: query `chrome.cookies.getAll({ url: origin })` (preferred; avoids home-grown domain logic).
3) Merge + dedupe:
   - key = `${cookie.name}|${cookie.domain}|${cookie.path}|${cookie.storeId}`
4) Filter:
   - if allowlist is present: keep only matching cookie names
5) Serialize:
   - Map Chrome extension cookie fields → CDP-ish `CookieParam` fields:
     - `name`, `value`, `domain`, `path`
     - `secure`, `httpOnly`
     - `sameSite` (map Chrome enum to `Strict|Lax|None` strings)
     - `expires`: from `expirationDate` (seconds); omit if missing
   - Do not persist raw cookies beyond the export action

Important: avoid re-implementing RFC cookie matching/order. If we export for reuse (Oracle/SweetLink), “set cookies” is what matters; ordering is not.

## Security / safety constraints

- No automatic/background exports. User gesture only.
- No network exfiltration. No remote endpoints.
- No logging raw cookie values (ever). UI should show redacted values only.
- Offer “allowlist names” as a first-class control.
- Prefer in-memory only. If we add “save presets”, store *only* domains/origins/allowlists, never values.

## Versioning

- `version` integer in the exported JSON.
- Bump only on breaking schema changes.
- Include `generatedAt`, `targetUrl`, `origins`, `source`.

## Open questions (decide early)

- Do we want a “cookie names allowlist” preset per target (ChatGPT/Gemini/X), or always export all and let tools filter?
- Do we ship a CLI companion (`sweet-cookie dump --url …`) that talks to the extension via native messaging / localhost? (likely no; keep extension-only first.)
- Should we support multiple cookie stores (`storeId`) explicitly, or just merge everything? (default merge.)
