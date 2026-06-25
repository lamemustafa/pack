# Pack Browser Extension Codebase

Pack is a WXT/Vite browser-extension repo nested inside ComplyEaze but managed as
its own git repository.

## Non-Negotiables

- V0 requires no Axal, Pulse, or ComplyEaze login.
- Do not collect, store, log, or transmit GST credentials, OTPs, CAPTCHA
  responses, cookies, tokens, or session material.
- Do not upload GST documents, GSTIN/PAN, ARNs, filenames, portal HTML, or tax
  metadata to ComplyEaze in normal V0 behavior.
- Do not add analytics, backend telemetry, remote selector configs, remote
  executable code, `externally_connectable`, or broad host permissions.
- Keep WXT manifest permissions to `downloads`, `scripting`, `storage`, and
  exact GST hosts unless a reviewed design issue approves the change.
- Keep shared contracts portal-neutral; keep GST logic in `src/connectors/gst`.
- Follow `docs/AGENT_REVIEW_RECTIFY.md` for non-trivial changes, review-rectify
  loops, release work, and logical commit segregation.

## Agent-Instruction Precedence

- This Pack `AGENTS.md` is the source of truth for the nested extension repo and
  overrides parent ComplyEaze guidance when the two differ.
- Outside agent frameworks or plugins are references only unless the user
  explicitly asks to install or activate them. Do not add third-party hooks,
  skills, MCP servers, telemetry, or agent-specific config to Pack just because
  a framework recommends it.
- Borrow the useful discipline from alternatives: compact instructions from
  `AGENTS.md`, lifecycle thinking from production skill packs, and Ponytail-style
  anti-bloat review. Reject anything that weakens Pack's privacy, source-first
  alpha posture, least-permission manifest, or required release evidence.
- Keep future instruction changes small and Pack-specific. Prefer one rule tied
  to a verified failure over broad motivational guidance.

## Simplicity And Anti-Bloat Lens

Use a simplicity pass for review, cleanup, and PR closure, but never as a reason
to weaken Pack's safety model.

Before adding code, ask:

1. Does the behavior need to exist for V0, public alpha truthfulness, a verified
   runtime gap, or a release gate?
2. Can existing WXT, Chrome extension APIs, TypeScript, browser primitives, or
   local Pack helpers cover it?
3. Can the change reuse `src/core` portal-neutral contracts or
   `src/connectors/gst` handlers instead of adding a parallel path?
4. Can stale compatibility, broad permissions, unused flags, or speculative
   abstractions be deleted instead of extended?

Do not simplify away target-bound download evidence, storage redaction, exact GST
host permissions, package verification, user-initiated flow boundaries,
idempotent run state, explicit unresolved-target review, synthetic fixtures, or
tests that prove privacy/retry behavior. In Pack, a few extra lines that prevent
wrong downloads or sensitive-data leakage are not bloat.

Treat new dependencies as suspicious by default. Accept one only when it is
smaller and safer than local code, compatible with MV3/browser-extension
constraints, license-appropriate for Apache-2.0 distribution, and covered by the
release/audit gates.

## Review And Release Posture

- Treat Pack as a public open-source browser extension for sensitive compliance
  workflows. Public source, docs, fixtures, generated artifacts, and release
  packages must not expose real taxpayer data, local credentials, session data,
  raw portal captures, or personal workstation paths.
- Full fiscal-year download exists only as a source-build alpha local
  per-period ledger. Do not re-enable the old in-memory `ALL` flow. Do not make
  store-facing or broad public claims for it until service-worker restart,
  browser-restart, resume, privacy-review, and reconciliation evidence prove it
  can recover without repeating completed targets or retaining sensitive portal
  metadata.
- For Chrome extension behavior, verify assumptions against current official
  Chrome documentation before encoding rules around service-worker lifecycle,
  permissions, privacy declarations, downloads, storage, or Web Store policy.
- For open-source governance, keep SECURITY, contributing, issue templates,
  release checks, and CI aligned with GitHub/OpenSSF-style expectations.
- Default to review -> rectify -> re-review -> verify for meaningful changes.
  Continue until no Critical or High findings remain; document any remaining
  Medium/Low follow-ups explicitly.
- Commit in logical lanes. Keep generated artifacts, docs/governance, runtime
  code, tests, and release/package metadata separate unless a change is
  inseparable.

## Target-Bound Downloads And MV3 Durability

- Final GST Portal download clicks must be bound to the explicit target:
  financial year, period, return type, action/run identity, and visible
  detail-page identity. A generic visible download button is not enough.
- A click is not completion. Mark a target complete only after correlated
  `chrome.downloads` evidence for a completed, non-empty GST Portal PDF/file or
  other reviewed positive evidence.
- Unknown-size, zero-byte, interrupted, unrelated, ambiguous, or same-origin
  non-PDF downloads must not mark a target complete. Route ambiguous outcomes to
  target review, blocked state, or explicit retry UI instead of blind retry.
- Multi-step portal jobs must persist state before and after externally visible
  actions. Do not rely on globals, popup lifetime, in-memory timers, or service
  worker uptime for run truth.
- Store-facing full-year claims require real restart evidence: service-worker
  restart, browser restart, no duplicate completed target, safe resume state, and
  no raw URL/referrer, local path, filename, portal HTML, GSTIN/PAN, taxpayer
  name, ARN, cookie, credential, OTP, or CAPTCHA persistence.

## Source-First Public Claims

- Public copy, README changes, store text, PR descriptions, release notes, and
  `pack.complyeaze.com` copy must remain source-first alpha unless exact
  evidence proves a stronger claim.
- Do not claim Chrome Web Store readiness, legal approval, live
  manifest/index/exception generation, broad GST support, cloud sync, or durable
  full-year support until the recorded gates in `docs/PUBLICATION_READINESS.md`
  are complete.
- Keep the government-affiliation disclaimer visible when describing Pack
  publicly. Pack is not affiliated with, endorsed by, or operated by GSTN, CBIC,
  or the Government of India.
- Public status pages must not outrun the latest recorded source commit, exact
  ZIP checksum, privacy declaration, and live/manual QA evidence.

## Generated Artifacts And Release Assets

- `.output/`, `.wxt/`, generated ZIPs, extracted ZIP checks, checksums, local
  package outputs, browser profiles, and downloaded test files are generated
  release artifacts. Keep them out of git unless a specific reviewed
  release/governance lane says otherwise.
- Publish release ZIPs as GitHub release assets, not source commits. Pair each
  ZIP with the source tag, source commit, SHA-256 checksum, package verifier
  evidence, and release notes.
- Before tagging or claiming release readiness, verify the exact ZIP with
  `node scripts/verify-extension-zip.mjs`, not just the unpacked build.

## Live GST Portal Evidence

- Live automation claims require real Chrome/Brave extension-host evidence where
  `chrome.downloads` exists. Codex in-app browser, DOM-only inspection,
  coordinate-click evidence, or protected URL replay is not enough to prove
  download completion.
- Debug through safe popup state, extension storage summaries, and synthetic or
  redacted observations. Never paste cURL commands, cookies, headers, raw GST
  Portal URLs, portal HTML, GSTIN/PAN, taxpayer names, ARNs, downloaded GST
  files, or local download paths into issues, PRs, docs, or chat.

## Secondary Reviewers

For meaningful Pack changes, add independent reviewer lenses when they can catch
a concrete release or privacy failure:

- Chrome extension/security reviewer: manifest permissions, host permissions,
  CSP, content scripts, background service worker, storage, downloads API,
  remote-code patterns, or Web Store privacy declarations.
- GST portal automation reviewer: target-bound clicks, portal navigation safety,
  DOM drift, protected URL replay risks, and whether runtime evidence proves the
  claimed download behavior.
- GST product/compliance reviewer: public claims, GST Portal behavior,
  unaffiliated-government disclaimers, filed-return terminology, source-build
  alpha boundaries, and whether a claim is supported by live evidence.
- Privacy/legal reviewer: Chrome Limited Use, local-processing claims, GST
  Portal terms, credential/session/taxpayer data exposure, public policy
  consistency, and support/contact readiness.
- MV3 reliability reviewer: service-worker termination, local ledger durability,
  duplicate starts, pause/cancel/resume, retries, target idempotency, and
  browser-restart behavior.
- QA/release reviewer: clean-profile install, synthetic demo, live authorised
  run evidence, exact ZIP checksum, package verifier output, and GitHub release
  asset hygiene.
- Open-source governance reviewer: SECURITY, CONTRIBUTING, issue templates,
  CODEOWNERS, license/NOTICE/trademark posture, dependency provenance, and
  sensitive-data guidance for public issues and PRs.
- Simplicity reviewer: broad diffs, new dependencies, generic abstractions,
  duplicated GST handlers, unused config, or compatibility paths that are not
  tied to a current release gate.

Every reviewer finding needs a disposition before release or sensitive PR
closure: fixed with evidence, stale with evidence, accepted follow-up with a
named blocker, or rejected with file/runtime evidence. Do not leave bot or
subagent findings implicit.

## Branch, PR, And Review Workflow

- Never work directly on `master` for launch, runtime, public-copy, release,
  governance, or AGENTS/instruction changes. Create a
  `tapish-codex/<short-scope>` branch from the current protected base.
- Pack is a nested git repository. Parent ComplyEaze branch state does not make
  Pack safe; run `git -C pack status -sb` and manage Pack branches separately.
- Inspect `git status -sb` and the diff before staging. Stage only files that
  belong to the current logical lane.
- Prefer small PRs with a root-cause summary, sensitive-data impact,
  Chrome Web Store impact, verification evidence, and explicit follow-ups. A PR
  title alone is not enough context for Pack.
- Use professional PR titles in `type(scope): imperative summary` form, for
  example `fix(download): block implicit full-year retries`. Titles should name
  the changed behavior, not the agent, branch, or implementation chore unless the
  PR is actually a chore.
- Open PRs as draft unless the user explicitly asks for ready-for-review.
- After publishing a PR, wait for GitHub Actions and autogenerated review tools
  to finish before declaring the PR ready to close.
- Inspect both top-level comments and unresolved inline review threads. Treat
  autogenerated Codex review comments as actionable until each one is fixed,
  shown to be outdated, or answered with evidence.
- Do not merge or close a PR with failing checks, unresolved requested changes,
  unresolved sensitive-surface comments, or uninspected bot review output.
- Do not treat "no comments yet" as a merge signal. For sensitive runtime,
  release, privacy, or Store-facing PRs, confirm the latest review applies to the
  exact current head SHA and no commits landed afterward without re-review.
- If a review comment is valid, add a focused commit and mention the behavior or
  test that closes it. If it is not valid, reply with the evidence rather than
  silently dismissing it.
- PR descriptions for runtime, release, or public-copy changes should state
  whether the change is source-build alpha only, whether store-facing claims
  changed, what sensitive data is persisted or deliberately excluded, and which
  release gates remain blocked.
- Maintain a review-thread disposition register in the PR body for Codex/bot
  comments: accepted, fixed with commit/test, outdated with evidence, rejected
  with evidence, or linked follow-up.
- When GitHub context is available, run `pnpm review:gate` for normal review
  cleanup and `pnpm review:gate -- --strict-head-review` before claiming a
  sensitive PR is merge-ready. For release/runtime PRs, require the current-head
  Codex bot review with
  `pnpm review:gate -- --strict-head-review --required-review-author chatgpt-codex-connector --wait-head-review-ms 180000`.
  Treat network/auth failure as a reported verification gap, not as a pass.
- The CI `Review gate` workflow may use `--allow-missing-head-review` so a
  non-responsive external bot does not create a permanent red check. That mode is
  a findings gate only; it does not replace the hard local/manual
  `pnpm verify:pr` release-readiness gate.

## Required Checks

Use:

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level high
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
pnpm review:gate -- --strict-head-review --required-review-author chatgpt-codex-connector --wait-head-review-ms 180000
```

`pnpm verify` and `pnpm verify:release` are provided for normal terminals, but
direct commands are preferred inside Codex if package-script wrappers hang or
hide failure details.

Task-class gates:

- Runtime, download, manifest, permission, or privacy changes require focused
  Vitest coverage for the touched behavior plus the full local gate through
  package verification.
- Release candidates require the full gate, `pnpm exec wxt zip`,
  `node scripts/verify-extension-zip.mjs`, SHA-256 evidence, clean-profile QA,
  and PR review-gate evidence.
- Public-copy, store-claim, or policy changes require comparison against
  `README.md`, `docs/PUBLICATION_READINESS.md`, `docs/PRIVACY_QA.md`,
  `docs/CHROME_REVIEWER_TEST.md`, and the exact build/release evidence being
  claimed.
- PR readiness requires `pnpm review:gate` or the equivalent direct command.
  Network, GitHub auth, or missing-current-head-review failures are reported
  verification gaps, not passes.
