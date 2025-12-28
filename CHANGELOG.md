# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## 0.1.0 - 2025-12-28

Initial release.

### Added

- `@steipete/sweet-cookie` library
  - `getCookies(options)` API: best-effort cookie extraction from inline payloads and/or local browsers, returning `{ cookies, warnings }`.
  - `toCookieHeader(cookies, options)` helper: builds an HTTP `Cookie` header string with optional sort + `dedupeByName`.
  - Inline-first flow: inline payloads short-circuit browser reads when they produce any cookies.
  - Inline inputs:
    - `inlineCookiesJson`: accepts `Cookie[]` or `{ cookies: Cookie[] }`.
    - `inlineCookiesBase64`: base64-encoded JSON (same shapes as above).
    - `inlineCookiesFile`: file path; also a heuristic for `*.json` / `*.base64` inputs.
  - Origin filtering:
    - `url` defines the default origin scope.
    - `origins` adds extra origins (OAuth/SSO, multi-domain auth).
    - Host matching supports parent-domain cookies (e.g. `.google.com` for `gemini.google.com`).
  - Cookie filtering and shaping:
    - Optional `names` allowlist.
    - `includeExpired` toggle (default: exclude expired).
    - Emits tool-friendly `Cookie` objects (`name`, `value`, `domain`, `path`, optional `expires`, `secure`, `httpOnly`, `sameSite`, plus `source` metadata).
  - Source behavior controls:
    - `browsers` ordered sources (`chrome`, `edge`, `firefox`, `safari`).
    - `mode`: `merge` (default) to merge across backends, or `first` to return the first backend that yields cookies.
    - Profile selectors:
      - Chromium: `profile`, `chromeProfile`, `edgeProfile` accept profile name, profile dir path, or cookie DB path.
      - Firefox: `firefoxProfile` accepts profile name or dir path (resolves `cookies.sqlite`).
      - Safari: `safariCookiesFile` override (tests/debug).
  - Cross-runtime SQLite support: Node `node:sqlite` (Node >= 22) or `bun:sqlite` (Bun).
  - Robust locked-DB behavior: for Chromium + Firefox providers, copies cookie DB (+ `-wal`/`-shm` when present) to a temp snapshot before reading.
  - Warnings model: providers return non-fatal diagnostics and never include raw cookie values.

- Browser providers (library)
  - Chrome (Chromium cookie DB; modern schemas only)
    - macOS: reads “Chrome Safe Storage” from Keychain via `security`; AES-128-CBC cookie decrypt.
    - Linux: supports v10 (“peanuts”) + v11 (keyring “Safe Storage”); keyring probing via `secret-tool` (GNOME) or `kwallet-query` + `dbus-send` (KDE).
    - Windows: reads “Local State” DPAPI-wrapped master key via PowerShell; AES-256-GCM cookie decrypt (v10/v11/v20).
    - Chromium meta-version support: strips the 32-byte hash prefix from decrypted values when present.
  - Edge (Chromium cookie DB; modern schemas only)
    - macOS: reads “Microsoft Edge Safe Storage” from Keychain via `security`; AES-128-CBC cookie decrypt.
    - Linux: supports v10 (“peanuts”) + v11 (keyring “Safe Storage”) via `secret-tool` or `kwallet-query` + `dbus-send`.
    - Windows: reads “Local State” DPAPI-wrapped master key via PowerShell; AES-256-GCM cookie decrypt (v10/v11/v20).
  - Firefox (cookies.sqlite)
    - macOS/Linux/Windows: reads `cookies.sqlite` via Node/Bun SQLite, with profile discovery and `default-release` preference when present.
  - Safari (Cookies.binarycookies)
    - macOS: parses `Cookies.binarycookies` directly (no WebKit DB dependency), including common container locations.

- Env configuration (library)
  - `SWEET_COOKIE_BROWSERS` / `SWEET_COOKIE_SOURCES`: default browser order (comma/space-separated).
  - `SWEET_COOKIE_MODE`: `merge` or `first`.
  - `SWEET_COOKIE_CHROME_PROFILE`, `SWEET_COOKIE_EDGE_PROFILE`, `SWEET_COOKIE_FIREFOX_PROFILE`.
  - Linux keyrings:
    - `SWEET_COOKIE_LINUX_KEYRING=gnome|kwallet|basic` (or auto-detect).
    - `SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD`, `SWEET_COOKIE_EDGE_SAFE_STORAGE_PASSWORD` overrides.

- `apps/extension` (Chrome MV3 inline cookie exporter)
  - Export UI:
    - Target URL (defaults to active tab URL).
    - Extra origins (multi-line) for multi-domain auth.
    - Cookie allowlist (comma-separated names).
    - Live preview (counts + domains + redacted sample values).
  - Permissions model:
    - Requests optional host permissions at export-time for computed origins.
    - Fails closed with a clear error when permissions are denied.
  - Outputs:
    - Copy JSON to clipboard.
    - Copy base64 (clipboard-friendly).
    - Download JSON file.
    - Payload schema `version: 1` with provenance metadata (`generatedAt`, `source`, `browser`, `targetUrl`, `origins`, `cookies`).
  - Cookie collection:
    - Merges cookies across origins and dedupes by `name|domain|path|storeId`.
    - Maps Chrome cookie fields to Sweet Cookie’s CDP-ish cookie shape and normalizes `sameSite`.

