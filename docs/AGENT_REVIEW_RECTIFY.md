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

Required checks for runtime or release-affecting changes:

```sh
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
git diff --check
```

For open-source release work, also run:

```sh
pnpm audit --audit-level high
```

If the audit cannot run because the registry is unavailable, report that as a
verification gap.

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
