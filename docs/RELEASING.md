# Releasing sweet-cookie

The [release workflow](../.github/workflows/release.yml) publishes `@steipete/sweet-cookie` through the shared `openclaw/release-workflows` npm archetype pinned at `@v1`. GitHub Actions owns npm publication and the GitHub Release; npm trusts this repository's **`release.yml`** caller through GitHub OIDC. No npm token or local publishing command is needed.

## Prepare and prove

1. Protect `main`, then prepare the package version and exactly one dated `##` section in `CHANGELOG.md` in a pull request. Keep an `Unreleased` section for subsequent work. Keep the pinned pnpm version aligned with `package.json`.
2. Run `pnpm check && pnpm test` and `pnpm build`, merge the reviewed preparation, and wait for successful push CI on the exact merged commit.
3. Dispatch **Release** on current `main` with the package version and **`dry_run: true`** (the default). This must validate and build that exact main commit, pack the package, and install and smoke-test the frozen tarball on clean x64 and arm64 Linux runners. It creates no tags, npm versions, or GitHub Releases. Existing version tags remain untouched.

The shared archetype must include its protected-main dry-run fix: earlier `@v1` revisions selected an existing version tag instead of main. A successful run must identify the merged main SHA as its frozen source. Never treat a proof of an older tag as proof of the preparation commit.

## Publish after approval

After an explicit release request, push a signed annotated `vX.Y.Z` tag at the prepared commit. The workflow verifies SSH signatures against [release-allowed-signers](../.github/release-allowed-signers). Alternatively, dispatch **Release** from protected main with the prepared version and `dry_run: false`; this creates an immutable annotated tag after validation. Dispatch publication does not create an SSH signature; use the signed-tag path when one is required.

The workflow checks package metadata, dated notes, protected-branch ancestry, and independent push CI on the exact frozen commit. It packs without publishing credentials, independently verifies and smoke-tests the same tarball on both architectures, then publishes the verified bytes using npm trusted publishing and verifies registry integrity, signatures, and commit-bound provenance. The GitHub Release contains the changelog notes, tarball, package plan, inventory, and `SHA256SUMS`.

Never move a version tag, overwrite release assets, or republish a version. A retry can only accept an already published npm version when the registry bytes match the frozen payload exactly. Use the immutable tag ref for a live retry; do not try to release an old version from newer main.

## Verify and close out

Read `npm view @steipete/sweet-cookie@X.Y.Z version dist-tags dist.tarball dist.integrity time --json` and the matching GitHub Release. Verify the release checksums and successful provenance job, and keep the next `Unreleased` section ready. These read-only checks and local build/pack inspection remain available; the former local npm/GitHub publication checklist is retired.

This package has no Homebrew formula, signed macOS artifacts, or Sparkle feed. No repository release secrets are required. Trusted publishing must list `@steipete/sweet-cookie` → `steipete/sweet-cookie` → `release.yml` with publishing allowed.

Only `packages/core` is published. The workspace root stays private. Keep tracked `packages/core/dist/` in sync for git consumers; release verification uses synthetic inline cookies and never reads browser profiles or Keychain data. CI separately covers Bun and macOS/Windows.
