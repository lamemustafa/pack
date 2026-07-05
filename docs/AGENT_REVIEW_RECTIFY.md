# Agent Review And Rectify Guide

Pack is a public open-source Chrome MV3 extension for sensitive GST compliance
workflows. Use this guide for every non-trivial code, documentation, release, or
governance change.

## Sources To Re-Check When Relevant

- Chrome extension service-worker lifecycle: MV3 workers can stop after idle
  periods, long requests, or long events. Persist workflow state instead of
  relying on globals for multi-step jobs.
- Chrome downloads API: correlate downloads with `id`, `url`, `finalUrl`,
  `referrer`, `mime`, `filename`, `startTime`, `state`, `error`, and byte
  evidence before marking a target complete.
- Chrome Web Store user-data and privacy policy guidance: local processing still
  needs truthful privacy declarations when the extension accesses website
  content, URLs, browsing activity, or sensitive user data.
- GitHub security policy guidance: public projects need clear private
  vulnerability reporting and supported-version expectations.
- OpenSSF best-practice materials: keep security policy, dependency hygiene,
  least privilege, CI checks, and release provenance in active review.

Official references:

- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/reference/api/downloads
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository
- https://best.openssf.org/

## Intake

For every meaningful task, state the working tier and active lenses before
editing:

```text
[TIER: LOW|MEDIUM|HIGH] [LENSES: <focused lenses>] [ROUNDS: <target rounds>]
```

Use `HIGH` for changes touching:

- extension permissions, host permissions, CSP, manifest, or package verifier;
- content scripts, background service worker, message contracts, or downloads;
- GST portal automation, DOM clicking, file handling, or workflow state;
- privacy/security docs, public release claims, issue templates, or CI;
- generated artifacts that may contain code excerpts, absolute paths, or private
  local metadata.

## Review Lenses

Use only lenses that can change the result:

- Product/compliance: public claims match actual live behavior, GST scope is
  truthful, and no statutory or portal behavior is invented.
- Architecture: portal-specific code stays in `src/connectors/gst`; shared
  contracts remain portal-neutral; MV3 lifecycle risks are explicit.
- Security/privacy: no credential/session capture, no hidden telemetry, no
  broad permissions, no raw portal data in logs/docs/tests, and no unsafe
  remote execution.
- Platform/reliability: download completion is evidence-backed, retries are
  idempotent, service-worker termination is handled or called out as a blocker.
- QA/test: tests cover happy path, failure path, unrelated downloads, interrupted
  downloads, unknown sizes, DOM drift, duplicate starts, and popup reopen paths
  when those surfaces change.
- Open-source release: SECURITY, CONTRIBUTING, issue templates, CI, package
  verifier, README, release notes, and public docs stay consistent.

## Review-Rectify Loop

1. Cluster the dirty tree into logical lanes before editing.
2. Read `graphify-out/GRAPH_REPORT.md` if present. Use Graphify for structural
   questions before broad text search.
3. Run a review pass against the active lenses. Findings must cite files and
   behaviors, not generic preferences.
4. Fix all Critical and High findings before moving on.
5. Add or update focused tests for every fixed behavior.
6. Re-run the smallest relevant tests first, then broaden to required checks.
7. Repeat until the review is clean enough that remaining items are explicit
   Medium/Low follow-ups, not hidden release blockers.

## Public-Site Claim Intake

For Pack landing-page, public-site, policy, support, source, status,
release-note, README, or store-copy work, treat the task as `HIGH` unless it is
purely visual and cannot change claims. Before implementation, build a compact
claim-evidence table with: claim text, affected page/file, code source, doc
source, built artifact or verifier source when relevant, live/public source,
verification date, and blocker status.

Required checks for claim-bearing work:

- Privacy and storage claims must be reconciled against runtime storage keys and
  writes, README/docs privacy disclosures, public facts, and the live privacy
  page.
- Source/version, license, install, and reproducibility claims must point to the
  reviewed commit or tag when the page presents reviewed-source evidence. Moving
  branch links are allowed only when clearly labeled as development links.
- Status/readiness claims must match `docs/PUBLICATION_READINESS.md`, status
  route source, build or ZIP verifier evidence, and live `/status`. Do not claim
  Chrome Web Store readiness, release readiness, public reproducibility, or
  durable full-year support without matching gate evidence.
- Support claims must be verified against live/public support routes and GitHub
  issue settings. A broken tester feedback path blocks tester-acquisition copy.
- Built artifact claims must be checked against `.output/chrome-mv3/manifest.json`
  after `pnpm exec wxt build` plus Pack verifier output, not source constants
  alone.
- Public-facts changes must run
  `pnpm exec tsx scripts/sync-pack-public-facts.ts --check` in the parent app
  when the parent app owns the public snapshot. If facts change, explain whether
  the script reads canonical sources or copies static arrays.
- Live/public evidence should include browser or `curl -L` checks for the
  affected public routes and GitHub repo/issues/license/release URLs. Record
  network/auth failures as verification gaps, not proof.

Resolve mismatches by narrowing the claim, changing the source of truth, adding
a drift test, or marking the claim blocked. Do not polish around unresolved
truth mismatches.

Required checks for runtime or release-affecting changes:

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
pnpm exec wxt zip
node scripts/verify-extension-zip.mjs
git diff --check
pnpm review:gate -- --strict-head-review --required-review-author chatgpt-codex-connector --wait-head-review-ms 180000 --allow-missing-head-review
```

`node scripts/run-dependency-audit.mjs` runs `pnpm audit --audit-level high`
with a timeout. If the audit cannot run because the registry is unavailable,
report that as a verification gap. If `pnpm review:gate` cannot run because
there is no PR,
network access, or authenticated GitHub CLI session, report that as a PR-readiness
verification gap instead of treating it as a pass.

The `Review gate` workflow is allowed to pass with
`--allow-missing-head-review` after waiting for Codex because the external bot can
acknowledge `@codex review` without producing a formal review in a deterministic
time window. Treat that mode as a findings gate: unresolved review threads and
current-head requested-changes reviews still fail, but a missing bot review is an
audit gap to record before merge/release claims.

For PRs, record the exact local commands or CI run, release ZIP/checksum
evidence when a ZIP is produced, and the SHA-256 checksum. Treat late Codex/bot
comments as claims against the current head SHA; fix valid findings, answer
stale findings with evidence, and list explicit follow-ups in the PR body.

For merged or closed PR cleanup, inspect GraphQL `reviewThreads` on every target
PR; do not rely on flat comments or stale notification state. Resolve each open
thread only after posting a concise disposition comment. If the finding is no
longer valid, cite the current file/test/release evidence that makes it stale.
If it remains valid, compile the finding into a GitHub issue with scope,
acceptance criteria, risk, and verification, link that issue in the old thread,
then resolve the thread. Runtime or release-affecting issues need a task-owned
branch/worktree, focused tests, review/rectify loop, PR, green CI, and clean
autogenerated review threads before merge.

## Privacy And Artifact Rules

- Do not commit `.output`, `.wxt`, `node_modules`, real GST files, screenshots,
  raw network captures, cookies, headers, OTPs, CAPTCHA data, private notes, or
  workstation-specific generated artifacts.
- Treat Graphify output as a generated artifact. Commit it only if it is
  intentionally part of the repo and has been reviewed for absolute local paths,
  source excerpts, and sensitive data. Otherwise leave it untracked or ignored.
- Test fixtures must use synthetic data only.
- Public docs must not imply Chrome Web Store readiness, legal approval,
  manifest/index generation, or broad GST support unless the code and release
  evidence prove it.

## Logical Commits

Split commits by lane:

- governance/agent instructions;
- runtime extension behavior;
- tests for runtime behavior;
- public docs/release posture;
- generated artifacts, only when intentionally committed.

Before each commit:

```sh
git diff --cached --name-status
git diff --cached --check
```

Never sweep unrelated dirty files into a commit. If a post-commit hook or local
tool changes generated files, inspect and commit that generated delta separately
or revert it if it is not intended for public source.
