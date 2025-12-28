# Sweet Cookie 🍪 — Inline-first browser cookie extraction (no native addons)

Small, dependency-light cookie extraction for local tooling.

It’s built around two ideas:
1) **Prefer inline cookies** when you can (most reliable, works everywhere).
2) **Best-effort local reads** when you want zero-manual steps.

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
- `apps/extension`: a Chrome MV3 exporter that produces an inline cookie payload (JSON/base64/file) for the cases where local reads can’t work (app-bound cookies, keychain prompts, remote machines, etc.).

## Requirements

- Node `>=22` (for `node:sqlite`) or Bun (for `bun:sqlite`)
- Local usage only: this reads from your machine’s browser profiles.

## Install (repo)

```bash
pnpm i
```

## Library usage

Minimal: read a couple cookies and build a header.

```ts
import { getCookies, toCookieHeader } from '@steipete/sweet-cookie';

const { cookies, warnings } = await getCookies({
  url: 'https://example.com/',
  names: ['session', 'csrf'],
  browsers: ['chrome', 'edge', 'firefox', 'safari'],
});

for (const warning of warnings) console.warn(warning);

const cookieHeader = toCookieHeader(cookies, { dedupeByName: true });
```

Multiple origins (common with OAuth / SSO redirects):

```ts
const { cookies } = await getCookies({
  url: 'https://app.example.com/',
  origins: ['https://accounts.example.com/', 'https://login.example.com/'],
  names: ['session', 'xsrf'],
  browsers: ['chrome'],
  mode: 'merge',
});
```

Pick a specific profile or pass an explicit Chrome cookie DB path:

```ts
await getCookies({
  url: 'https://example.com/',
  browsers: ['chrome'], // or ['edge']
  chromeProfile: 'Default', // or '/path/to/.../Network/Cookies'
});
```

Pick a specific Edge profile or pass an explicit Edge cookie DB path:

```ts
await getCookies({
  url: 'https://example.com/',
  browsers: ['edge'],
  edgeProfile: 'Default', // or '/path/to/.../Network/Cookies'
});
```

Inline cookies (works on any OS/runtime; no browser DB access required):

```ts
await getCookies({
  url: 'https://example.com/',
  browsers: ['chrome'],
  inlineCookiesFile: '/path/to/cookies.json', // or inlineCookiesJson / inlineCookiesBase64
});
```

## Supported browsers / platforms

- `chrome` (Chromium-based): macOS / Windows / Linux
  - Default discovery targets Google Chrome paths.
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
- `mode`: `merge` (default) or `first`.
- `chromeProfile`: Chrome profile name/path (profile dir or `Cookies` DB file).
- `edgeProfile`: Edge profile name/path (profile dir or `Cookies` DB file).
- `firefoxProfile`: Firefox profile name/path.
- `safariCookiesFile`: override path to `Cookies.binarycookies` (tests/debug).
- Inline sources: `inlineCookiesJson`, `inlineCookiesBase64`, `inlineCookiesFile`.
- `timeoutMs`: max time for OS helper calls (keychain/keyring/DPAPI).
- `includeExpired`: include expired cookies in results.
- `debug`: add extra provider warnings (no raw cookie values).

## Env

- `SWEET_COOKIE_BROWSERS` / `SWEET_COOKIE_SOURCES`: `chrome,safari,firefox`
- `SWEET_COOKIE_MODE`: `merge|first`
- `SWEET_COOKIE_CHROME_PROFILE`, `SWEET_COOKIE_EDGE_PROFILE`, `SWEET_COOKIE_FIREFOX_PROFILE`
- Linux-only: `SWEET_COOKIE_LINUX_KEYRING=gnome|kwallet|basic`, `SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD=...`, `SWEET_COOKIE_EDGE_SAFE_STORAGE_PASSWORD=...`

## Inline cookie payload format

Sweet Cookie accepts either a plain `Cookie[]` or `{ cookies: Cookie[] }`.
The extension export format is documented in `docs/spec.md`.

## Development

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:bun
```
