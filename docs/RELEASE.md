# Pack Release Runbook

Pack releases are produced from the standalone extension repository, not from the
parent ComplyEaze app repository.

## Release cadence

Release Please opens a reviewed release PR whenever merged conventional commits
require a new Pack version. Patch releases use `fix`, minor releases use `feat`,
and breaking changes must be called out explicitly while Pack remains pre-1.0.
Merging the release PR updates `package.json`, `CHANGELOG.md`, and
`src/extension/version.ts`.

The `Conventional PR Title` workflow enforces the same commit vocabulary on PR
titles so squash merges continue to produce Release Please-visible history.

## Release gate

Run the full local release verification before tagging or store submission:

```sh
pnpm install --frozen-lockfile
node scripts/run-dependency-audit.mjs
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
pnpm verify:clean
pnpm exec wxt zip
node scripts/verify-extension-zip.mjs
node scripts/write-release-provenance.mjs
git diff --check
```

The release gate covers:

- WXT type generation;
- Prettier formatting;
- high-severity dependency audit;
- ESLint;
- TypeScript;
- Vitest unit tests;
- Chrome MV3 production build;
- built-package permission, CSP, and remote-code checks;
- clean worktree enforcement before release ZIP creation;
- store ZIP creation;
- exact-ZIP extraction, package-policy verification, SHA-256 output, checksum
  file generation, and checksum log evidence in CI;
- release provenance JSON with source commit, version, manifest permissions,
  homepage URL, ZIP asset name, and ZIP SHA-256.

## Automated GitHub release flow

The `Pack Release` workflow runs on pushes to `master` and through manual
dispatch. It performs the release gate first, then runs Release Please.

- When ordinary feature/fix commits are present, Release Please opens or updates
  a release PR. No GitHub release or store submission is created from a feature
  merge alone.
- When the release PR is merged, Release Please creates the `vX.Y.Z` GitHub
  release. The workflow marks Pack v0 releases as prereleases, uploads the
  verified Chrome ZIP, checksum, and `pack-release-provenance.v1.json`, then
  checks the uploaded asset digest and local/downloaded ZIP checksum against the
  recorded SHA-256.
- Generated `.output` files stay out of source control. The GitHub release
  assets are the public binary distribution and changelog artifact.

## PR Review Closure Before Tagging

Before tagging or producing the final store ZIP, verify that the release PR has
no unresolved post-merge review threads and that the latest Codex review applies
to the exact head that was merged:

```sh
pnpm review:gate -- --repo lamemustafa/pack --pr <number> --strict-head-review --required-review-author chatgpt-codex-connector --wait-head-review-ms 180000
```

Record the PR URL, head SHA, merge commit, and review-gate result in the release
notes. If Codex or another bot submits findings after merge, treat them as a
release blocker until fixed by a follow-up PR or answered with evidence.

The required CI `Review gate` workflow can pass after waiting for Codex when no
formal bot review is produced, because the external Codex reviewer is not a
deterministic CI service. Do not treat that as a store-readiness pass by itself.
For a release candidate, explicitly trigger `@codex review`, wait for the review
or document the missing-review gap, and keep the PR open for any later findings
before tagging.

## Manual clean-profile QA

Before submitting a ZIP to a browser store:

1. Load `.output/chrome-mv3` in a clean Chrome profile.
2. Confirm the permission prompt lists only GST Portal host access plus
   downloads/storage.
3. Open the popup outside GST domains and confirm the extension stays dormant.
4. Open Pack Options, run the synthetic demo, and confirm files are downloaded
   under `Pack-Demo/`.
5. Open the generated manifest and exceptions file and confirm all values are
   obviously synthetic.
6. Use the options page to clear local Pack data.
7. Reload the extension and confirm no previous synthetic manifest is shown.

Do not run live GST Portal automation for a public release candidate until legal
review and a current portal-compatibility pass have approved the exact behavior.

## Release artifact

Use WXT's generated Chrome ZIP from `.output/` as the store artifact only after
`node scripts/verify-extension-zip.mjs` extracts that exact ZIP, reruns the
package verifier against the extraction, and prints the checksum. Publish the
source tag, release ZIP artifact, ZIP checksum, and this release runbook together
so reviewers can reproduce the submitted build.

## Chrome Web Store submission

The official V0 listing is:

https://chromewebstore.google.com/detail/complyeaze-pack-gst-gstr/nfnbhekccajjfgkppolomflaeledoccb

The release workflow has a protected `chrome-web-store` environment job. The
automatic submission job runs only when the repository or organization variable
`CWS_SUBMIT_ENABLED` is exactly `true`. Keep the environment restricted to
maintainers and require approval while Pack is pre-1.0. The job downloads the
exact GitHub release ZIP instead of rebuilding it, then runs
`scripts/publish-chrome-web-store.mjs`.

Required GitHub Environment configuration:

- Repository or organization variable: `CWS_SUBMIT_ENABLED=true`.
- Variable: `CWS_PUBLISHER_ID`.
- Secret option A: `CWS_SERVICE_ACCOUNT_JSON`.
- Secret option B: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and
  `CWS_REFRESH_TOKEN`.

Use `Chrome Web Store Submit` with `dry_run=true` to validate an existing
release package without uploading. The workflow verifies the downloaded release
ZIP, checksum, provenance file, and GitHub asset digest before the publish
script runs. The publish script must receive the matching
`pack-release-provenance.v1.json` file so dry-runs and uploads validate the
downloaded release version instead of the workflow checkout's `package.json`
version.

Use `Chrome Web Store Status` after a submit run. It calls the Chrome Web Store
API `fetchStatus` endpoint, prints a bounded status summary, and fails on
rejected, cancelled, failed, warned, or taken-down states. By default it
succeeds while the expected version is submitted but still pending review;
dispatch it with `require_published=true` when final publication, not just
submission, is the release gate.

Configure the status workflow with a dedicated `chrome-web-store-status`
environment that has no required reviewer protection. Give it a read-only
service-account `CWS_SERVICE_ACCOUNT_JSON` secret plus `CWS_PUBLISHER_ID`; do
not copy the publish workflow's OAuth client secret or refresh token into this
environment. Keep the publishing workflow on the protected `chrome-web-store`
environment.

For local dry-runs against a generated release package:

```sh
node scripts/publish-chrome-web-store.mjs \
  --zip .output/complyeazepack-<version>-chrome.zip \
  --provenance .output/pack-release-provenance.v1.json \
  --publisher-id <publisher-id> \
  --dry-run true
```

For a local status check:

```sh
node scripts/check-chrome-web-store-status.mjs \
  --publisher-id <publisher-id> \
  --expected-version <version>
```

Do not move listing/support/homepage URLs in the Chrome dashboard without
updating `src/extension/manifest-policy.ts`, this runbook, and the public Pack
site.

## Chrome Web Store listing assets

Source-controlled dashboard image exports are generated from synthetic SVG
sources under `docs/chrome-web-store/assets/`. Run:

```sh
pnpm store:assets
```

This writes the PNG dashboard uploads and `asset-hashes.json` under
`docs/chrome-web-store/assets/exports/`. Re-run it whenever the SVG source
assets change, then visually inspect the generated PNGs before uploading them to
the Chrome Web Store dashboard. The exports must not contain real GST Portal
screenshots, taxpayer names, GSTIN/PAN values, portal HTML, downloaded GST
files, local paths, cookies, headers, OTPs, or CAPTCHA content.

## Google OAuth credential maintenance

The Chrome Web Store API OAuth app must stay production-ready if it is used for
repeatable release automation. Configure Google Auth Platform branding with full
URLs, not bare domains. This OAuth app is separate from the public Chrome Web
Store item homepage:

- Application home page: `https://pack.complyeaze.com/release-automation`
- Application privacy policy link: `https://pack.complyeaze.com/privacy`
- Application Terms of Service link: `https://pack.complyeaze.com/terms`
- Authorized domain: `complyeaze.com`

Keep `extensions@complyeaze.com` or another monitored release account as the
OAuth user support and developer contact. Submit and publish branding before
requesting data-access verification for the Chrome Web Store API scope.

If OAuth is left in external testing mode, refresh tokens for non-basic scopes
expire after roughly seven days. Move the app to production and complete the
required branding/data-access verification before relying on the token for
future releases, or replace the GitHub environment `CWS_REFRESH_TOKEN` before
the next submission.
