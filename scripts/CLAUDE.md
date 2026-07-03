## Scripts Directory

One-line purpose per script, plus whether it runs in CI or is local/manual-only.
Verified against actual file contents and `.github/workflows/*.yml` on 2026-07-03.

### CI-invoked (ci.yml and/or release.yml)

- `verify-extension-package.mjs` — validates a built `.output/chrome-mv3` dir against
  `policies/agent-harness-policy.snapshot.json` (locked permissions/hosts, redaction
  patterns, no forbidden GST-portal-pathful URLs baked into the bundle).
- `verify-extension-zip.mjs` — unzips the release ZIP, re-runs package verification on
  the extracted contents, prints its SHA-256, then runs the headed-browser check.
- `verify-extension-browser.mjs` — launches the built extension in real headed
  Playwright Chromium and asserts it loads/behaves as expected (not just static checks).
- `write-release-provenance.mjs` — records source commit, tag, ZIP SHA-256, and
  manifest version into a provenance JSON uploaded as a release asset (release.yml only).
- `run-release-please.mjs` — drives `release-please` programmatically to open/update
  the release PR or cut a GitHub release (release.yml only).
- `verify-github-release-assets.mjs` — re-downloads/checks a tagged GitHub release's
  ZIP + checksum + provenance for consistency before Chrome Web Store submission.
- `publish-chrome-web-store.mjs` — uploads and publishes the verified ZIP via the
  Chrome Web Store API (only runs when `release_created` and `CWS_SUBMIT_ENABLED`).

### CI-invoked (other workflows)

- `check-conventional-pr-title.mjs` — validates `PR_TITLE` against the allowed
  Conventional Commits types/pattern (pr-title.yml).
- `check-pack-workflow-preflight.mjs` — checks branch name, clean worktree, and
  guidance freshness; run by review-gate.yml and locally via `pnpm workflow:preflight`.
- `check-pr-review-gate.mjs` — polls `gh` for PR review state, optionally requiring a
  named reviewer/strict head review; run by review-gate.yml and locally via
  `pnpm review:gate`.

### Local-only (not invoked by any workflow)

- `run-dependency-audit.mjs` — wraps `pnpm audit --audit-level high` with a timeout
  (CI runs the raw `pnpm audit` command directly, not this script).
- `assert-clean-worktree.mjs` — fails if `git status --porcelain` is non-empty; used by
  `pnpm verify:clean` ahead of a manual/local release, not called from CI YAML directly.
- `create-live-run-evidence-template.mjs` — scaffolds a redacted live-run evidence
  JSON template (return type, artifact type, month) per `docs/LIVE_EVIDENCE_PROTOCOL.md`.
- `validate-live-run-evidence.mjs` — runs vitest against a given live-run evidence JSON
  path to check it's well-formed and properly redacted before it's shared.

### Supporting library

- `lib/live-run-evidence-redaction-patterns.mjs` (+ `.d.mts`) and
  `lib/live-run-evidence-redaction.ts` / `live-run-evidence-types.ts` / `live-run-evidence.ts`
  — shared redaction pattern definitions and types used by the live-evidence and
  package-verification scripts above; not run standalone.

Do not add a new top-level script without checking whether an existing one here, a
WXT/Chrome API, or `src/core` already covers the need (see root `AGENTS.md` anti-bloat
checklist).
