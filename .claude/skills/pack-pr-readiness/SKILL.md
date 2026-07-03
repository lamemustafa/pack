---
name: pack-pr-readiness
description: Read-only checklist for confirming a Pack PR is actually ready — branch/worktree sanity, workflow:preflight, the review:gate variants, and the review-thread disposition-register table expected in PR bodies. Use before saying a Pack PR is "ready", "mergeable", or "good to merge", or when the user asks to check/verify PR readiness for this repo.
---

# Pack PR Readiness

This is a checklist and reporting skill, not a side-effecting one: it runs
read-only/gate commands and tells you what still blocks readiness. It never
merges, pushes, force-pushes, or edits the PR on GitHub for you.

Ground everything here in `AGENTS.md`'s "Branch, PR, And Review Workflow"
section and the repo's `.github/PULL_REQUEST_TEMPLATE.md`. If either has
drifted from this skill, trust the source file and flag the mismatch rather
than silently following a stale step here.

## 1. Branch / worktree sanity check

- Confirm the work is not sitting directly on `master`. Run `git status -sb`
  and check the branch name.
- Confirm the working tree is clean or that any uncommitted files are
  intentional and unrelated files are not about to be staged. Run
  `git status --short` and `git diff` (and `git diff --staged`) and read the
  output rather than assuming.
- If working inside a dedicated worktree, confirm you are in the right one
  for this task (`git rev-parse --show-toplevel`) — do not mix this PR's
  changes with another lane's.
- Confirm the PR is opened from a Pack branch, not `master`, and that the PR
  title already follows `type(scope): imperative summary` (CI-enforced by
  `pr-title.yml`).

## 2. Run workflow preflight

```sh
pnpm workflow:preflight
```

This checks branch safety, staleness of Pack AGENTS/review guidance, and PR
template checklist wiring (`scripts/check-pack-workflow-preflight.mjs`). Run
it before non-trivial edits and again before claiming PR readiness. Report
its exact pass/fail output — do not paraphrase a failure as a pass.

## 3. Run the review:gate variant that matches the situation

- **Normal review cleanup** (routine PR, no runtime/download/manifest/
  permission/privacy surface touched):
  ```sh
  pnpm review:gate
  ```
- **Sensitive-surface or merge-readiness claim** (anything touching runtime,
  downloads, `manifest-policy.ts`, permissions, or privacy/data-flow —
  matches the "Sensitive Surface Review" section of the PR template) — use
  the stricter form and require the current-head Codex bot review:
  ```sh
  pnpm review:gate -- --strict-head-review --required-review-author chatgpt-codex-connector --wait-head-review-ms 180000
  ```
  This is also exactly what `docs/RELEASE.md` and `pack-release` require
  before tagging, and what CI's `review-gate.yml` runs (as a non-blocking,
  soft gate with `--allow-missing-head-review`) — this skill's job is to run
  the stricter, blocking form yourself before asserting readiness, not to
  rely on the soft CI version alone.
- Treat a network/auth failure while calling GitHub as a **reported
  verification gap**, not as a passing gate. Do not silently treat "the
  command didn't run" as "the command passed."

## 4. Wait for automated review before declaring readiness

- After the PR is published (or after new commits land), wait for GitHub
  Actions checks and any automated review bot (e.g. the Codex/
  `chatgpt-codex-connector` review) to finish before calling the PR ready.
- Confirm the latest review actually applies to the **current head SHA** —
  if commits landed after the last review, treat it as unreviewed until a
  fresh review lands, per `--strict-head-review`'s intent.
- Do not treat "no comments yet" or "checks still running" as a green light.
  A PR with failing checks, unresolved requested changes, unresolved
  sensitive-surface comments, or uninspected bot output is not ready.

## 5. Disposition register for PR bodies

Every review finding (bot or human) needs an explicit disposition before a
PR can be called ready or merge-ready — never leave a finding implicit.
Use these four dispositions (per `AGENTS.md`'s "Branch, PR, And Review
Workflow" and reviewer-disposition guidance):

- **fixed-with-evidence** — a commit or test now closes the finding; cite
  the commit/test.
- **stale-with-evidence** — the finding no longer applies (e.g. code moved
  or was already addressed); cite the file/line or diff evidence showing why.
- **accepted-follow-up-with-named-blocker** — valid but out of scope for
  this PR; name the blocker and link the follow-up issue/PR — do not leave
  it as a vague "later."
- **rejected-with-evidence** — the finding is incorrect; reply with the
  file/runtime evidence that disproves it rather than silently dismissing it.

Confirm the PR body's disposition table (matching
`.github/PULL_REQUEST_TEMPLATE.md`'s "PR Review Follow-Up" section) is
filled in with one row per thread/comment, for example:

| Thread/comment           | Disposition                                                                                                | Commit or evidence                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| <thread link or summary> | fixed-with-evidence / stale-with-evidence / accepted-follow-up-with-named-blocker / rejected-with-evidence | <commit SHA, test name, or file:line> |

If the PR template uses its shorter literal column values (`accepted / fixed
/ outdated / follow-up`), map onto the four dispositions above rather than
leaving anything unstated — the underlying discipline (every finding gets a
named, evidenced outcome) is what matters, not which label set is used.

## 6. Final readiness report

State explicitly, in one summary:

- Branch/worktree check: pass/fail, with the branch name.
- `pnpm workflow:preflight`: pass/fail, with the exact failure if any.
- Which `review:gate` variant was run and its result.
- Whether automated review is still pending, stale (predates the current
  head SHA), or current.
- Whether every review-thread disposition is filled in with evidence.
- Overall verdict: **ready**, **not ready** (name the specific blockers), or
  **blocked** (name what's needed from a human — e.g. GitHub auth, a pending
  bot review, a missing follow-up link).

Never soften a fail or a pending item into "ready" to make the report look
cleaner. If unsure whether something counts as satisfied, say so explicitly
and mark it not ready rather than guessing.
