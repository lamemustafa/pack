@AGENTS.md

## Claude Code

This section is the Claude Code addendum to the imported `AGENTS.md` above.
`AGENTS.md` remains present and authoritative for all policy, safety, and
non-negotiable rules — this section is additive tooling guidance for Claude
Code specifically, not a replacement or a competing source of truth.

### Branch / worktree / PR workflow

- Use a clearly-scoped branch name for any work (e.g.
  `claude/<short-topic>`). The Codex-specific `tapish-codex/` prefix and the
  `chatgpt-codex-connector` bot-review-wait convention in `AGENTS.md` are
  actor-specific conventions for the Codex harness, not literal requirements
  here — the underlying discipline (small PRs, real review before merge,
  nothing declared ready until checks pass) still applies in full.
- Run `pnpm workflow:preflight` before non-trivial edits.
- Keep PRs small. Use Conventional Commits PR titles (`type(scope): imperative
summary`) — CI-enforced by `pr-title.yml`.
- Prefer draft PRs unless explicitly ready for review. Never declare a PR
  ready or mergeable until GitHub Actions checks pass and any automated
  review bot's findings are addressed or explicitly dispositioned.
- Run `pnpm review:gate` before claiming PR readiness; add
  `--strict-head-review` for anything touching runtime, download, manifest,
  permission, or privacy surfaces.

### Subagents

- **pack-security-reviewer** (`.claude/agents/pack-security-reviewer.md`) —
  triggers on changes to the extension manifest, permissions, CSP, content
  scripts, background service worker, or `downloads` API usage (e.g. edits to
  `manifest-policy.ts`, `wxt.config.ts`, `src/entrypoints/background`).
- **pack-privacy-reviewer** (`.claude/agents/pack-privacy-reviewer.md`) —
  triggers on changes to `src/connectors/gst`, public copy, docs, or anything
  mentioning GST credentials, sessions, or taxpayer data; checks for
  credential/session/taxpayer-data exposure risk against the Non-Negotiables.
- **pack-release-auditor** (`.claude/agents/pack-release-auditor.md`) — use
  proactively before tagging a release or claiming release-readiness; walks
  the release gate sequence and cross-checks
  `docs/PUBLICATION_READINESS.md`.

### Skills

- **pack-release** (`/pack-release`) — the end-to-end release flow (verify,
  clean, zip, verify-zip, provenance, release-please, Chrome Web Store
  submission). Side-effecting; invoke explicitly only, never auto-triggered.
- **pack-live-evidence** (`/pack-live-evidence`) — generates a live-run
  evidence template and walks redaction before ever sharing evidence.
  Extremely sensitive; invoke explicitly only, never auto-triggered.
- **pack-pr-readiness** (`/pack-pr-readiness`) — the PR-readiness /
  review-gate checklist and disposition-register table format for PR bodies.
  Read-only; safe to auto-invoke.

### Graphify does not apply here

`graphify-out/` and `scripts/refresh-graphify.py` do not exist in this repo —
they are a parent-ComplyEaze-repo-only concept. Any Graphify instruction
inherited from a parent ComplyEaze `CLAUDE.md` (e.g. reading
`graphify-out/GRAPH_REPORT.md` or running a Graphify refresh script) does not
apply inside this `pack` repo and must not be followed here.
