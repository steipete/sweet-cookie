# Sweet Cookie 🍪 — Inline-first browser cookie extraction

Small, dependency-light cookie extraction for local tooling.

It’s built around two ideas:

1. **Prefer inline cookies** when you can (most reliable, works everywhere).
2. **Best-effort local reads** when you want zero-manual steps.

## Why

Browser cookies are hard in practice:

- Profile databases can be locked while the browser is running.
- Values may be encrypted (Keychain/DPAPI/keyring).
- Native addons (`sqlite3`, `keytar`, …) are a constant source of rebuild/ABI pain across Node/Bun and CI.

Sweet Cookie avoids native Node addons by design:

- SQLite: `node:sqlite` (Node) or `bun:sqlite` (Bun)
- OS integration: shelling out to platform tools with timeouts (`security`, `powershell`, `secret-tool`, `kwallet-query`)

## What’s included

- `@steipete/sweet-cookie`: the library (`getCookies()`, `toCookieHeader()`).
- `apps/extension`: a Chrome/Chromium MV3 exporter that produces an inline cookie payload (JSON/base64/file) for the cases where local reads can’t work (app-bound cookies, keychain prompts, remote machines, etc.).

## Requirements

- Node `>=22` (for `node:sqlite`) or Bun (for `bun:sqlite`)
- Local usage only: this reads from your machine’s browser profiles.

## Install

```bash
npm i @steipete/sweet-cookie
# or: pnpm add @steipete/sweet-cookie
# or: bun add @steipete/sweet-cookie
```

## Install (repo/dev)

```bash
pnpm i
```

## Library usage

Minimal: read a couple cookies and build a header.

```ts
import { getCookies, toCookieHeader } from "@steipete/sweet-cookie";

const { cookies, warnings } = await getCookies({
	url: "https://example.com/",
	names: ["session", "csrf"],
	browsers: ["chrome", "edge", "firefox", "safari"],
});

for (const warning of warnings) console.warn(warning);

const cookieHeader = toCookieHeader(cookies, { dedupeByName: true });
```

If `browsers` is omitted, Sweet Cookie defaults to `["chrome", "safari", "firefox"]`.

Multiple origins (common with OAuth / SSO redirects):

```ts
const { cookies } = await getCookies({
	url: "https://app.example.com/",
	origins: ["https://accounts.example.com/", "https://login.example.com/"],
	names: ["session", "xsrf"],
	browsers: ["chrome"],
	mode: "merge",
});
```

Pick a specific profile or pass an explicit Chrome cookie DB path:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"], // or ['edge']
	chromeProfile: "Default", // or '/path/to/.../Network/Cookies'
});
```

`profile` is a shared alias for `chromeProfile` / `edgeProfile` when you want one override for Chromium backends.

Target Brave on Linux or another Chromium-family profile by passing the actual profile dir / DB path:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	chromeProfile: "~/.config/BraveSoftware/Brave-Browser/Default",
});
```

Target a specific Chromium-family browser on macOS:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	chromiumBrowser: "arc", // 'chrome' | 'brave' | 'arc' | 'chromium'
});
```

Pick a specific Edge profile or pass an explicit Edge cookie DB path:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["edge"],
	edgeProfile: "Default", // or '/path/to/.../Network/Cookies'
});
```

Inline cookies (works on any OS/runtime; no browser DB access required):

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	inlineCookiesFile: "/path/to/cookies.json", // or inlineCookiesJson / inlineCookiesBase64
});
```

If any inline source yields cookies, Sweet Cookie returns that result immediately and skips local browser reads.

## Supported browsers / platforms

- `chrome` (Chromium-based): macOS / Windows / Linux
  - Default discovery targets Google Chrome paths.
  - On macOS, the default `chrome` backend checks Google Chrome and Brave roots. `chromiumBrowser` can pin `chrome`, `brave`, `arc`, or `chromium`.
  - On Linux/Windows, Brave and other Chromium-family profiles work when you pass an explicit `chromeProfile` path to that profile or `Cookies` DB.
  - Other Chromium browsers typically work by passing `chromeProfile` as an explicit `Cookies` DB path.
  - Only supports modern Chromium cookie DB schemas (roughly Chrome `>=100`).
- `edge` (Chromium-based): macOS / Windows / Linux
  - Default discovery targets Microsoft Edge paths.
  - Only supports modern Chromium cookie DB schemas (roughly Edge/Chrome `>=100`).
- `firefox`: macOS / Windows / Linux
- `safari`: macOS only (reads `Cookies.binarycookies`)

## Options (high-signal)

- `url` (required): base URL used for origin filtering.
- `origins`: additional origins to consider (deduped).
- `names`: allowlist cookie names.
- `browsers`: source order (`chrome`, `edge`, `firefox`, `safari`).
- default browser order: `chrome`, `safari`, `firefox`.
- `mode`: `merge` (default) or `first`.
- `profile`: shared alias for `chromeProfile` / `edgeProfile`.
- `chromeProfile`: Chrome profile name/path (profile dir or `Cookies` DB file).
- `chromiumBrowser`: macOS-only explicit Chromium-family target for the `chrome` backend (`chrome|brave|arc|chromium`).
- `edgeProfile`: Edge profile name/path (profile dir or `Cookies` DB file).
- `firefoxProfile`: Firefox profile name/path.
- `safariCookiesFile`: override path to `Cookies.binarycookies` (tests/debug).
- Inline sources: `inlineCookiesJson`, `inlineCookiesBase64`, `inlineCookiesFile`.
- `timeoutMs`: max time for OS helper calls (keychain/keyring/DPAPI).
- `includeExpired`: include expired cookies in results.
- `debug`: add extra provider warnings (primarily Chromium providers; never raw cookie values).

## Env

- `SWEET_COOKIE_BROWSERS` / `SWEET_COOKIE_SOURCES`: `chrome,edge,safari,firefox`
- `SWEET_COOKIE_MODE`: `merge|first`
- `SWEET_COOKIE_CHROME_PROFILE`, `SWEET_COOKIE_EDGE_PROFILE`, `SWEET_COOKIE_FIREFOX_PROFILE`
- `SWEET_COOKIE_EDGE_PROFILE` falls back to `SWEET_COOKIE_CHROME_PROFILE` when unset
- Linux-only: `SWEET_COOKIE_LINUX_KEYRING=gnome|kwallet|basic`, `SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD=...`, `SWEET_COOKIE_EDGE_SAFE_STORAGE_PASSWORD=...`, `SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD=...`

## Inline cookie payload format

Sweet Cookie accepts either a plain `Cookie[]` or `{ cookies: Cookie[] }`.
The extension export format is documented in `docs/spec.md`.

`inlineCookiesFile` accepts a file path. Paths ending in `.json` or `.base64` are treated as files first, then parsed as JSON/base64 payloads.

## Extension exporter

`apps/extension` is a small Chrome MV3 popup that exports cookies from the current profile into the same inline format the library consumes.

Current behavior:

- Inputs: target URL (prefilled from the active tab when available), extra origins, cookie-name allowlist.
- Actions: Copy JSON, Copy base64, Download JSON (`sweet-cookie.cookies.json`).
- Permissions: runtime host-permission request on export for the exact origins entered.
- Local persistence: extra origins + allowlist in `chrome.storage.local`.
- Network: none. User-triggered only.
- Preview:
  - before export: origin count, allowlist count, ready state
  - after export: cookie count, top domains, redacted sample values

## Development

```bash
pnpm check
pnpm build
pnpm test
pnpm test:bun
```
