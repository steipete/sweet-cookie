# Release checklist (npm + GitHub)

Target destinations:
- npm: `@steipete/sweet-cookie` (library only; published from `packages/core`)
- GitHub: tag + GitHub Release (notes)

## 0) Preflight

- [ ] Clean git: `git status`
- [ ] Auth:
  - [ ] `gh auth status`
  - [ ] `npm whoami` (if this fails: `npm login --auth-type=web`)

## 1) Version sources (keep in sync)

- [ ] `packages/core/package.json` `version`
- [ ] `CHANGELOG.md` section `## <version> - <date>`
- [ ] Git tag `v<version>`

Helper:
```bash
ver="$(node -p 'require(\"./packages/core/package.json\").version')"
echo "$ver"
```

## 2) Changelog

- [ ] Update `CHANGELOG.md` for the new version (date + product-facing bullets)

## 3) Build outputs are committed

This repo keeps `packages/core/dist/` tracked for git-based consumption.

- [ ] `pnpm -s build`
- [ ] Ensure `packages/core/dist/` updated (no uncommitted build output)

## 4) Gates (no warnings)

- [ ] `pnpm -s lint`
- [ ] `pnpm -s typecheck`
- [ ] `pnpm -s test`
- [ ] `pnpm -s test:bun`

## 5) Package sanity (before publish)

- [ ] Ensure package is publishable:
  - [ ] `packages/core/package.json` has **no** `"private": true`
  - [ ] `publishConfig.access` is `public`
- [ ] Inspect tarball contents:
  - [ ] `cd packages/core && npm pack --dry-run`

## 6) Commit + push

- [ ] Commit (include dist updates): `committer "chore(release): <version>" <paths…>`
- [ ] Push: `git push`

## 7) Tag

```bash
ver="$(node -p 'require(\"./packages/core/package.json\").version')"
git tag -a "v${ver}" -m "v${ver}"
git push origin "v${ver}"
```

## 8) Publish to npm

From `packages/core`:
```bash
cd packages/core
npm publish
```

Verify:
```bash
npm view @steipete/sweet-cookie version
```

Smoke (fresh directory):
```bash
rm -rf /tmp/sweet-cookie-smoke && mkdir -p /tmp/sweet-cookie-smoke
cd /tmp/sweet-cookie-smoke
npm init -y >/dev/null
npm i @steipete/sweet-cookie@"${ver}"
node -e "import { getCookies, toCookieHeader } from '@steipete/sweet-cookie'; console.log(typeof getCookies, typeof toCookieHeader);"
```

## 9) GitHub Release (notes)

Create release notes from `CHANGELOG.md` section:
```bash
ver="$(node -p 'require(\"./packages/core/package.json\").version')"
awk -v start="$ver" '
  BEGIN { p=0 }
  $0 ~ ("^## " start " ") { p=1; next }
  $0 ~ "^## " { if (p) exit }
  p { print }
' CHANGELOG.md >"/tmp/sweet-cookie-v${ver}-notes.md"
```

Create the GitHub release:
```bash
gh release create "v${ver}" \
  --title "v${ver}" \
  --notes-file "/tmp/sweet-cookie-v${ver}-notes.md"
```

Verify rendering (real newlines):
```bash
gh release view "v${ver}" --json body --jq .body | head
```

