# Sweet Cookie usage guide

This guide covers the complete CLI surface, library options, source behavior, profile selection, and platform-specific browser support. Start with the [README](../README.md) for installation and a minimal example.

## CLI reference

```text
Usage: sweet-cookie <domain-or-url> [options]
```

The CLI accepts a domain or full URL. It prints cookie output to stdout and provider warnings to stderr.

| Option                         | Description                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `--browser <name>`             | Use `chrome`, `edge`, `firefox`, or `safari`; repeat or comma-separate.               |
| `--browsers <list>`            | Alias for `--browser`.                                                                |
| `--format <json\|header>`      | Print `{ "cookies": [...] }` JSON or an HTTP `Cookie:` header. Defaults to `json`.    |
| `--name <name>`                | Allow one or more cookie names; repeat or comma-separate.                             |
| `--origin <url>`               | Add an origin for OAuth or multi-domain flows; repeat or comma-separate.              |
| `--profile <value>`            | Set the shared Chrome/Edge profile selector.                                          |
| `--chrome-profile <value>`     | Set a Chrome profile name, directory, or cookie database path.                        |
| `--edge-profile <value>`       | Set an Edge profile name, directory, or cookie database path.                         |
| `--firefox-profile <value>`    | Set a Firefox profile name, directory, or `cookies.sqlite` path.                      |
| `--safari-cookies-file <path>` | Override the Safari `Cookies.binarycookies` path.                                     |
| `--chromium-browser <name>`    | On macOS or Linux, target `chrome`, `brave`, `arc`, or `chromium`; Arc is macOS-only. |
| `--mode <merge\|first>`        | Merge browser results or stop at the first backend with cookies. Defaults to `merge`. |
| `--include-expired`            | Include expired cookies.                                                              |
| `--timeout-ms <ms>`            | Set the timeout for operating-system helper calls.                                    |
| `--debug`                      | Include additional provider warnings; raw cookie values are never included.           |
| `--inline-file <path>`         | Read an inline JSON or base64 payload from a file.                                    |
| `--inline-json <json>`         | Read an inline JSON payload.                                                          |
| `--inline-base64 <base64>`     | Read a base64-encoded JSON payload.                                                   |
| `-h`, `--help`                 | Show CLI help.                                                                        |

Examples:

```bash
npx @steipete/sweet-cookie github.com
npx @steipete/sweet-cookie github.com --browser chrome --format header
npx @steipete/sweet-cookie app.example.com --origin https://login.example.com --name session
```

## Library API

The package exports `getCookies()`, `toCookieHeader()`, `ALL_PROFILES`, and their TypeScript types.

```ts
import { getCookies, toCookieHeader } from "@steipete/sweet-cookie";

const { cookies, warnings } = await getCookies({
	url: "https://app.example.com/",
	origins: ["https://accounts.example.com/"],
	names: ["session", "xsrf"],
	browsers: ["chrome", "edge", "firefox", "safari"],
	mode: "merge",
});

for (const warning of warnings) console.warn(warning);
const cookieHeader = toCookieHeader(cookies, { dedupeByName: true });
```

`getCookies()` returns `{ cookies, warnings }`. Cookies use a browser-compatible shape with `name`, `value`, and optional `domain`, `path`, `url`, `expires`, `secure`, `httpOnly`, `sameSite`, and source metadata. Warnings are non-fatal diagnostics and never contain raw cookie values.

`toCookieHeader()` joins valid `name=value` pairs. It sorts by name by default and can keep the first value for each name with `{ dedupeByName: true }`.

### Options

| Option                | Behavior                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `url`                 | Required base URL for origin filtering. Include a protocol.                                      |
| `origins`             | Additional origins for OAuth, SSO, or multi-domain flows.                                        |
| `names`               | Cookie-name allowlist.                                                                           |
| `browsers`            | Ordered sources: `chrome`, `edge`, `firefox`, `safari`. Defaults to Chrome, Safari, Firefox.     |
| `mode`                | `merge` combines backends; `first` stops after the first backend with cookies.                   |
| `profile`             | Shared alias for `chromeProfile` and `edgeProfile`.                                              |
| `chromeProfile`       | Chrome profile selector, selector array, or `ALL_PROFILES`.                                      |
| `chromiumBrowser`     | On macOS or Linux, pin the Chrome backend to Chrome, Brave, Arc, or Chromium; Arc is macOS-only. |
| `edgeProfile`         | Edge profile selector, selector array, or `ALL_PROFILES`.                                        |
| `firefoxProfile`      | Firefox profile selector, selector array, or `ALL_PROFILES`.                                     |
| `safariCookiesFile`   | Safari cookie-file override or array of overrides.                                               |
| `inlineCookiesJson`   | JSON string containing `Cookie[]` or `{ cookies: Cookie[] }`.                                    |
| `inlineCookiesBase64` | Base64-encoded JSON in either supported shape.                                                   |
| `inlineCookiesFile`   | Path to a JSON or base64 payload file.                                                           |
| `timeoutMs`           | Maximum duration for Keychain, keyring, or DPAPI helpers.                                        |
| `includeExpired`      | Include expired cookies; defaults to `false`.                                                    |
| `debug`               | Add provider diagnostics without raw values.                                                     |

The exported TypeScript definitions in [`packages/core/src/types.ts`](../packages/core/src/types.ts) are the canonical API reference.

## Source behavior

Inline sources run before browser backends in this order: JSON, base64, then file. Sweet Cookie returns immediately when an inline source yields cookies. This avoids database locks, operating-system credential prompts, and platform-specific decryption. If an inline source contains cookies whose isolation cannot be preserved and no later inline source yields cookies, Sweet Cookie returns an empty result with a warning instead of reading local browser stores.

Without an inline result, the configured browser backends run in order. The default order is Chrome, Safari, then Firefox. `mode: "merge"` combines results while preserving the first backend's value for a cookie with the same name, domain, host-only scope, and path. Host-only and domain cookies remain distinct. `toCookieHeader()` retains both scoped records by default; pass `{ dedupeByName: true }`, as the CLI does, when a consumer requires one value per name. `mode: "first"` returns the first backend result that contains cookies.

Local Chromium and Firefox reads copy the cookie database and its journal files to a temporary directory before querying. SQLite comes from `node:sqlite` on Node.js or `bun:sqlite` on Bun; the package has no native Node addon dependency.

## Profile selection

Chrome and Edge selectors accept:

- a profile directory name such as `Default` or `Profile 2`;
- a display name from Chromium's `Local State`, such as `Work`;
- a profile directory path;
- a `Network/Cookies` or `Cookies` database path;
- an array of selectors; or
- the exported `ALL_PROFILES` sentinel.

Firefox selectors accept a profile name, profile directory, `cookies.sqlite` path, selector array, or `ALL_PROFILES`. When omitted, Firefox uses `default-release` when present and otherwise the first discovered profile.

Safari has no profile selector. `safariCookiesFile` accepts one or more explicit `Cookies.binarycookies` paths for testing or debugging.

```ts
import { ALL_PROFILES, getCookies } from "@steipete/sweet-cookie";

await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	chromeProfile: ["Default", "Profile 2"],
});

await getCookies({
	url: "https://example.com/",
	browsers: ["firefox"],
	firefoxProfile: ALL_PROFILES,
});
```

On macOS, `chromiumBrowser` pins the Chrome backend to `chrome`, `brave`, `arc`, or `chromium`; the default checks Google Chrome and Brave roots. The selection also chooses the matching Keychain entry when `chromeProfile` is a custom path that does not identify its browser. On Linux, the backend defaults to native and Flatpak Google Chrome roots; set `chromiumBrowser` to target native or container roots for Chromium or Brave. On Windows, target another Chromium-family browser by passing its profile directory or cookie database through `chromeProfile`.

## Browser and platform details

| Backend           | Platforms             | Storage and decryption                                                                                    |
| ----------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| Chrome / Chromium | macOS, Windows, Linux | Modern Chromium cookie databases; Keychain on macOS, DPAPI on Windows, keyring or basic storage on Linux. |
| Edge              | macOS, Windows, Linux | Chromium database handling with Edge-specific paths and credentials.                                      |
| Firefox           | macOS, Windows, Linux | Reads `cookies.sqlite`; Linux discovery includes native, Snap, and Flatpak roots.                         |
| Safari            | macOS                 | Parses `Cookies.binarycookies` directly.                                                                  |

Chrome and Edge support modern Chromium cookie database schemas, roughly version 100 and newer. Profile databases may be read while the browser is open because Sweet Cookie queries a temporary snapshot.

Chromium `v20` App-Bound Encryption on Windows binds some cookie values to the browser process. When Sweet Cookie cannot decrypt one of those values, it skips that cookie, returns a warning, and keeps other readable cookies. Use the [extension exporter](../apps/extension) for those cookies. See [Chrome's App-Bound Encryption announcement](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html) for background.

## Environment variables

| Variable                                        | Purpose                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SWEET_COOKIE_BROWSERS`, `SWEET_COOKIE_SOURCES` | Default browser order as a comma- or space-separated list.                              |
| `SWEET_COOKIE_MODE`                             | Default `merge` or `first` mode.                                                        |
| `SWEET_COOKIE_CHROME_PROFILE`                   | Default Chrome profile selector; also the Edge fallback when its own variable is unset. |
| `SWEET_COOKIE_EDGE_PROFILE`                     | Default Edge profile selector.                                                          |
| `SWEET_COOKIE_FIREFOX_PROFILE`                  | Default Firefox profile selector.                                                       |
| `SWEET_COOKIE_LINUX_KEYRING`                    | Linux keyring mode: `gnome`, `kwallet`, or `basic`.                                     |
| `SWEET_COOKIE_CHROME_SAFE_STORAGE_PASSWORD`     | Linux Chrome safe-storage password override.                                            |
| `SWEET_COOKIE_CHROMIUM_SAFE_STORAGE_PASSWORD`   | Linux Chromium safe-storage password override.                                          |
| `SWEET_COOKIE_EDGE_SAFE_STORAGE_PASSWORD`       | Linux Edge safe-storage password override.                                              |
| `SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD`      | Linux Brave safe-storage password override.                                             |

Explicit function options take precedence over environment variables.

## Extension exporter

The extension in [`apps/extension`](../apps/extension) exports cookies from its current Chrome profile. It accepts a target URL, extra origins, and an optional cookie-name allowlist, then offers JSON, base64, and file outputs. The popup requests host permission for the entered origins at export time, stores only its origin and allowlist settings, and makes no network requests.

### Build and load in Chrome

Start with a checkout of this repository and the Node.js and pnpm versions listed under [Development](../README.md#development). From the repository root, run:

```bash
pnpm install --frozen-lockfile
pnpm --filter sweet-cookie-extension build
```

The build compiles the TypeScript and copies the static files into one unpacked extension directory:

```text
apps/extension/dist/
  manifest.json
  popup.html
  popup.css
  popup.js
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist` inside your checkout. These are Chrome's standard [unpacked extension loading steps](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked). Open Sweet Cookie from the toolbar's Extensions menu in the profile whose cookies you want to export.

Do not load `apps/extension` or `apps/extension/src`, or move `popup.html` beside the source manifest by hand. The source manifest refers to `popup.html`, which in turn needs `popup.css` and the compiled `popup.js`; the build assembles all four files in `dist`. Moving only the HTML does not compile the script.

After changing extension sources, run the build command again and click **Reload** on Sweet Cookie's card at `chrome://extensions`. Keep the generated directory in place while the unpacked extension is installed.

### Use the exported payload

Pass an exported payload back to the library through an inline option:

```ts
import { getCookies } from "@steipete/sweet-cookie";

await getCookies({
	url: "https://example.com/",
	inlineCookiesFile: "/path/to/sweet-cookie.cookies.json",
});
```

The JSON schema and extension behavior are documented in the [cookie extraction specification](spec.md).
