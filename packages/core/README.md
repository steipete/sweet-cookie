# @steipete/sweet-cookie

Inline-first browser cookie extraction for local tooling (no native addons).

Supports:

- Inline payloads (JSON / base64 / file) — most reliable path.
- Local browser reads (best effort): Chrome, Edge, Firefox, Safari (macOS).
- On macOS, the `chrome` backend checks Chrome and Brave roots by default.
- On Linux, the `chrome` backend checks native and Flatpak Google Chrome roots by default. Set `chromiumBrowser` to target native or container roots for Chromium or Brave.
- Default browser order is `chrome`, `safari`, `firefox` unless `browsers` or env overrides it.

Install:

```bash
npm i @steipete/sweet-cookie
```

CLI:

```bash
npx @steipete/sweet-cookie github.com
npx @steipete/sweet-cookie github.com --browser chrome --format header
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

macOS and Linux Chromium targeting:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	chromiumBrowser: "brave",
});
```

Windows Brave or other Chromium-family profiles:

```ts
await getCookies({
	url: "https://example.com/",
	browsers: ["chrome"],
	chromeProfile: "~/.config/BraveSoftware/Brave-Browser/Default",
});
```

Notes:

- `profile` is a shared alias for `chromeProfile` / `edgeProfile`.
- `chromiumBrowser` pins the macOS or Linux `chrome` backend to `chrome`, `brave`, `arc`, or `chromium`; Arc is macOS-only.
- On macOS, `chromiumBrowser` also selects the matching Keychain entry, including for custom profile paths.
- Inline payloads win first; otherwise local backends run in declared order.
- Cookie results preserve `hostOnly`; exact-host and domain scope remain distinct during filtering and deduplication.
- Partitioned Chromium cookies and partitioned or container-scoped Firefox cookies are excluded with warnings because replay cannot preserve their isolation context.
- On Windows, Brave and other Chromium-family profiles work via an explicit `chromeProfile` path.
- `edgeProfile` falls back to `SWEET_COOKIE_CHROME_PROFILE` when `SWEET_COOKIE_EDGE_PROFILE` is unset.
- On Linux, safe-storage overrides support Chrome, Chromium, Edge, and Brave.

Docs + extension exporter: see the repo root README.
