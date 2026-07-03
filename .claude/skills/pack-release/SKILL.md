---
name: pack-release
description: Walks through cutting a Pack release end-to-end (verify, clean, zip, verify-zip, provenance, Release Please, Chrome Web Store submission). This is a real side-effecting action — only run it when a person explicitly invokes /pack-release. Never trigger this on your own just because a conversation mentions releasing, tagging, or shipping.
disable-model-invocation: true
---

# Pack Release

Ground everything here in `docs/RELEASE.md` — it is the authoritative release
runbook. If `docs/RELEASE.md` has drifted from this skill, trust the doc and
flag the mismatch to the user rather than silently following stale steps here.

Read `docs/RELEASE.md` in full before doing anything else in this skill.

## Before you start

- Confirm you are on the branch/worktree the user intends to release from, and
  that `git status` is clean or the user has explicitly accepted an unclean
  state.
- Confirm Node 22.13.0 and pnpm 11.1.2 are active (`node -v`, `pnpm -v`) —
  these are the exact pinned versions used in CI; do not substitute others.
- This skill performs real, externally visible actions once you reach the
  Release Please / GitHub release / Chrome Web Store steps. Do not run those
  steps speculatively — confirm with the user before pushing to `master`,
  merging a release PR, or invoking the Chrome Web Store submission script.

## Ordered release flow

Run these in order. Stop and surface the failure if any step fails — do not
skip ahead or "fix forward" past a failing gate without the user's input.

1. **Install (frozen lockfile)**
   ```sh
   pnpm install --frozen-lockfile
   ```

2. **Verify — the full local release gate**
   ```sh
   pnpm verify:release
   ```
   This expands to `verify:local` (dependency audit, `wxt prepare`, Prettier,
   ESLint, `tsc --noEmit`, Vitest, `wxt build`, package-policy verification,
   `git diff --check`) plus `verify:clean`, `wxt zip`, and
   `verify-extension-zip.mjs`. If you need to run the pieces individually
   instead of the combined script, see `docs/RELEASE.md`'s "Release gate"
   section for the exact command sequence.

3. **Clean worktree assertion**
   ```sh
   pnpm verify:clean
   ```
   This is also invoked inside `verify:release`, but re-run it standalone if
   you made any changes between steps (e.g. a fix for a failed gate). A
   release ZIP must never be built from a dirty worktree.

4. **Zip**
   ```sh
   pnpm exec wxt zip
   ```
   Produces the Chrome MV3 store ZIP under `.output/`. Do not commit this file
   — `.output/` is generated and gitignored.

5. **Verify the exact ZIP**
   ```sh
   pnpm verify:zip
   ```
   Extracts the just-built ZIP, reruns the package-policy verifier against
   the extraction (permissions, CSP, no remote code), and prints the SHA-256.
   Record this checksum — it must match what later appears on the GitHub
   release asset.

6. **Write release provenance**
   ```sh
   pnpm release:provenance
   ```
   Generates `pack-release-provenance.v1.json` recording source commit,
   version, manifest permissions, homepage URL, ZIP asset name, and ZIP
   SHA-256. This file is what later dry-run/publish steps validate against —
   not the checked-out `package.json` version — so do not skip it.

7. **PR review closure check (before tagging)**
   ```sh
   pnpm review:gate -- --repo lamemustafa/pack --pr <number> --strict-head-review \
     --required-review-author chatgpt-codex-connector --wait-head-review-ms 180000
   ```
   Confirms the release PR has no unresolved post-merge review threads and
   that the latest automated review applies to the exact merged head. Treat
   any post-merge findings as a release blocker until fixed or explicitly
   dispositioned. See `docs/RELEASE.md`'s "PR Review Closure Before Tagging"
   section for why a passing CI `Review gate` run alone is not sufficient
   store-readiness evidence.

8. **Release Please**
   - Ordinary `fix`/`feat` commits merged to `master` cause Release Please to
     open or update a release PR (via the `Pack Release` GitHub Actions
     workflow). No GitHub release or store submission happens from a feature
     merge alone.
   - Merging the Release Please PR updates `package.json`, `CHANGELOG.md`, and
     `src/extension/version.ts`, then Release Please cuts the `vX.Y.Z` GitHub
     release. Pack v0 releases are marked as prereleases.
   - The workflow then uploads the verified ZIP, checksum, and
     `pack-release-provenance.v1.json` as release assets and verifies the
     uploaded asset digest matches the recorded SHA-256
     (`verify-github-release-assets.mjs`).

9. **Chrome Web Store submission (gated, do not force)**
   - This only runs automatically as a follow-on GitHub Actions job, and only
     when both conditions hold: the release job's `release_created` output is
     `true`, AND the repository/organization variable `CWS_SUBMIT_ENABLED` is
     exactly `true`.
   - It downloads the exact GitHub release ZIP (never rebuilds it) and runs
     `scripts/publish-chrome-web-store.mjs` with the matching provenance file.
   - For a local dry run against an already-built release package:
     ```sh
     node scripts/publish-chrome-web-store.mjs \
       --zip .output/complyeazepack-<version>-chrome.zip \
       --provenance .output/pack-release-provenance.v1.json \
       --publisher-id <publisher-id> \
       --dry-run true
     ```
   - Never flip `CWS_SUBMIT_ENABLED` on, or manually invoke the non-dry-run
     publish path, without the user explicitly asking for a live store
     submission. This is the one step in this flow that pushes a public
     listing update.

## Manual clean-profile QA (before store submission)

Before treating a ZIP as store-ready, do the manual smoke test described in
`docs/RELEASE.md`'s "Manual clean-profile QA" section: load
`.output/chrome-mv3` in a clean Chrome profile, confirm the permission prompt
lists only the 3 GST hosts plus downloads/storage, confirm the popup stays
dormant off GST domains, run the synthetic demo from Pack Options, confirm
downloaded files land under `Pack-Demo/`, confirm the generated manifest and
exceptions file look obviously synthetic, clear local Pack data from Options,
and reload to confirm no stale synthetic manifest persists.

Do not run live GST Portal automation as part of a release candidate check —
that requires a separate legal review and current portal-compatibility pass
per `docs/RELEASE.md`.

## Reference: full one-shot gate command

If you want the whole local gate in one shot instead of the step-by-step
`pnpm verify:release` script, `docs/RELEASE.md`'s "Release gate" section has
the exact expanded command sequence (frozen install through
`write-release-provenance.mjs` and `git diff --check`). Prefer the `pnpm`
script targets above for day-to-day use; fall back to the expanded sequence
only if you need to debug which specific step is failing.

## Source-first public claims

Any release notes, PR description, or public copy you draft as part of this
flow must stay "source-first alpha" phrasing unless exact evidence proves a
stronger claim. Do not claim Chrome Web Store readiness, legal approval,
broad GST support, cloud sync, or durable full-year completeness unless
`docs/PUBLICATION_READINESS.md`'s gates are actually satisfied. Keep the
government-non-affiliation disclaimer visible on any public-facing surface
you touch.

## Do not

- Do not paste cookies, session tokens, GSTIN/PAN, taxpayer names, ARNs, real
  downloaded files, portal HTML, or local filesystem paths into any release
  note, PR, or commit message produced by this flow.
- Do not commit `.output/`, release ZIPs, checksums, or browser profiles.
- Do not mark a release "ready" or "mergeable" until GitHub Actions checks
  pass and any automated review bot's findings are addressed or explicitly
  dispositioned.
- Do not enable or rely on `CWS_SUBMIT_ENABLED` without explicit user
  instruction — that variable controls a real, live Chrome Web Store
  submission.
