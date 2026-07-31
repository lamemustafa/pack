# Pack — agent instructions

Pack is a WXT/Vite MV3 browser extension that saves a taxpayer's own filed GST returns to their
own machine. No account, no backend, no telemetry. It is a public open-source repository handling
sensitive compliance data, so the boundaries below are load-bearing rather than aspirational.

Operative rules only. Rationale, captured portal facts, and release gates live in `docs/`. This
file is the source of truth for anything under `pack/` and overrides parent-repo guidance.

## Commands

```sh
pnpm exec wxt build                                          # → .output/chrome-mv3
pnpm exec vitest run                                         # full suite (serial by config)
pnpm exec vitest run tests/path/to/file.test.ts              # one file
pnpm exec tsc --noEmit
pnpm exec eslint . --max-warnings 0
pnpm exec prettier --check .
node scripts/verify-extension-package.mjs .output/chrome-mv3
pnpm exec wxt zip && node scripts/verify-extension-zip.mjs   # release only
pnpm workflow:preflight                                      # before non-trivial edits
pnpm review:gate -- --strict-head-review                     # PR readiness
```

Run the first seven before calling any change complete. Quote the last three lines of the Vitest
output verbatim; do not summarise or round them.

## Project structure

- `src/core/**` — portal-neutral contracts. No GST specifics.
- `src/connectors/gst/**` — all GST portal knowledge: DOM, endpoints, control labels, flows.
- `src/background/**` — service worker: orchestration, storage, downloads.
- `src/entrypoints/**` — `background`, `content`, `popup`, `options`, `offscreen`.
- `src/extension/manifest-policy.ts` — the reviewed permission and host set.
- `tests/**` mirrors `src/**`.
- `docs/PORTAL_INTEGRATION_FINDINGS.md` — captured live portal facts. Read it before debugging
  portal behaviour; add to it after every new capture.

## Code style

Before adding code, ask whether it can be avoided: does a `src/core` contract or a
`src/connectors/gst` helper already do this; can an existing call site be extended; can something
be deleted instead. Prefer deriving a value from its canonical source over restating it.

Eight defects in one week shared one shape — a hand-maintained duplicate of a fact that already
had a canonical source in this repo. When something breaks, look for the duplicate before writing
new code.

Guards fail closed: never treat "could not determine" as "matches". Every terminal state renders
a user-visible `safeMessage`; a silent no-op is a bug, because it cannot be diagnosed from outside.
When a boundary rejects a value, the rejection must name its own reason — seven defects took an
extra round each because a `catch` discarded it.

Simplicity never justifies removing these: target-bound download evidence, storage redaction, the
exact GST host set, package verification, user-initiated flow boundaries, idempotent run state,
explicit unresolved-target review, synthetic fixtures, or the tests that prove privacy and retry
behaviour. A few extra lines that prevent a wrong download or a data leak are not bloat.

## Testing

Assert observable outcomes, not return values. A guard that only checked what a function returned
let a completely silent failure pass 1,492 tests.

Build fixtures from captured live output, including the surrounding decoy content. Two consecutive
fixes shipped broken because their fixtures encoded what we assumed a page looked like rather than
what it contains.

The suite has repeatedly been green while the product was broken, so green is necessary and not
sufficient. Runtime, download, manifest, permission, and privacy changes additionally require a
live authenticated run.

## Git workflow

Branch per lane from the current protected base; never commit to `master` directly. One worktree
per lane — two agents sharing one produced ten phantom test failures. Conventional Commits titles
(`type(scope): imperative summary`), CI-enforced. Commit in logical lanes: runtime, tests, docs,
and release metadata separately. Open PRs as draft. Never amend or rebase a pushed commit.

Before claiming readiness, run `pnpm review:gate` and disposition every automated finding as fixed
with evidence, stale with evidence, rejected with evidence, or a linked follow-up.

## Boundaries

### Never

- Collect, store, log, or transmit GST credentials, OTPs, CAPTCHA responses, cookies, tokens, or
  session material.
- Upload GST documents, GSTIN, PAN, ARNs, taxpayer names, filenames, portal HTML, or tax metadata
  anywhere.
- Add analytics, backend telemetry, remote selector config, remote executable code,
  `externally_connectable`, or broad host permissions.
- Construct a portal URL to navigate. Click the portal's own control. Two constructed navigations
  were WAF-rejected and one ended a live session.
- Mark a target complete on a click alone. Completion requires correlated `chrome.downloads`
  evidence of a completed, non-empty portal file. Unknown-size, zero-byte, interrupted, ambiguous,
  and unrelated downloads route to review, never to blind retry.
- Rely on service-worker uptime, globals, popup lifetime, or in-memory timers for run truth.
  Persist state before and after every externally visible action.
- Paste cURL commands, cookies, headers, portal URLs, portal HTML, GSTIN, PAN, ARNs, taxpayer
  names, downloaded files, or local paths into issues, PRs, docs, or chat.
- Commit `.output/`, `.wxt/`, ZIPs, checksums, browser profiles, or downloaded test files.
- Add third-party hooks, skills, MCP servers, or agent config because an external framework
  recommends it. Outside frameworks are references only unless explicitly requested.
- Claim Chrome Web Store readiness, legal approval, broad GST support, cloud sync, or durable
  full-year support. The gates are recorded in `docs/PUBLICATION_READINESS.md`.

### Ask first

- Any change to `src/extension/manifest-policy.ts`, `wxt.config.ts`, permissions, host
  permissions, or CSP. The reviewed set is `downloads`, `offscreen`, `scripting`, `storage`, plus
  exactly the four GST hosts.
- Any new dependency. Treat one as suspicious by default; accept only when it is smaller and safer
  than local code and license-appropriate for Apache-2.0 distribution.
- Persisting a new field, or widening what is persisted. Scope selections (financial year, period,
  return type, artifact type) are the user's own choices and may persist; taxpayer data may not.
- Weakening a target-binding or identity guard to make a flow pass.
- Public copy, README, store text, or release notes that strengthen an existing claim.

### Always

- Bind a final download click to the explicit target: financial year, period, return type, action
  identity, and visible page identity. A visible download button alone is not enough.
- Keep shared contracts portal-neutral; keep GST specifics in `src/connectors/gst`.
- Keep the government-affiliation disclaimer visible in public copy. Pack is not affiliated with,
  endorsed by, or operated by GSTN, CBIC, or the Government of India.
- Capture live evidence before writing a spec for portal behaviour, then record it in
  `docs/PORTAL_INTEGRATION_FINDINGS.md`. Three specs in one session were written from a plausible
  mechanism and each was falsified by the next probe.
- Follow `docs/AGENT_REVIEW_RECTIFY.md` for review, rectify, and release loops.

## Private knowledge hub

A shared cross-repo knowledge repository (`brain`, https://github.com/lamemustafa/brain) holds
material that must not live in this repo: vulnerabilities, crash triggers, competitor teardowns,
pricing, market research, and durable protocol findings. If you have access, it is cloned as a
sibling at `../brain`.

- **Consult before you build.** Before implementing a flow touching a shared domain (Tally, GST,
  MCA, portal auth) or a competitor feature:
  `grep -rin "<topic>" ../brain/10-domains ../brain/40-decisions ../brain/30-market`.
- **Write sensitive findings there, not here.** A vulnerability, crash trigger, sensitive
  behaviour, or market/pricing fact goes in `brain`; leave only a de-fanged rule here.
- This repo is **public**: never paste a restricted `brain` entry's body here, and never reference
  the hub other than by its plain repo URL.
- If `../brain` is absent (fresh clone, CI, or no access): skip the consult step — it is an
  enhancement, never a build blocker.

## Reviewers and skills

`.claude/agents/` and `.claude/skills/` describe themselves; do not restate them here. Use the
privacy reviewer for anything touching `src/connectors/gst`, public copy, or taxpayer data; the
security reviewer for manifest, permissions, CSP, content scripts, background, or `downloads` API
changes; the release auditor before claiming release readiness.
