## Scripts Directory

### Supporting library

- `lib/codex-review-markers.mjs` — the pattern Codex writes on a clean top-level
  review, and the reviewed commit it names. Read by `check-pr-review-gate.mjs` (as a
  current-head review) and `publish-review-gate-check.mjs` (as a head this PR had); one
  definition because two copies disagreeing about which commits were reviewed is the
  discontinuity the gate exists to detect.
- `lib/release-branch-rewrite.mjs` — the marker a generated-branch regeneration writes
  to record the head it discarded, which GitHub omits (`before_commit_id` is null).
  Written by `run-release-please.mjs`, read by `publish-review-gate-check.mjs`. It
  supplies a name, not permission: the named commit is still searched, and only a
  marker written by `github-actions[bot]` counts.
- `lib/live-run-evidence-redaction-patterns.mjs` (+ `.d.mts`) and
  `lib/live-run-evidence-redaction.ts` / `live-run-evidence-types.ts` / `live-run-evidence.ts`
  — shared redaction pattern definitions and types used by the live-evidence and
  package-verification scripts above; not run standalone.

Do not add a new top-level script without checking whether an existing one here, a
WXT/Chrome API, or `src/core` already covers the need (see root `AGENTS.md` anti-bloat
checklist).
