# Validation — catalogue overhaul lane

## Lane and boundaries

- Branch: `tapish-codex/catalogue-overhaul-01a03759`, created from freshly fetched `origin/master`
  at `78b74d1` in an isolated worktree. The machine-specific path is intentionally omitted.
- The dirty primary checkout was not edited, staged or cleaned.
- Collision check: no other `/tmp/pack-lanes` claim existed at lane creation. This lane owns the
  background diagnostic files, catalogue/capability model, side-panel scope UI and tests, the new
  `design-lab/10-catalogue-overhaul` directory, `DESIGN.md` and this record.
- No live GST Portal session, portal navigation, real taxpayer data, manifest/permission/CSP change,
  dependency change, new persisted field, sensitive or unbounded persisted value, target-binding
  weakening, public capability claim, push, PR or deployment was used. Task 0 expands only the
  fixed, allowlisted durable diagnostic-signal vocabulary described below.

## Outcome

Pack now has one nine-row filed-return catalogue as the canonical source for each row's label,
support status, periodicity and artifact availability. Only its three supported rows enter the
runtime return-type union and form controls. The six declared-but-unsupported rows remain readable
catalogue information. A four-step side-panel guide derives its period axis from periodicity and
retains one exact return/FY/period/artifact scope for the existing single-scope runtime.

The same lane also names every previously collapsed target-review-clear exit, removes the obsolete
preset duplicate, and deletes a popup component that had no production importer. None of these
changes alters completion evidence, storage scope, portal calls or the existing fail-closed policy.

## Task 0 — named review-clear exits

- Retained `clearFiledReturnsTargetReview(...): Promise<boolean>` for existing callers and added a
  discriminated diagnostic API behind it. Legacy callers preserve the storage-error throw contract.
  The ZIP recovery caller that already caught and erased storage errors now receives the named
  result.
- Nine distinct exits are observable: `storage-key-missing`, `expected-revision-invalid`,
  `review-missing`, `review-malformed`, `scope-mismatch`, `revision-mismatch`,
  `storage-read-failed`, `storage-write-failed` and `storage-remove-failed`.
- A blocked durable review retains its generic signal and now also retains
  `filed-returns-target-review-clear-failed:<stage>` plus the existing checkpoint signal. The
  blocked/downloaded decision is unchanged.
- Rejected: treating a proven download as complete after deletion of Pack's durable bookkeeping
  record fails. That remains an owner decision and is listed below.

### Discrimination evidence

The parameterised test reports nine separately named cases. For every row below, only the named
production exit was temporarily changed, the focused case failed, and the source was restored.
Each mutation produced exactly one failed case while neighbouring cases were skipped by the filter.

| Mutated exit                | Failure message                                                       |
| --------------------------- | --------------------------------------------------------------------- |
| `storage-key-missing`       | expected stage `storage-key-missing`; received `review-missing`       |
| `expected-revision-invalid` | expected stage `expected-revision-invalid`; received `review-missing` |
| `review-missing`            | expected stage `review-missing`; received `storage-key-missing`       |
| `review-malformed`          | expected stage `review-malformed`; received `review-missing`          |
| `scope-mismatch`            | expected stage `scope-mismatch`; received `review-missing`            |
| `revision-mismatch`         | expected stage `revision-mismatch`; received `review-missing`         |
| `storage-read-failed`       | expected stage `storage-read-failed`; received `review-missing`       |
| `storage-write-failed`      | expected stage `storage-write-failed`; received `storage-read-failed` |
| `storage-remove-failed`     | expected stage `storage-remove-failed`; received `review-missing`     |

After restoration and the security-review additions, the focused gate passed: 3 files, 114 tests.

## Independent prototype exploration and judgment

Three separate agents owned three standalone, synthetic HTML directions. A fourth agent, who had
not generated them, opened and measured all three at an exact 320 × 900 Chromium viewport before
committing `design-lab/10-catalogue-overhaul/04-judgement.md`.

| Direction | Product model    | Initial / maximum controls | Common case | Rows | Horizontal overflow |
| --------- | ---------------- | -------------------------: | ----------: | ---: | ------------------: |
| A         | Outcome recipes  |                      4 / 8 |    2 clicks |    9 |                 0px |
| B         | Guided scope     |                      3 / 4 |    4 clicks |    9 |                 0px |
| C         | Compact register |                      5 / 5 |     1 click |    9 |                 0px |

Direction B won 32/35, ahead of C at 29 and A at 28. It was the only direction whose runnable axis
was completely keyed by `monthly | quarterly | annual | none` while holding the actual control
budget at four. A was faster but expanded to eight controls. C was fastest but its runnable scope
was monthly-specific and its four-control self-report omitted the Advanced disclosure.

Every prototype contained exactly nine catalogue rows: supported monthly GSTR-1, GSTR-3B and
GSTR-2B; unsupported annual GSTR-9/GSTR-9C; unsupported quarterly GSTR-4/GSTR-4A; unsupported
monthly IFF; and unsupported non-period Ledgers. Unsupported rows were never controls.

## Catalogue and panel implementation

- `filed-returns-catalogue.ts` owns the nine rows. The runtime union, capability lookups, select
  options and catalogue disclosure derive from the same data rather than restating supported types.
- `panel-guided-scope-model.ts` supplies complete periodicity-keyed copy and options. Monthly reuses
  the canonical captured-period helper; quarterly has Q1–Q4; annual has one FY option; `none` is
  explicitly non-period-based. No return identifier selects an axis.
- The side panel progressively discloses return, FY, period and artifact. One target review remains
  visible, including before the irreversible final action. The maximum is four operable controls,
  including the Advanced catalogue disclosure.
- The nine-row catalogue is explanatory. Its six unsupported rows cannot become selects, buttons,
  links or runtime return values.
- The obsolete preset component, preset snapshot machinery and two preset-only test files were
  deleted rather than retained as a second contract.

### Mutation proof

All mutations were temporary and restored before the succeeding clean focused gate.

| Contract challenged                     | Temporary mutation                    | Observable failure                                                                                                        |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| supported rows alone enter runtime      | removed the catalogue support filter  | 3 failures: runtime types had 9 rather than 3 rows; periodicity expectation included all 9; GSTR-9 became a select option |
| quarterly axis is structurally complete | reduced Q1–Q4 to Q1                   | expected 4 quarter options; received 1                                                                                    |
| implemented control budget is measured  | added an extra panel button           | expected 3 initial controls; received 4                                                                                   |
| 320px correctness detects clipping      | forced a catalogue row to 400px width | packaged measurement reported `clipped: ["panel-shell"]`                                                                  |

The restored focused panel/catalogue gate passed 4 files and 19 tests.

## Packaged-browser evidence

The real `.output/chrome-mv3` side panel was loaded as an extension in Chromium with
`chrome.runtime.sendMessage` stubbed before page load. This exercised only synthetic local UI; it
did not navigate or contact GST. At an exact 320 × 900 viewport:

| State          | Operable controls | Content height | Shell width | Clipped elements |
| -------------- | ----------------: | -------------: | ----------: | ---------------- |
| Step 1         |                 3 |       620.75px |       288px | none             |
| Step 2         |                 4 |       687.55px |       288px | none             |
| Step 3         |                 4 |       670.75px |       288px | none             |
| Step 4         |                 4 |       677.92px |       288px | none             |
| Catalogue open |                 4 |        scrolls |       288px | none             |

- Document and body width remained 320px in every measured state.
- The final action named the exact scope: `Download July 2026-27 GSTR-3B PDF`.
- The open catalogue contained 9 rows, 6 unsupported rows and 0 controls for unsupported rows.
- Focused controls and the disclosure have a 44px minimum target; compact type has a 12px floor.

This is packaged synthetic evidence, not authenticated portal qualification. Chromium semantics and
keyboard-ready source were inspected; screen-reader, translated-copy and browser-zoom behaviour
remain unqualified.

## Impeccable critique and audit

- Deterministic detector: exit 0 with an empty JSON finding set for `src/entrypoints/panel`.
- Independent critique found the original 10–11px text floor, target review below the final action,
  developer-facing unsupported copy, and the four-click default path.
- Rectified the first three: all compact text is at least 12px, target review precedes the final
  action, unsupported rows say `not available in Pack`, progress is a polite live status, disclosure
  affordance remains visible, and controls meet the 44px floor.
- Accepted limitation: the chosen four-step flow needs four clicks to accept defaults. Adding a
  shortcut would create a new execution path beyond this catalogue-overhaul scope and weaken the
  independent judgment's progressive-disclosure constraint without new product evidence.
- Post-fix self-audit: accessibility 4/5, performance 4/5, responsive design 4/5, theming 4/5,
  anti-patterns 4/5; 20/25. No Critical, High or P1 finding remains. The unqualified assistive-tech,
  zoom and live-portal cases are recorded rather than inferred.

## Code reduction and diagnostic audit

- A module-import scan initially found one source module with zero production importers:
  `src/entrypoints/popup/run-evidence-panel.tsx`. Its only importers were its own four tests.
- Confirmed observable live replacements before deletion: `InlineStatus`, `PackSummary`,
  `RecoveryActions` and `LastRunDiagnostics`, each covered by production-importer tests.
- Deleted the 50-line orphan and 89 lines of self-only tests. The replacement-focused gate passed:
  4 files, 91 tests.
- Re-ran the source-module scan to a fixed point: 175 source modules, zero zero-importer candidates.
- A scoped search for catches returning `false`/`null` found parser and fail-closed boundaries, plus
  the already-audited cleanup checkpoint. No additional reason-erasing production duplicate was
  found, so no speculative rewrite was added.

## Measured delta

| File                                                              | Before | After |
| ----------------------------------------------------------------- | -----: | ----: |
| `src/background/filed-returns-target-review.ts`                   |  1,458 | 1,534 |
| `src/background/filed-returns-target-download-recovery.ts`        |    649 |   660 |
| `tests/background/filed-returns-target-review.test.ts`            |  1,954 | 2,067 |
| `tests/background/filed-returns-target-download-recovery.test.ts` |  1,125 | 1,129 |
| `tests/connectors/filed-returns-durable-signals.test.ts`          |    423 |   438 |
| `src/connectors/gst/filed-returns-capabilities.ts`                |    303 |   123 |
| `src/connectors/gst/filed-returns-catalogue.ts`                   |      0 |   222 |
| `src/connectors/gst/filed-returns-return-types.ts`                |     35 |    41 |
| `src/connectors/gst/filed-returns-durable-signals.ts`             |    703 |   710 |
| `src/connectors/gst/filed-returns-target-review-clear.ts`         |      0 |    30 |
| `src/entrypoints/panel/panel-presets.ts`                          |     71 |     0 |
| `src/entrypoints/panel/panel-guided-scope.tsx`                    |      0 |   180 |
| `src/entrypoints/panel/panel-guided-scope-model.ts`               |      0 |   152 |
| `src/entrypoints/panel/panel-surface.tsx`                         |    404 |   256 |
| `src/entrypoints/popup/scope-form-model.ts`                       |    190 |   191 |
| `src/entrypoints/popup/run-evidence-panel.tsx`                    |     50 |     0 |
| `src/styles/panel.css`                                            |    229 |   374 |
| `tests/panel/panel-presets.test.ts`                               |     74 |     0 |
| `tests/panel/panel-presets-refresh.test.tsx`                      |    218 |     0 |
| `tests/panel/panel-surface.test.tsx`                              |    266 |   173 |
| `tests/popup/recovery-actions.test.ts`                            |    923 |   834 |
| `DESIGN.md`                                                       |    198 |   221 |

All new or materially rewritten application TypeScript/TSX modules are below 300 lines. The
catalogue/panel lane removes two duplicate product models and one unreachable production component;
the background additions are intentionally local to the existing large modules to preserve their
reviewed persistence and failure contracts.

## Gate evidence

### Baseline before source edits

- Available disk: 74.39 GiB.
- Build, TypeScript, ESLint with zero warnings, Prettier and package verification: passed.
- Full Vitest: 124 files and 2,080 tests. Exact final three lines:

  ```text
       Tests  2080 passed (2080)
    Start at  10:50:31
    Duration  155.77s (transform 2.81s, setup 0ms, import 12.53s, tests 129.45s, environment 7ms)
  ```

- Baseline 320 × 900 panel: 288px shell, 596.71px tall, 4 enabled controls, one click for the
  full-year preset. Long row details were visibly clipped by hidden shell overflow.

### Task 0 checkpoint

- Build, TypeScript, ESLint, Prettier and package verification: passed.
- Full Vitest after rectification: 2,092 tests. Exact final three lines:

  ```text
       Tests  2092 passed (2092)
    Start at  11:12:52
    Duration  153.53s (transform 2.48s, setup 0ms, import 11.26s, tests 128.95s, environment 6ms)
  ```

- Privacy re-review: clean. Security re-review: no Critical, High or Medium findings; both Low
  coverage gaps were then closed by the storage-write mutation and legacy-write rejection case.

### Integrated checkpoint

- Full Vitest after catalogue/panel integration: 125 files and 2,091 tests. Exact final three lines:

  ```text
   Test Files  125 passed (125)
        Tests  2091 passed (2091)
     Start at  11:59:33
     Duration  155.97s (transform 2.69s, setup 0ms, import 12.64s, tests 129.31s, environment 7ms)
  ```

### Final exact gate sequence

- `pnpm exec wxt build`: passed; verified package size 997.37 kB.
- `pnpm exec vitest run`: passed. Exact final three lines:

  ```text
       Tests  2087 passed (2087)
    Start at  12:36:33
    Duration  156.57s (transform 2.56s, setup 0ms, import 11.90s, tests 130.60s, environment 7ms)
  ```

  The total is seven above the 2,080-test baseline. It is four below the integrated checkpoint
  because the four tests whose only subject was the unreachable evidence panel were deleted with
  that panel. The known missing TypeScript source-map warning appeared and did not fail the suite.

- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec eslint . --max-warnings 0`: passed with zero warnings.
- `pnpm exec prettier --check .`: initially identified the ignored Impeccable critique snapshot;
  the snapshot was formatted and the repo-wide rerun passed.
- `node scripts/verify-extension-package.mjs .output/chrome-mv3`: passed.
- Before final cleanup, this worktree's `node_modules` was 306,104 KiB and `.output` was 1,064 KiB.
  Both validated absolute targets were deleted. Available disk moved from 69,786,504 KiB to
  69,794,252 KiB (+7,748 KiB); the directories' 307,168 KiB logical size was removed, while APFS
  sharing/caches mean logical size is not expected to equal immediately reclaimed blocks. The
  worktree's 32 KiB `.wxt` directory was retained.

## Final reviewer disposition

- Security review of `8fa3510`: clean, with no Block or Warn finding. The reviewer confirmed no
  manifest, permission, host, CSP, content-script, remote-code or dependency drift; cleanup signals
  remain closed vocabulary; review deletion remains scope/revision guarded; and unknown, failed,
  zero-byte or ambiguous download evidence remains blocked. Its only residual limitation is the
  deliberately unqualified authenticated service-worker termination case.
- Privacy Medium — a default `"GSTR-3B"` argument in the generic panel model duplicated
  connector-owned GST knowledge. Fixed by requiring the caller's already-canonical return type;
  focused verification passed 4 files and 25 tests plus TypeScript and formatting.
- Privacy Low — the boundary summary said no persistence widening even though Task 0 adds bounded
  values to an existing durable signal field. Fixed by stating the precise contract: no new field,
  sensitive value or unbounded value, and an explicit fixed allowlisted vocabulary expansion.
- The privacy review otherwise passed credential/session handling, taxpayer-data non-transmission,
  telemetry absence, manifest reach, redaction, unsupported-capability copy, government disclaimer,
  commit-message safety and synthetic/live evidence labeling.

## Owner decision

- Decide separately whether failure to delete Pack's own durable bookkeeping record should keep
  blocking a fully proven download. This lane deliberately retains that fail-closed behaviour.

## Uncertainty and non-claims

- Live authenticated GST behaviour is unverified by design. No runtime, download, selector or
  portal claim is inferred from synthetic tests or packaged-browser layout evidence.
- The catalogued annual, quarterly and non-period returns remain unsupported. Their data shapes and
  explanations are present so absence does not masquerade as support.
- This lane is not a Chrome Web Store, legal, broad-GST-support or release-readiness claim.

## Decision log

- 2026-08-25T10:47:48+05:30 — Used a fresh branch from current `origin/master` in one isolated
  worktree; the dirty primary checkout remained untouched.
- 2026-08-25T10:53:20+05:30 — Did not generate a Graphify index. The branch has no graph data and
  the prior design audit records that generating it for Pack was a workflow deviation.
- 2026-08-25T10:57:00+05:30 — Classified the baseline 320px layout as failed because hidden overflow
  clipped meaning-bearing text even though document scroll width remained 320px.
- 2026-08-25T11:02:10+05:30 — Located the clear-stage vocabulary beside GST diagnostic vocabularies
  and derived the durable allowlist from it; no second hand-written list was introduced.
- 2026-08-25T11:12:00+05:30 — Accepted the security finding that a failed malformed-record sentinel
  write is `storage-write-failed`, not `storage-read-failed`, while preserving legacy throws.
- 2026-08-25T11:34:00+05:30 — Held implementation until three independent prototype owners finished
  and a fourth, non-generator agent measured and judged all directions.
- 2026-08-25T12:06:00+05:30 — Selected periodicity as structural catalogue data. Monthly is current
  support, not a permanent UI assumption.
- 2026-08-25T12:29:00+05:30 — Rejected a default-path accelerator after critique: it would add an
  unjudged execution path to save clicks rather than complete this structural overhaul.
- 2026-08-25T12:47:00+05:30 — Deleted the test-only evidence panel only after tracing and testing its
  live replacements; the fixed-point importer scan then reported no further orphan.
