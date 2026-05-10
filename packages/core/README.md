# @steipete/sweet-cookie

Inline-first browser cookie extraction for local tooling (no native addons).

Supports:

- Inline payloads (JSON / base64 / file) — most reliable path.
- Local browser reads (best effort): Chrome, Edge, Firefox, Safari (macOS).
- On macOS, the `chrome` backend checks Chrome and Brave roots by default.
- Default browser order is `chrome`, `safari`, `firefox` unless `browsers` or env overrides it.

Install:

```bash
npm i @steipete/sweet-cookie
```

Usage:

```ts
import { getCookies, toCookieHeader } from "@steipete/sweet-cookie";

const { cookies, warnings } = await getCookies({
	url: "https://example.com/",
	names: ["session", "csrf"],
	browsers: ["chrome", "edge", "firefox", "safari"],
});

for (const w of warnings) console.warn(w);
const cookieHeader = toCookieHeader(cookies, { dedupeByName: true });
```

macOS-specific Chromium targeting:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	chromiumBrowser: "brave",
});
```

Linux/Windows Brave or other Chromium-family profiles:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	chromeProfile: "~/.config/BraveSoftware/Brave-Browser/Default",
});
```

Notes:

- `profile` is a shared alias for `chromeProfile` / `edgeProfile`.
- `chromiumBrowser` pins the macOS `chrome` backend to `chrome`, `brave`, `arc`, or `chromium`.
- Inline payloads win first; otherwise local backends run in declared order.
- On Linux/Windows, Brave and other Chromium-family profiles work via an explicit `chromeProfile` path.
- `edgeProfile` falls back to `SWEET_COOKIE_CHROME_PROFILE` when `SWEET_COOKIE_EDGE_PROFILE` is unset.
- On Linux, Chromium safe-storage overrides also support `SWEET_COOKIE_BRAVE_SAFE_STORAGE_PASSWORD`.

Docs + extension exporter: see the repo root README.
