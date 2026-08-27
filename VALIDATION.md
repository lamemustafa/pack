# Validation — catalogue overhaul lane

## Lane and boundaries

- Branch: `tapish-codex/catalogue-overhaul-01a03759`, created from freshly fetched `origin/master`
  at `78b74d1` in an isolated worktree. The machine-specific path is intentionally omitted.
- The dirty primary checkout was not edited, staged or cleaned.
- Collision check: no other `/tmp/pack-lanes` claim existed at lane creation. This lane owns the
  background diagnostic files, catalogue/capability model, side-panel scope UI and tests, the new
  `design-lab/10-catalogue-overhaul` directory, `DESIGN.md` and this record.
- Continued recovery-audit ownership: `src/connectors/gst/filed-returns-durable-status.ts`,
  `tests/background/full-fiscal-year-ledger.test.ts`,
  `tests/background/filed-returns-full-fiscal-year-recovery.test.ts`,
  `tests/background/filed-returns-session-write-boundary.test.ts`,
  `tests/background/local-data.test.ts` and `PROGRESS.md`. The lane
  register was rechecked before Cycle 18; no competing claim existed. No production storage or
  recovery module is claimed for modification in that cycle.
- No live GST Portal session, portal navigation, real taxpayer data, manifest/permission/CSP change,
  dependency change, new persisted field, sensitive or unbounded persisted value, target-binding
  weakening, public capability claim, push, PR or deployment was used. Task 0 expands only the
  fixed, allowlisted durable diagnostic-signal vocabulary described below.
- Cycle 19 additionally owns `src/entrypoints/popup/pack-summary.tsx`,
  `tests/popup/pack-summary.test.tsx`, `tests/panel/panel-evidence-counts.test.tsx` and
  `tests/panel/panel-ledger-evidence-counts.test.tsx`.
  The lane register had no competing claim, and the clean workflow preflight passed before edits.
- Cycle 20 owns the existing full-year ledger, summary, run-state and orchestration modules,
  the full-year recovery refusal message,
  current-state and local-data readers, plus the new `full-year-completion-*` tests/helpers in
  `tests/background` and `tests/panel`. The existing historical recovery test is included.
  No competing lane claim existed; clean workflow preflight passed before edits.
- Cycle 21 owns `popup/inline-status.tsx`, `popup/presentation-state.ts`, the existing full-year
  run-state copy, and their focused tests: `popup/full-year-recovery-copy.test.tsx`,
  `panel/full-year-cleanup-status.test.tsx`, `background/full-year-retained-scope-copy.test.ts`,
  plus existing inline/presentation assertions if the intended copy change requires adjustment.
  The lane register had no competing claim; clean workflow preflight passed at cycle start.
- Its short-window follow-up also owns the already claimed `panel/panel-guided-scope.tsx` and
  `tests/panel/panel-guided-scope-interaction.test.tsx`. A clean workflow preflight passed again
  before this focused change; no other lane claim existed.

## Outcome

### Cycle 82 — pre-start target-review storage block

- A target-review storage read failure at the initial start boundary now projects a fixed blocked
  flow step and scope-bound summary before run acquisition. The popup can render that summary; no
  portal action, download or new persisted data results from the failure.
- The regression first rejected from the runner. Restored focused proof asserts the exact safe copy,
  action, requested scope, zero completions and no dispatch. Privacy and security follow-up reviews
  passed, and the final full gate passed 152 files and 2,832 tests.

### Cycle 81 — local-data recovery-read safety

- Clear local Pack data now returns an exact, fixed recovery-verification error when its retained
  recovery inspection cannot read storage. It makes no destructive storage call in that state;
  Options already renders the backend error rather than a generic fallback.
- The regression first rejected out of the action. Restored targeted proof checks the exact response
  and no session/local deletion. The security review and full gate found no storage scope,
  target-binding, download-evidence or MV3 regression; the final suite passed 152 files and 2,830
  tests.

### Cycle 80 — retained checkpoint storage-read block

- A session-storage read failure before artifact-acquisition recovery inspection now returns a fixed
  blocked response with an explicit retry-only remedy; it does not dispatch a portal action or
  download, and cannot treat missing recovery state as safe.
- The regression first rejected out of the runner. Restored focused proof covers the exact safe
  signal, message, recovery action and no-new-start condition. Privacy and security reviews found no
  sensitive data persistence, target-binding, MV3 or download-evidence regression. The final serial
  suite passed 152 files and 2,829 tests.

### Cycle 79 — pinned tab-session storage distinction

- A pinned full-year continuation now keeps session-storage unavailability distinct from an actual
  missing, changed or navigated-away tab. The former persists the existing retryable
  `full-fiscal-year-gst-tab-session-unavailable` outcome without focusing or looking up any tab;
  the latter retains the existing fail-closed clear-plan outcome.
- The regression first failed on the old flattened pinned-tab signal. Restored focused proof passed
  2 files and 8 tests; the complete gate passed 152 files and 2,828 tests. A focused security review
  found no target-binding, MV3, storage, permission, CSP or download-evidence regression.

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

## Sustained-cycle evidence — 2026-08-26

### Cycle 1 — emitted staged-signal discrimination

- Before: the two staged-signal allowlist tests proved every generated token was accepted, but no
  test proved that the generated suffix still named the input stage.
- Added exact parameterised output assertions for all 9 target-review-clear stages and all 10
  single-period cleanup-checkpoint stages. No production behavior changed.
- Mutation 1: made the target-review builder return the valid constant
  `filed-returns-target-review-clear-failed:storage-key-missing`. Result: 8 failed and 36 passed;
  each non-constant case reported its expected stage and the received `storage-key-missing` stage.
- Mutation 2: made the cleanup builder return the valid constant
  `single-period-cleanup-checkpoint-failed:bundle-missing`. Result: 9 failed and 35 passed; each
  non-constant case reported its expected stage and the received `bundle-missing` stage.
- Both production mutations were restored. The focused file then passed 44 tests.
- Complete gate: build passed at 997.37 kB; TypeScript, zero-warning ESLint, repo-wide Prettier and
  package verification passed. Full Vitest exact final three lines:

  ```text
       Tests  2106 passed (2106)
    Start at  01:09:53
    Duration  157.30s (transform 3.03s, setup 0ms, import 12.75s, tests 130.44s, environment 7ms)
  ```

- Scope audit: exact type/symbol search found only these two typed staged-error/signal families.
  Dynamic artifact, OPFS, navigation and capture signals remain candidates for later duplicate-fact
  and test-quality cycles; this result does not declare every dynamic signal constructor clean.

### Cycle 2 — Direction B implementation completeness

- A behavior-by-behavior product/prototype ledger now lives in
  `design-lab/10-catalogue-overhaul/05-direction-b-parity.md`. Every explicit behavior is classified
  equivalent, intentionally product-specific or closed; no difference is left implicit.
- Without-fix evidence: the new supported-artifact render assertion failed once. Expected the
  GSTR-3B row to contain `Monthly · available · Filed return (PDF) · Portal data (JSON)`; received a
  nine-row disclosure whose supported rows stopped at `Monthly · available`.
- The product now renders canonical concrete artifact labels for all three supported rows.
  Unsupported rows remain `not available in Pack` and contribute zero controls. Combined file
  selections remain in the guided file step rather than being mislabelled as portal artifacts.
- Removed one unused optional start-scope branch and stale preset comments. Production searches
  showed no caller supplied the removed argument.
- Prototype measurement at 320 × 900: Enter on the focused select did not advance, catalogue-open
  height 1,405.84px, 3 controls, 9 rows and zero overflow. This disproved the suspected Enter-key
  parity gap.
- Packaged synthetic measurement at 320 × 900 after rectification:

  | State          | Controls | Shell height | Focus                | Overflow |
  | -------------- | -------: | -----------: | -------------------- | -------: |
  | Return         |        3 |     624.76px | select               |      0px |
  | FY             |        4 |     693.55px | select               |      0px |
  | Period         |        4 |     676.76px | select               |      0px |
  | File           |        4 |     681.95px | select               |      0px |
  | Catalogue open |        4 |   1,092.70px | summary after toggle |      0px |

- The final action named the exact synthetic scope; the open catalogue had 9 rows, canonical
  artifact labels, 6 unsupported rows, 0 unsupported controls and no clipped descendant.
- Impeccable detector: empty finding set. Technical audit: 19/20; the one withheld point records
  unqualified external assistive-technology behavior rather than treating source semantics as
  proof.
- Complete gate: build and package verification passed at 997.44 kB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2107 passed (2107)
    Start at  01:26:03
    Duration  167.97s (transform 3.09s, setup 0ms, import 13.44s, tests 138.45s, environment 8ms)
  ```

- This is synthetic product evidence. It does not qualify portal behavior, screen readers, browser
  zoom or translated copy.

## Owner decision

- Decide separately whether failure to delete Pack's own durable bookkeeping record should keep
  blocking a fully proven download. This lane deliberately retains that fail-closed behaviour.

## Uncertainty and non-claims

- Cycle 63 found no historical revision with the objective's 152-file baseline, so it did not invent
  an unknown test. Cycle 73 adds a genuine options failure regression and the current tracked tree
  and full Vitest gate now both report 152 test files. This resolves the present baseline-count gap;
  the original historical 152nd test is still not identified and no claim is made that it was restored.
- Live authenticated GST behaviour is unverified by design. No runtime, download, selector or
  portal claim is inferred from synthetic tests or packaged-browser layout evidence.
- The catalogued annual, quarterly and non-period returns remain unsupported. Their data shapes and
  explanations are present so absence does not masquerade as support.
- This lane is not a Chrome Web Store, legal, broad-GST-support or release-readiness claim.
- Cycle 18 does not certify general aggregate/target completion consistency. Its controls separate
  ledger-read acceptance from session-summary rejection; the cross-reader consistency audit is a
  named follow-up, not hidden inside the filename-copy approval.
- Cycle 71 rechecked the former full-year cleanup visibility gap against the current synthetic
  producer, durable parser and full panel. All three cleanup phases render a polite inline status
  with the exact safe message in both no-portal and unsupported contexts, while retaining no
  recovery action or start-fresh authority. This resolves the narrow missing-status claim only;
  it does not qualify normal-workflow provenance, authenticated portal behavior, browser restart
  handling, or any new cleanup action authority.
- End-of-Cycle-19 triage prioritized recovery-preserving agreement between stored-state readers.
  Independent source review and isolated dependency-stubbed probes support that follow-up;
  its normal-workflow origin and live behavior remain unqualified. It is not part of the
  count-removal checkpoint or its approval.
- Cycle 20 repairs the measured target-disagreement cases across readers and recovery selection.
  Its synthetic sweep still leaves 48 all-positive legacy-cleanup projections rejected by the
  summary parser. It does not certify general cleanup consistency or normal-workflow provenance.
- Cycle 29 proves only the local extension message path: a failed saved-summary read now remains
  visible with its safe error copy after portal context succeeds. It does not qualify session-storage
  failure frequency, browser restart behavior, authenticated portal behavior, or any recovery action.

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

### Cycle 3 — complete presentation-state and catalogue matrix

- Exact state inventory: loading, empty/ready, unsupported, access denied, downloading, partial,
  complete, unavailable, blocked, error and cancelled. Permanent component assertions now cover
  each family; cancelled confirmation no longer disappears when presentation returns to `ready`.
- Exact catalogue inventory: supported monthly GSTR-3B, GSTR-1 and GSTR-2B; unsupported annual
  GSTR-9 and GSTR-9C; unsupported quarterly GSTR-4 and GSTR-4A; unsupported monthly IFF; and
  unsupported non-periodic Ledgers. Every row's decision is pinned. Unsupported rows render zero
  controls and cannot enter runtime selection.
- Access-denied boundary: the captured error route wins over a stale filed-returns page title, but
  remains neutral about cause. It persists only reduced origin/page-kind context. The reporting tab
  is exact-GST-origin trusted but remains non-actionable: it cannot replace the remembered
  navigation/download tab and operational selection still excludes portal error pages.
- Without-fix evidence:
  - Detector expected an access decision but received generic navigation-required context; panel
    presentation expected access handling but received `unsupported`.
  - Cancelled-run status expected `Ready for a new download`; inline markup was empty and panel
    markup omitted both the title and reset confirmation.
  - A stale `View Filed Returns` title initially overrode the access-denied path until route
    precedence was made explicit.
- Synthetic Chromium at exactly 320 × 900 measured every presentation family with 320px document
  width and zero clipped descendants. Final neutral access denial: 426.66px tall, one action. Open
  catalogue: 1,018.70px tall, 9 rows, 6 unsupported decisions, 0 row controls, zero clipping.
- Financial/performance boundary: a single validated canonical decimal already classified as
  unrepresentable and longer than `MAX_EXCEL_STRING_LENGTH` now takes the same bounded nonnumeric
  total fallback without a discarded huge-integer conversion. Multiple inputs still sum exactly,
  preserving cancellation semantics. The focused workbook and offscreen cases passed together;
  the full changed-file set passed 223 tests.
- Privacy review: CLEAN on committed head `dfc6112`; neutral copy, reduced storage and bounded
  financial fallback introduced no sensitive-data, telemetry, persistence-widening or claim issue.
- Security review: PASS; trusted observation and actionable automation remain separate, exact host
  and permission policy is unchanged, and handler tests close the earlier reachability/stale-state
  warning. No live GST qualification was performed.
- Complete gate: build and package verification passed at 998.39 kB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2128 passed (2128)
    Start at  01:56:41
    Duration  187.68s (transform 5.53s, setup 0ms, import 21.44s, tests 143.43s, environment 20ms)
  ```

- This evidence is source/synthetic only. It does not prove live portal cause, authenticated portal
  behavior, assistive-technology announcements, browser zoom, translated copy or release readiness.

### Cycle 4 — keyboard and accessibility-tree qualification

- Without-fix proof: after Continue, the second step reused the first step's select node. The new
  test expected a newly mounted field and failed on DOM identity; no fresh select focus event was
  available for the changed field name/hint.
- Fix: `key={step.key}` remounts the native select for each canonical guided step. The existing
  focus effect then moves focus to the new control. Permanent tests bind all four steps to exact
  progress status, label, hint and described-by relationships.
- Chromium at 320 × 900 exposed this exact accessibility-tree sequence:

  | Step | Status      | Focused combobox | Accessible description                                 |
  | ---: | ----------- | ---------------- | ------------------------------------------------------ |
  |    1 | Step 1 of 4 | Return           | Choose one supported return for this run.              |
  |    2 | Step 2 of 4 | Financial year   | Pack keeps each run within one financial year.         |
  |    3 | Step 3 of 4 | Filed period     | Choose one month or the full fiscal year.              |
  |    4 | Step 4 of 4 | File             | Choose one artifact selection offered for this return. |

- Keyboard path: Tab/Enter advanced, Back returned and refocused Step 2, Space expanded the
  catalogue, Shift+Tab returned to the final action and Enter submitted the exact visible synthetic
  scope. Both select and action focus rings computed to 2px solid with 2px offset. The open
  disclosure remained 320px wide with zero clipping, 9 rows, 6 unsupported decisions and 0 row
  controls.
- Native-select limitation: ArrowDown reached the enabled focused select and was not prevented by
  Pack, but Playwright on macOS could not observe selection inside the OS-owned popup. This is not
  claimed as verified option movement. No custom listbox or keyboard handler was introduced.
- Impeccable deterministic detector returned `[]`. This was a temporary local harness; all harness,
  browser snapshot and console files were deleted before commit.
- Complete gate: build and package verification passed at 998.40 kB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2130 passed (2130)
    Start at  02:14:04
    Duration  153.06s (transform 2.61s, setup 0ms, import 11.78s, tests 126.20s, environment 7ms)
  ```

- Evidence level: real Chromium DOM, keyboard and accessibility-tree evidence for app-owned
  behavior; not an authenticated GST run and not a VoiceOver, NVDA or OS-native select transcript.

### Cycle 5 — supported-return identity reduction

- Canonical-source trace: `filed-returns-catalogue.ts` owns supported status, label and scope ID;
  `filed-returns-return-types.ts` derives its runtime union and slug. The descriptor table now owns
  only portal route, heading, control and reselection mechanics. Callers retain the same descriptor
  label and signal interface.
- Exact production line counts:

  | File                                  | Before | After | Reason                                        |
  | ------------------------------------- | -----: | ----: | --------------------------------------------- |
  | `filed-returns-return-descriptors.ts` |     74 |    67 | Removed repeated identity fields              |
  | `artifact-source.ts`                  |    348 |   357 | Added canonical type and fail-closed dispatch |
  | `artifact-validation.ts`              |     97 |    97 | Replaced a literal union with canonical type  |
  | `filed-returns-download-trigger.ts`   |  1,041 | 1,042 | Imported canonical type for response boundary |

- Discrimination evidence: the synthetic future return `GSTR-FUTURE` must resolve to
  `unsupported-target` with no fetch and no click. Removing the explicit switch produced this
  failure instead:

  ```text
  AssertionError: promise rejected "TypeError: Cannot read properties of unde…" instead of resolving
  Caused by: TypeError: Cannot read properties of undefined (reading 'label')
  ```

- Review disposition: the security review's future fail-open WARN was fixed with explicit
  GSTR-2B/GSTR-1/GSTR-3B dispatch and a fail-closed default, then re-reviewed PASS. Privacy review
  was CLEAN before and after rectification. There was no change to target/action/download guards,
  storage, logging, sensitive data, permissions or public capability copy.
- Complete gate: build and package verification passed at 998.00 kB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2131 passed (2131)
    Start at  02:28:16
    Duration  192.64s (transform 4.49s, setup 0ms, import 23.31s, tests 147.09s, environment 12ms)
  ```

- Evidence level: source, static typing, synthetic DOM and unit/integration gates only. No
  authenticated GST run, new portal capture, permissions change or release-readiness claim.

### Cycle 6 — catalogue density and scanning

- Preserved contract: all nine canonical catalogue entries render; supported return selection
  remains exactly GSTR-3B, GSTR-1 and GSTR-2B; every available artifact label and every unavailable
  periodicity remains visible; unavailable rows contain no control.
- Discrimination evidence: before implementation, the focused grouping test failed with:

  ```text
  AssertionError: expected '<section class="panel-guide" aria-lab…' to contain '3 available · 6 unavailable'
  ```

- Real Chromium measurement at 320 × 900:

  | Measure                        |   Before |   After |
  | ------------------------------ | -------: | ------: |
  | Expanded panel height          | 1,018.70 |  810.83 |
  | Height reduction               |        — |  207.87 |
  | Catalogue details height       |        — |  428.95 |
  | Document width                 |      320 |     320 |
  | Clipped descendants            |        0 |       0 |
  | Catalogue list items           |        9 |       9 |
  | Catalogue child controls       |        0 |       0 |
  | Unsupported-list column widths |        — | 137/137 |

- Chromium accessibility tree exposed a level-three `Available 3` heading followed by three list
  items, then a level-three `Not available in Pack 6` heading followed by six list items. No text
  was visually truncated. The temporary loopback harness, browser logs, snapshot and screenshot
  were deleted and its server/browser stopped before commit.
- Impeccable deterministic detector reported two advisory font sizes at unchanged lines outside
  this diff. Privacy review was CLEAN; security review found no changed action, message, storage,
  permission, content/background or download boundary.
- Complete gate: build and package verification passed at 998.69 kB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2132 passed (2132)
    Start at  02:40:54
    Duration  212.43s (transform 6.79s, setup 0ms, import 26.21s, tests 162.33s, environment 10ms)
  ```

- Evidence level: real Chromium layout/accessibility-tree evidence plus synthetic component and
  repository gates; no authenticated GST run, assistive-technology transcript or release claim.

### Cycle 7 — artifact-checkpoint clear diagnostics

- Before: every blocked exit from artifact-checkpoint cancellation returned the same state-only
  result. The target-review boundary therefore knew that clearing failed but not whether the cause
  was intent policy, malformed recovery, download lookup, exact-target mismatch, danger, size,
  cancellation confirmation, download state or session storage.
- Fix: a closed 16-value connector vocabulary is returned by the producer, transformed into an
  exact durable signal and rendered through canonical fixed copy. No caught exception text,
  browser object, filename, URL, portal value or taxpayer value is retained or rendered. Existing
  generic signal compatibility remains while the latest specific reason replaces any prior reason.
- Fail-closed cap behavior: adding diagnostics to an already dense review is attempted only through
  strict durable parsing. If the result is invalid or exceeds 32 signals, the original valid review
  and its artifact-ownership marker remain unchanged. The code does not persist a generic fallback
  that a later cancellation could mistake for permission to remove recovery.
- Two-call cap regression: a valid 31-signal review containing an artifact recovery marker receives
  two blocked cancellation attempts. Both call exact checkpoint clearing, neither calls local
  review removal or persistence, and the original artifact marker remains after both calls.
- Discrimination evidence:
  - Initial storage-read test failed because received `{ state: "blocked" }` omitted expected reason
    `storage-read-failed`.
  - A constant producer reason caused 15 failures, one for every non-storage-read exit.
  - A constant signal builder caused 31 failures: 15 observable review signals, 15 explicit emitted
    strings and one durable-vector uniqueness assertion.
  - Reintroducing generic canonical fallback at the 32-signal boundary changed the first response
    from expected `user-action-required` to received `blocked` and failed the two-call test.
- Exact production line counts:

  | File                                           | Before | After |
  | ---------------------------------------------- | -----: | ----: |
  | `background/artifact-acquisition-state.ts`     |    651 |   669 |
  | `background/filed-returns-target-review.ts`    |  1,534 | 1,570 |
  | `gst/artifact-acquisition-checkpoint-clear.ts` |      0 |    27 |
  | `gst/filed-returns-durable-signals.ts`         |    710 |   717 |
  | `gst/filed-returns-durable-status.ts`          |    451 |   518 |

- Review disposition: privacy CLEAN and security PASS, both bound to exact committed head
  `7f974fc34a89cf371630d53192caba3a00fadb1b`. The reviewers confirmed fixed categorical data only,
  unchanged exact target/action/download-ID guards, unchanged danger/size completion evidence, and
  no manifest, permission, host, CSP, content, dependency, logging or remote-code drift.
- Complete gate: build and package verification passed at 1.00 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2181 passed (2181)
    Start at  03:02:10
    Duration  153.83s (transform 2.55s, setup 0ms, import 11.33s, tests 128.81s, environment 7ms)
  ```

- Evidence level: static review and synthetic unit/integration gates only. No authenticated GST
  run, portal capture, persistence widening, user-data observation or release-readiness claim.

### Cycle 8 — selected-artifact progress storage state

- Before: selected-artifact progress read every session-summary exception as `null`; malformed
  progress was deleted and also returned as `null`. The caller used `null` as “no completed
  artifacts” and could proceed toward page preparation and a repeated artifact action.
- Contract: `missing` is now the only retryable absence. `malformed-summary`,
  `storage-read-failed` and `storage-write-failed` are one closed connector-owned vocabulary. Each
  becomes an exact allowlisted durable signal and fixed canonical message; arbitrary suffixes are
  rejected. The caller sets `canResume: false` and returns before page preparation, visible-scope
  matching or download triggering.
- Redaction and durability: unknown malformed session input is atomically overwritten at the same
  key with an existing parser-validated blocked summary containing canonical scope plus fixed
  signal/message only. No key, sentinel or field was added. A second read recognizes that signal
  and remains blocked. If overwrite fails, the result is `storage-write-failed`; no action resumes.
- Observable tests:
  - genuine missing returns `null` without a remove or write;
  - malformed input is absent from serialized storage after canonical replacement;
  - repeated read of the replacement returns `malformed-summary` again;
  - storage get, valid-summary canonical write and malformed redaction write are separately tested;
  - all three caller responses have exact signal/copy, `canResume: false`, no mismatch preparation
    and no download trigger.
- Discrimination evidence:
  - The initial read-failure case threw its synthetic exception; malformed state progressed to a
    later `undefined.ok` error instead of returning the expected blocked response.
  - A missing/error collapse made three result tests receive `null` while genuine missing passed.
  - A constant signal builder produced five failures across result propagation, exact emitted
    strings and durable-vector uniqueness.
  - Removing redaction made the permanent test receive the raw unknown object where it expected a
    canonical blocked summary.
- Exact production line counts:

  | File                                              | Before | After |
  | ------------------------------------------------- | -----: | ----: |
  | `background/filed-returns-artifact-progress.ts`   |    278 |   338 |
  | `background/filed-returns-selected-artifacts.ts`  |    928 |   940 |
  | `background/filed-returns-session-summary.ts`     |     72 |   113 |
  | `gst/filed-returns-artifact-progress-recovery.ts` |      0 |    28 |
  | `gst/filed-returns-durable-signals.ts`            |    717 |   722 |
  | `gst/filed-returns-durable-status.ts`             |    518 |   540 |

- Review disposition: privacy CLEAN and security PASS on the committed source head
  `259163a61c138648497a9d3fe47c8b7c671f1ca0`. Privacy confirmed raw unknown input is replaced by
  existing canonical fields only. Security confirmed serialized mutation, repeated-read guard,
  exact scope, no-action return and no manifest, permission, CSP, dependency, target-binding or
  download-evidence drift.
- Complete gate: build and package verification passed at 1.00 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2193 passed (2193)
    Start at  03:33:10
    Duration  148.44s (transform 2.43s, setup 0ms, import 10.84s, tests 124.04s, environment 7ms)
  ```

- Evidence level: static review and synthetic storage/unit/integration gates only. No authenticated
  GST run, portal capture, sensitive input observation, permission change or release claim.

### Cycle 9 — filename-outcome durability and canonical copy

- Before: post-completion filename comparison treated an absent browser filename as a match, and
  the selected-ZIP post-check treated rejected search, missing exact item and missing filename as
  no warning. The completed download evidence was still exact-ID, safe and non-empty, but the
  result could imply the requested saved name was confirmed when it was not.
- Contract: filename evidence is a three-state projection: `matched`, `overridden` or `unavailable`.
  Completion remains positive because filename inspection occurs only after the existing exact-ID,
  completed, safe, non-empty proof. Uncertainty changes diagnostic copy only; it does not create or
  revoke download evidence and does not authorize a retry.
- Durable vocabulary: one connector-owned source defines four unavailable reasons and two override
  reasons. The exact allowlist and canonical renderer consume that source. Browser exceptions,
  filenames and paths are discarded; only a fixed category is persisted.
- Reopen agreement:
  - direct unavailable and direct override completion persist and reopen with exact fixed warning;
  - ZIP missing item, search unavailable, filename unavailable and override all persist and reopen;
  - canonical per-target copy appends the same category-owned warning;
  - partial selected ZIPs retain both their paired missing-artifact explanation and filename
    warning rather than returning before warning reconstruction;
  - an exact previous canonical target message is accepted only as migration input, while the
    current derived copy includes the warning.
- Failure evidence:
  - Initial implementation tests: 4 failures out of 48 focused tests.
  - Missing-as-matched mutation: 2 failures out of 48.
  - Constant ZIP-reason mutation: 2 failures out of 28.
  - Removed allowlist entries: 4 failures out of 110 session-boundary tests.
  - Missing canonical copy/direct override allowlist: 13 failures across 227 focused tests.
  - Partial-summary early return: 2 failures out of 114 session-boundary tests.
- Review disposition: the security allowlist/reopen finding and both privacy canonical-copy
  findings were fixed and re-reviewed. Privacy is CLEAN/PASS and security is PASS on exact
  committed source head `94b45dcaca3d926a5433e9a700a578bbe15a072c`.
  Fixed copy contains no raw filename, path, browser error, portal value or taxpayer value.
- Complete gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2216 passed (2216)
    Start at  04:00:44
    Duration  155.40s (transform 2.84s, setup 0ms, import 13.34s, tests 126.71s, environment 8ms)
  ```

- Evidence level: static review and synthetic storage/unit/integration gates only. No authenticated
  GST run, browser download fixture, portal capture, sensitive input observation, permission
  change or release-readiness claim.

### Cycle 10 — full-year ZIP positive/negative prefix agreement

- Before: `messageKeyForSummary` selected final-ZIP review copy for any signal containing
  `full-fiscal-year-zip-download`. The positive terminal signal
  `full-fiscal-year-zip-downloaded` matched that substring and therefore reopened a complete run
  with unconfirmed-download copy.
- Regression: canonical persistence accepted the complete full-year summary and retained both
  `full-fiscal-year-complete` and `full-fiscal-year-zip-downloaded`, but the reopened message was
  `Pack could not confirm the final fiscal-year ZIP. Check the exact browser download before
retrying.` The focused test failed 1 of 115 session-boundary cases before the fix.
- Fix: delimiter-aware prefix `full-fiscal-year-zip-download-` retains review handling for every
  current negative/observing signal and excludes the positive `...-downloaded` sibling. The
  canonical status, flow state, signals and positive evidence are unchanged.
- Review disposition: privacy CLEAN/PASS and security PASS on exact source head
  `4979c69f25090b083019b11096a9fe041f649d92`. No sensitive data, storage shape, permissions,
  background action, downloads API, completion evidence or retry authority changed.
- Complete gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2217 passed (2217)
    Start at  04:08:06
    Duration  156.13s (transform 2.86s, setup 0ms, import 13.54s, tests 127.21s, environment 8ms)
  ```

- Evidence level: static review and synthetic persistence/reopen gates only. No authenticated GST
  run, portal capture, sensitive input observation, permission change or release-readiness claim.

### Cycle 11 — completed full-year no-artifacts copy

- Before: canonical persistence retained the exact `full-fiscal-year-no-zip-artifacts` signal, but
  `messageKeyForSummary` selected generic `complete` copy. A reopened run therefore claimed Pack
  completed a local filed-return download even though its durable outcome said no ZIP was created.
- Regression: the new persistence/reopen case failed 1 of 116 session-boundary tests before the
  fix. Expected the fixed no-artifacts sentence; received
  `Pack completed the local filed-return download for the saved fiscal-year run.` while the
  complete state and no-artifacts signal both remained present.
- Fix: a complete-only, exact-signal branch selects fixed no-artifacts copy. All existing
  interrupted, active, explicit-action, cleanup-failure, unconfirmed-download, positively-not-filed
  and target-review classifiers precede it. This changes only canonical rendering; status, flow
  state, signals, storage shape, user action and runtime authority are unchanged.
- Exact line counts:

  | File                                                      | Before | After |
  | --------------------------------------------------------- | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`                     |    580 |   586 |
  | `background/filed-returns-session-write-boundary.test.ts` |  1,162 | 1,191 |

- Review disposition: privacy CLEAN/PASS and security PASS on exact committed source head
  `6f05ed0be4f8021b72e67b9cdfa05d28764181b9`. Privacy found no sensitive data or capability
  overclaim; security confirmed fail-closed branch precedence and no completion, retry, cleanup,
  persistence, background, downloads-API, permission, host or CSP change.
- Complete gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2218 passed (2218)
    Start at  04:14:22
    Duration  149.25s (transform 2.43s, setup 0ms, import 10.91s, tests 124.67s, environment 7ms)
  ```

- Evidence level: static review and synthetic persistence/reopen gates only. No authenticated GST
  run, portal capture, sensitive input observation, permission change or release-readiness claim.

### Cycle 12 — portal-cause durability with fail-closed mixed precedence

- Before: a full-year blocked target was canonicalized to fixed portal-cause copy during ledger
  summarisation, but session persistence reclassified the same signals as generic
  `full-year-needs-action`. System error, scheduled downtime and access-denied/expired-session all
  lost their distinct fixed reason on reopen even though the exact durable signal remained.
- Isolated regression: all 3 new cause rows failed and 116 existing session-boundary rows passed.
  The expected fixed portal sentence was replaced by
  `Pack needs an explicit recovery action before continuing the saved fiscal-year run.`
- Contract: target and summary renderers share one exact three-signal portal-availability mapping.
  Summary projection requires `full-fiscal-year-run-needs-action` plus blocked/partial status;
  complete and cancelled statuses remain excluded. The mapping returns existing fixed message keys
  and cannot interpolate stored values.
- Review finding and rectification: the initial projection preceded cleanup, final-ZIP review and
  target review. Because non-complete durable summaries admit contradictory but individually valid
  signals, that could hide a stronger download or cleanup instruction. A centralized blocking
  recovery projection now wins first, followed by target review, then portal cause, then generic
  needs-action. Outside the mixed branch, the previous active/cleanup/ZIP/not-filed/target-review
  ordering is unchanged.
- Mutation proof: moving portal projection before the rectified precedence failed 3 of 3 selected
  rows (119 unrelated rows skipped). Each expected stronger sentence was replaced by the fixed
  system-error sentence. Restoring the committed order passed all 3.
- Exact line counts:

  | File                                                      | Before | After |
  | --------------------------------------------------------- | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`                     |    586 |   606 |
  | `background/filed-returns-session-write-boundary.test.ts` |  1,191 | 1,281 |

- Review disposition: privacy CLEAN/PASS and security PASS on exact source head
  `0817a1081ec3fdb8f94fc830514dd17100b7830a`. The privacy review's initial Medium is closed by
  three mixed-signal persistence/reopen cases. Fixed copy contains no credentials, session data,
  taxpayer value, raw portal data, path, filename or exception. No storage, state, action,
  completion, retry, downloads API, background, permission, host or CSP behavior changed.
- Complete final gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2224 passed (2224)
    Start at  04:27:30
    Duration  150.18s (transform 2.57s, setup 0ms, import 10.91s, tests 125.60s, environment 7ms)
  ```

- Evidence level: static review and synthetic persistence/reopen gates only. No authenticated GST
  run, portal capture, sensitive input observation, permission change or release-readiness claim.

### Cycle 13 — legacy full-year delivery ambiguity and fragment composition

- Before: full-year terminal aggregate validation intentionally accepted the compatibility vector
  `status: complete` plus `full-fiscal-year-complete`, but canonical copy treated that vector as a
  proved local download. Current producers add `full-fiscal-year-zip-downloaded` or
  `full-fiscal-year-no-zip-artifacts`; absence of both is indeterminate rather than delivery proof.
- Contract: preserve the compatible summary but render a fixed caution: the saved fiscal-year run
  completed, while the final ZIP download was not confirmed. The classifier requires canonical
  `FULL_FISCAL_YEAR` scope and complete status. Explicit no-artifacts and confirmed ZIP branches
  retain precedence; the change adds no signal or persisted field.
- Fragment rule: filename outcome is diagnostic, not delivery authority. The canonical composer
  omits filename fragments when its base key is legacy delivery ambiguity or explicit no-artifacts.
  Every other path retains the existing overridden/unavailable filename sentences.
- Failure evidence:
  - Base legacy row: 1 selected failure; expected cautious copy, received generic completed local
    download copy.
  - Legacy plus overridden filename: 1 selected failure; cautious copy was followed by
    `Pack completed the download`.
  - Cross-scope March completion: 1 selected failure; an extra allowlisted full-year token relabelled
    it as a fiscal-year ambiguity and removed its confirmed-download filename warning.
  - No-artifacts mutation: 2 selected failures; overridden and unavailable rows each appended a
    completed-download sentence after explicit `No ZIP was created` copy. Both passed after restore.
- Exact line counts:

  | File                                                      | Before | After |
  | --------------------------------------------------------- | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`                     |    606 |   625 |
  | `background/filed-returns-session-write-boundary.test.ts` |  1,281 | 1,378 |

- Review disposition: privacy CLEAN/PASS after closing one Medium mixed-claim finding; security
  PASS after closing one cross-scope WARN. Both are bound to exact source head
  `bcc86f6da8ffd6fc0443ceb163314d38762a2344`. Fixed copy contains no sensitive values. No runtime
  status, state, user action, persistence shape, completion evidence, retry authority, downloads
  API, background, permission, host or CSP behavior changed.
- Complete final gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2228 passed (2228)
    Start at  04:41:23
    Duration  151.32s (transform 2.55s, setup 0ms, import 11.50s, tests 124.68s, environment 7ms)
  ```

- Evidence level: static review and synthetic persistence/reopen gates only. No authenticated GST
  run, portal capture, sensitive input observation, permission change or release-readiness claim.

### Cycle 14 — full-year key scope binding and portal-cause independence

- Before: `messageKeyForSummary` received canonical scope but most full-year signal branches still
  trusted their token alone. A valid single-period durable summary with a foreign full-year token
  could therefore reopen as a saved fiscal-year run, interrupted fiscal-year run, final fiscal-year
  ZIP review or final-ZIP-delivered cleanup.
- Scope contract: derive `isFullFiscalYear` from canonical scope once and require it for every
  full-year-only summary key. The blocking-recovery classifier receives that scope fact: generic
  cleanup stays active for any scope, while final-fiscal-year delivery and ZIP-review claims require
  full-year scope.
- Portal-cause contract: fixed system-error, scheduled-downtime and access-denied/expired-session
  copy is scope-neutral. Blocked/partial summaries reconstruct it after cleanup, positive-not-filed
  and target-review checks. Full-year `run-needs-action` retains the same stronger mixed precedence.
- Failure evidence:
  - Cross-scope table: 4 failures for resume, interrupted, active and unconfirmed final ZIP; each
    expected generic March recovery and received full-year-specific copy.
  - Cleanup vector: 1 failure; expected generic target cleanup, received confirmed final-fiscal-year
    ZIP cleanup because a foreign delivery token was present.
  - Independent portal table: 3 failures; each exact portal signal reopened with generic March
    recovery instead of its fixed cause.
- Exact line counts:

  | File                                                      | Before | After |
  | --------------------------------------------------------- | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`                     |    625 |   642 |
  | `background/filed-returns-session-write-boundary.test.ts` |  1,378 | 1,438 |

- Review disposition: privacy CLEAN/PASS and security PASS on exact source head
  `880a6b73ac9da025bca135847039ad67fc019823`. No fixed sentence interpolates durable data. No
  status, state, user action, persistence shape, completion evidence, retry authority, downloads
  API, background, permission, host or CSP behavior changed.
- Complete gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2236 passed (2236)
    Start at  04:48:54
    Duration  156.21s (transform 2.87s, setup 0ms, import 13.90s, tests 126.55s, environment 8ms)
  ```

- Evidence level: static review and synthetic persistence/reopen gates only. No authenticated GST
  run, portal capture, sensitive input observation, permission change or release-readiness claim.

### Cycle 15 — unresolved target filename claims

- Before: `canonicalDurableTargetMessage` appended completion-form filename prose to every target
  status. A target-review sentence could therefore say both that Pack could not verify its browser
  download and that Pack completed the download.
- Contract: the canonical `downloaded` status alone retains the existing completion-form filename
  caution. Unresolved targets keep a neutral caution for unavailable filenames; overridden-name
  copy explicitly disclaims target ownership and does not imply that an actual name was stored.
- Review-driven rejection: one browser ID plus completed/non-empty tokens is not enough for this
  renderer to assert target-bound completion. It has no validated scope/action diagnostic, and
  individually allowed target/action/start/diagnostic rejection signals can coexist with those
  tokens. The attempted browser-only helper was removed; the existing single-period ZIP evidence
  helper and its authority are unchanged.
- Failure evidence: restoring the old completion-form branch failed all 7 selected tests. The two
  filename-family rows and five connector contradiction rows expected the neutral caution but
  received `Pack completed the download` following unverified-download copy. Exact restoration
  passed all 7. The contradiction rows also reject the intermediate claim that Pack recorded a
  different saved name.
- Exact line counts:

  | File                                         | Before | After |
  | -------------------------------------------- | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`        |    642 |   661 |
  | `background/full-fiscal-year-ledger.test.ts` |  1,226 | 1,274 |

- Review disposition: privacy CLEAN/PASS after closing two Medium claim findings; security PASS
  after closing the browser-only-evidence WARN. Both are bound to exact source head
  `2aa4324eb6f13b88d40f20f2e9380d4c7a87e8d0`. No sensitive data, new stored field, status,
  state, user action, completion/retry authority, cleanup, downloads API, background, permission,
  host or CSP behavior changed.
- Complete final gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning
  ESLint and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2243 passed (2243)
    Start at  05:05:31
    Duration  148.97s (transform 2.44s, setup 0ms, import 11.30s, tests 124.24s, environment 7ms)
  ```

- Evidence level: static review and synthetic canonical-output tests only. No authenticated GST
  run, portal capture, sensitive input observation, permission change or release-readiness claim.

### Cycle 16 — positive not-filed filename-fragment suppression

- Before: a valid complete not-filed summary retained `candidate-not-found`, no download
  diagnostics and the positive-not-filed signal, yet a filename token could append a second
  sentence claiming that Pack completed a download.
- Contract: filename metadata cannot override an explicit non-delivery result. The existing
  summary suppression recognizes the canonical `not-filed` key alongside legacy-unconfirmed and
  full-year no-artifacts keys. Status, flow state, periods, safe signals, recovery precedence and
  all confirmed-download filename sentences are unchanged.
- Failure evidence: all 6 direct/ZIP filename variants failed before the source change. Each
  persisted successfully, then reopened with the not-filed sentence followed by
  `Pack completed the download` and a filename caution. All 6 passed after the one-line fix;
  focused session/ledger coverage passed 192 tests.
- Clarity assessment: Impeccable's clarify guidance and Pack's design contract support removing
  contradictory copy rather than adding another explanation. This was a canonical text-output
  check, not a new visual-layout or browser-interaction qualification.
- Exact line counts:

  | File                                                      | Before | After |
  | --------------------------------------------------------- | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`                     |    661 |   662 |
  | `background/filed-returns-session-write-boundary.test.ts` |  1,438 | 1,469 |

- Review disposition: privacy CLEAN/PASS and security PASS on exact source head
  `96127043786637410a326c44fbd4b80e02d1f6a0`. No sensitive data, persisted field, scope,
  state, user action, completion/retry authority, cleanup, download API, background, permission,
  host or CSP behavior changed.
- Complete gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2249 passed (2249)
    Start at  05:12:41
    Duration  211.84s (transform 8.30s, setup 0ms, import 29.96s, tests 148.86s, environment 15ms)
  ```

- Evidence level: static review and synthetic persistence/reopen tests only. No authenticated GST
  run, portal capture, sensitive input observation, permission change or release-readiness claim.

### Cycle 17 — filename classifier reduction and equivalence

- Before: confirmed and unresolved filename helpers independently scanned the same two canonical
  signal families with the same precedence. The difference was exclusively their returned copy.
- Reduction: one helper owns the classifier and accepts explicit presentation context. No evidence
  decision moved into it. Target status, summary suppression and migration truthiness retain their
  previous call-site decisions; all four message strings are unchanged.
- Baseline proof: all 19 filename-focused tests passed before the refactor. Four additional ZIP
  variants pin neutral target-review copy, and two mixed-signal rows pin overridden-name precedence
  in both presentation contexts. Focused post-refactor coverage passed 198 tests.
- Discrimination proof: a temporary reversed-precedence mutation failed both mixed-signal rows.
  The downloaded row received the unavailable-name completion warning instead of the different-name
  warning; the unresolved row received the unavailable-name caution instead of the explicit
  ownership disclaimer. Exact restoration passed both.
- Exact line counts:

  | File                                         | Before | After |
  | -------------------------------------------- | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`        |    662 |   645 |
  | `background/full-fiscal-year-ledger.test.ts` |  1,274 | 1,306 |

- Deletion safety: only a duplicate local helper was removed; no module or import was deleted.
  The production-import scan included source modules, `wxt.config.ts`, HTML script roots and WXT
  background/content roots. It reached a fixed point immediately: 177 source modules, zero
  zero-importer candidates.
- Review disposition: privacy CLEAN/PASS and security PASS on exact source head
  `ab82c8a9c09f27e7bca2062f6a0943ff42ca8995`. No sensitive data, storage, target binding,
  status/state, recovery, completion/retry authority, download API or MV3 behavior changed.
- Complete gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. Full Vitest exact final three lines:

  ```text
       Tests  2255 passed (2255)
    Start at  05:21:58
    Duration  169.84s (transform 3.74s, setup 0ms, import 18.09s, tests 133.72s, environment 9ms)
  ```

- Evidence level: static equivalence review, source-import scan and synthetic canonical-output
  tests. No authenticated GST run, portal capture, sensitive input observation, permission change
  or release-readiness claim.
- Process limitation: rounds 15–17 were short, fully gated checkpoints, not the requested
  45–75-minute cadence. Actual times are retained in `PROGRESS.md`; the next audit is deliberately
  deeper and end-to-end rather than relabelling elapsed time.

### Cycle 18 — exact historical cache admission and evidence-qualified filename copy

- Before: Cycle 15 correctly narrowed unresolved target copy but left the exact cached-message
  validator rejecting its former derived sentence. `readLedger` returned null; current-state
  recovery could disappear and local clearing could bypass its unresolved-ledger refusal when no
  independent guard existed. These are measured synthetic storage outcomes, not a live incident.
- Contract: admit only the exact former canonical base plus the exact former filename fragment,
  when the canonical filename family is present. No trimming, substring matching, arbitrary prose,
  schema version, persisted field or write-on-read migration was added. Identity, scope, canonical
  plan, timestamp, signal, diagnostic and positive-status checks remain in their existing order.
  The stored cache stays untouched; current readers reconstruct outward messages.
- Second boundary: after ledger admission was repaired, canonical session persistence/reopen could
  add completion wording again. The final presentation context follows the canonical message key.
  Existing complete and confirmed-cleanup keys retain their filename caution. A partial key gets
  that form only for single-period scope with the existing confirmed ZIP evidence predicate;
  partial status, missing-artifact reasons and user actions remain partial and unchanged. Explicit
  not-filed/no-artifacts/unconfirmed-completion suppression remains intact.
- Review rounds and dispositions:
  - Privacy's non-blocked aggregate finding was fixed and measured: the first blocked-only policy
    failed 18 partial/running/cancelled rows. All 24 non-complete aggregate/filename combinations
    now survive ledger read, re-summary, canonical persistence and reopen without a completion
    filename claim.
  - Security's partial-key finding was fixed and measured: the marker-only historical partial ZIP
    fixture was not final browser proof. It remains a neutral negative control, with a separate
    confirmed tuple control. Missing ZIP/ID/completion/non-empty evidence, multiple IDs and
    contradictory evidence are neutral; scope/key controls prevent borrowing that exception.
  - Security's test-quality finding was corrected: the legacy complete-ledger test proves legacy
    plan rejection only. Six additional canonical-plan controls show read admission followed by
    session-summary consistency rejection. This is not general ledger coherence approval.
- Final mutation discrimination:

  | Temporary mutation                               |            Selected failures | Observed failure                                                                                                               |
  | ------------------------------------------------ | ---------------------------: | ------------------------------------------------------------------------------------------------------------------------------ |
  | Remove exact old composed-cache admission        |                           34 | `expected null not to be null`; current state null; clear returned `{ ok: true, cleared: true }` instead of unresolved refusal |
  | Always use completion-form summary filename copy | 62, with 12 controls passing | Reopened unresolved/partial copy contained `Pack completed the download` instead of the neutral caution                        |
  | Always use neutral summary filename copy         | 12, with 30 controls passing | Confirmed direct/ZIP, evidenced partial ZIP and delivered-cleanup copy lost its exact completion-form caution                  |

  The restored source matched blob `772fcdfd760adf3b16cfec512228f4a26d069cf8` and the committed
  source exactly. Restored focused coverage passed 4 files / 382 tests; the final session-only
  restoration check passed 182 tests. Guard negatives additionally pin wrong identities/scopes,
  invalid signal families, cache near-matches, diagnostics, manual observation and stale retries.

- History check: commit `e72438b` introduced distinct blocked/failed keys before `94b45dc` added
  filename fragments. The combination of an obsolete generic base plus a new suffix therefore
  was not invented as an accepted blocked/failed cache. Nine earlier source snapshots each matched
  1,944 cache-level combinations against the current exact reader. That in-memory check used
  current imported dependencies and does not prove old builds, full ledger validity or runtime
  reachability of every generated combination.
- Exact line counts:

  | File                                                         | Before | After |
  | ------------------------------------------------------------ | -----: | ----: |
  | `gst/filed-returns-durable-status.ts`                        |    645 |   656 |
  | `background/filed-returns-full-fiscal-year-recovery.test.ts` |  1,665 | 2,181 |
  | `background/filed-returns-session-write-boundary.test.ts`    |  1,469 | 1,681 |
  | `background/local-data.test.ts`                              |  1,334 | 1,442 |

  No module or import edge changed. Production grew by 11 lines; this is not counted as reduction.

- Review binding: privacy CLEAN/PASS and security PASS on
  `fbfb8964aeb27a8232f1f9cf0fd46894eb00ed6c`, with the aggregate-consistency limitation explicitly
  excluded. No new storage fields, source permissions, hosts, CSP, dependency, portal action,
  completion/retry authority or evidence predicate was introduced.
- Complete gate: build and package verification passed at 1.01 MB; TypeScript, zero-warning ESLint
  and repo-wide Prettier passed. The earlier full-suite invocation was deliberately cancelled after
  a review finding and is not a pass. The final full suite passed 125 files. Exact final three lines:

  ```text
        Tests  2364 passed (2364)
     Start at  05:52:21
     Duration  159.46s (transform 2.87s, setup 0ms, import 14.26s, tests 130.41s, environment 7ms)
  ```

- Workflow preflight was rechecked during the dirty edit and refused it as designed. The five
  changed files were all inspected and lane-owned; that result is not a preflight pass. No PR,
  hosted review, release or live authenticated run was attempted.
- Next audit: classify the existing aggregate/target consistency difference across producer and
  reader boundaries before choosing a recovery-safe repair. Running/cancelled session summaries'
  generic recovery base copy is also pre-existing and unchanged here. These remain explicit
  follow-ups, not evidence that the filename fix established general recovery correctness.
- Read-only producer sizing found no inspected current transition that creates the aggregate
  inconsistency from coherent state. Completion derives from terminal targets; restaging, retry
  and reconciliation update aggregate state alongside targets. Existing inconsistent input can
  propagate, so boundary hardening remains useful, but no normal-workflow corruption incident is
  established. Historical versions and arbitrary concurrent execution were not qualified.
- Packaged visual check: the Playwright CLI was unavailable; the interactive workflow used the
  repo's already-installed browser library, with no dependency installation. A fresh isolated
  profile loaded the real built panel, stubbed runtime responses before load and blocked all page
  network traffic. No GST page was opened and no network requests were observed by the route
  monitor. These are synthetic UI observations, not service-worker restart or portal qualification.

  | 320×900 fixture                              | Caution height | Panel shell height | Document width | Clipped regions |
  | -------------------------------------------- | -------------: | -----------------: | -------------: | --------------: |
  | Previous override sentence on current bundle |       117.58px |         1,506.20px |          320px |               0 |
  | Current override caution                     |       134.38px |         1,522.99px |          320px |               0 |
  | Current unavailable-name caution             |       100.78px |         1,489.40px |          320px |               0 |
  | Current override, twelve-period fixture      |       134.38px |         1,789.14px |          320px |               0 |

  The longer caution adds 16.80px, one line at the rendered font metrics. Screenshots of the initial
  viewport and scrolled recovery region were inspected in-session; no image/profile artifact is
  committed. Early background-tab captures were unsettled and excluded; foreground recaptures
  after paint matched the DOM bounds. The surface still scrolls, and the caution is below the
  initial viewport: this is a readability/no-clipping check, not density or above-the-fold approval.
  Saved-run options, Details and the catalogue completed keyboard open/close cycles. Irreversible
  recovery controls, native-window layout, zoom and assistive technology were not qualified. The
  isolated browser was closed and its task-generated profile removed; no source file changed.

- New measured follow-up: the dense fixture's pack card counted all twelve unfinished periods as
  needing review, while the detailed evidence counted one needing review and eleven waiting. This
  visible contradiction moves the next duplicate-fact audit to summary-count derivation. It is not
  a filename-copy regression or a claim that the wider panel is fully audited.

## Cycle 19: remove the duplicate outcome aggregate

- Decision: the card owns selected-pack/delivery metadata; the existing per-period evidence owns
  outcome counts. Its only production consumer renders both. Removing the card's
  `totalPeriods - completedPeriods` interpretation avoids labeling waiting/running periods as
  review and avoids relabeling completed-but-not-filed periods as ready. No replacement counter,
  abstraction, status branch, persisted field, action or capability claim was introduced.
- Scope: `PanelSurface`, `TargetEvidence`, delivery predicates and recovery controls were not
  edited. Their intentional distinction between selected scope and retained recovery scope stays
  intact. The change does not claim their remaining behavior is universally correct.
- Fifteen new whole-panel cases pin the observable composition. Missing and empty evidence do not
  become zero-review or saved claims; canonical outcome rows remain distinct. Single-period
  cleanup keeps its warning and enabled local-only retry with and without target evidence. The
  fixture uses the catalogue-supported GSTR-2B multi-format selection after browser review caught
  the original unsupported combination. `All formats` is explicitly asserted.
- Fixture limits: the seven-outcome table is a renderer taxonomy, not a captured producer snapshot.
  The static scope-mismatch test supplies controller fields directly. A separate packaged-browser
  check exercised the real controller with a synthetic retained-recovery payload and ordinary
  select input; no backend recovery action was attempted.
- Mutation evidence against the initial fifteen-case renderer matrix:

  | Temporary mutation                 | Failures | Discriminating observation                                                                          |
  | ---------------------------------- | -------: | --------------------------------------------------------------------------------------------------- |
  | Restore exact original card source | 12 of 15 | Review-count array contained both `12 needs review` and `1 needs review` instead of only the latter |
  | Restore only numeric ready copy    | 15 of 15 | Rendered panel unexpectedly matched the numeric `ready` pattern                                     |

  Three original-source controls passed because complete or unmatched-scope summaries already
  suppressed that suffix. Both mutations were removed; source hash returned to
  `b9dfaa913860da1391bbe3e6c905965902bd13e1`. Four focused files then passed 53 tests.

- Line accounting: `popup/pack-summary.tsx` 116→110; `popup/pack-summary.test.tsx` 319→320;
  `panel/panel-evidence-counts.test.tsx` 0→236. The six-line production reduction includes the
  formatter's collapse of the remaining JSX. No source module or import edge changed.
- Read-only graph scan: TypeScript AST/module resolution found 177 source modules and 778 edges;
  WXT/config/background/content/HTML roots reached every module. Zero zero-importer candidates,
  zero unresolved local specifiers and zero nonliteral dynamic imports; one pass was the fixed
  point. The scan includes type edges and does not establish every export's runtime use.
- Source-checkpoint gate passed: build, TypeScript, ESLint with zero warnings, repo-wide Prettier, package
  verifier and diff checks. The first full invocation passed tests but failed its later formatter
  check, so it is not counted as a complete gate. The corrected final package remained 1.01 MB;
  126 files passed before the three later producer-backed tests. Known synthetic workflow/review-gate
  stderr and the TypeScript source-map warning remained non-failing. Exact final three lines of that run:

  ```text
        Tests  2379 passed (2379)
     Start at  06:21:59
     Duration  151.66s (transform 2.50s, setup 0ms, import 11.27s, tests 126.04s, environment 8ms)
  ```

- Privacy PASS binds the final production blob above. Independent UX and module/security reviews
  found no blocking issue; the final formatter-only delta changed no semantics. Source checkpoint:
  `7a012e28560734721429948b444c533c7eeb6cd3`.
- Browser method: existing Playwright library, actual packaged panel, fresh task-owned profile,
  synthetic runtime responses and blocked page network traffic. No dependency, server, real
  account, portal page or live download was used. The baseline was the preceding built card, not
  a simulated DOM replacement. An initial incorrectly spelled period fixture was discarded before
  either recorded comparison. The corrected before/after fixtures were identical.

  | Fixture / viewport                       | Card height | Panel shell height | Document width | Clipped regions |
  | ---------------------------------------- | ----------: | -----------------: | -------------: | --------------: |
  | Dense, original card, 320×900            |    124.27px |         1,286.21px |          320px |               0 |
  | Dense, reduced card, 320×900             |    109.43px |         1,271.37px |          320px |               0 |
  | Running, 320×900                         |    109.43px |           764.99px |          320px |               0 |
  | Cancelled, 320×900                       |    109.43px |         1,244.56px |          320px |               0 |
  | Evidence omitted, 320×900                |    109.43px |           933.83px |          320px |               0 |
  | Supported single-period cleanup, 320×900 |    109.43px |         1,408.38px |          320px |               0 |
  | Dense, reduced card, 400×900             |    109.43px |         1,210.57px |          400px |               0 |

  The dense card loses exactly one 14.84px line, not a control: five operable controls before and
  after. Returning from 400px to 320px restored the measured 320px bounds. Foreground screenshots
  were inspected; the evidence and relevant warning remained readable. Long recovery/guide pages
  still scroll, so this is not approval of every state's density or above-the-fold actions.

- Normal-input checks: return selection changed and restored while the retained recovery evidence
  stayed at one review/eleven waiting. Saved-run and catalogue disclosures opened and closed by
  keyboard. The evidence accessibility snapshot contained one review count and all twelve named
  rows; this is not a screen-reader test. Tabbing reached Continue, catalogue, Details and the
  existing retry/select controls with visible focus; focus leaving the page for browser chrome was
  not treated as a trap. No action message beyond `PACK_GET_*` was sent by these checks, and the
  route monitor observed zero page network requests. Native Chrome side-panel resizing, zoom,
  assistive technology, live portal execution and recovery action effects remain unqualified.
- Follow-up regression probe: current factory/canonical-status helpers built synthetic ledgers
  for delivered, no-artifacts and legacy cleanup. Each passed the actual ledger validator and
  completion eligibility check. The actual summary producer returned blocked, 12/12 completed,
  no current period and no recovery target. The packaged panel had zero inline-status regions and
  zero recovery-details regions, with Continue as its initial button. The old numeric suffix was
  also absent because the unfinished count was zero. This separately reachable presentation gap
  is not repaired or approved by Cycle 19; source/runtime provenance beyond the synthetic
  producer boundary remains unqualified. It is the next bounded audit.
- The follow-up's old/current card render comparison covered all three cleanup phases with
  present, empty and omitted target evidence. All nine HTML results were identical and none had
  the old numeric review suffix. This isolates the pre-existing gap from the removed calculation;
  it does not certify the rest of the recovery workflow.
- Producer-backed count proof was added in `panel/panel-ledger-evidence-counts.test.tsx` (0→77
  lines): factory-created canonical ledgers, canonical target status text/signals, actual ledger
  validation, real summary derivation and full panel render. The three states are blocked first
  period, blocked after two not-filed periods and an active target after the current stale cutoff.
  Each asserts one review, the exact waiting/not-filed row counts, zero saved files and no numeric
  readiness/delivery claim. Restoring the old card failed all three: the extra review count was
  twelve or ten rather than one. The combined eighteen-case run failed fifteen and retained three
  negative controls; after source restoration all eighteen passed. This is synthetic producer-to-UI
  proof, not an authenticated workflow or service-worker termination test.
- A separate in-memory card comparison used the old source at `13f6269` and current source with
  current dependencies. Axes: nine catalogue-supported return/format pairs, two scope kinds, five
  aggregate statuses, three completed-period counts, four optional/explicit totals and eight signal
  sets. Of 8,640 renderer inputs, 2,880 changed only by the intended suffix and zero had any other
  HTML difference. Some combinations deliberately violate runtime invariants; this comparison
  certifies only the narrow render delta, not validity or correctness of those inputs.
- The browser session and its exact task-generated profile were closed and removed. Ten synthetic
  panel pages had produced only `PACK_GET_*` messages, with no action message and no observed page
  network request. No screenshot or profile artifact is committed.
- Final producer-backed gate: build, full Vitest, TypeScript, zero-warning ESLint, repo-wide
  Prettier, package verification and diff checks all passed after adding the three ledger-derived
  cases. Package size remains 1.01 MB; final count is 127 files and 2,382 tests. The three added
  tests were independently privacy-reviewed at blob `9d06ea5a6c6e96afddde9e307883ec95bbbd2642`;
  source remains unchanged from `7a012e2`. Exact final three Vitest lines:

  ```text
        Tests  2382 passed (2382)
     Start at  06:31:15
     Duration  166.70s (transform 4.02s, setup 0ms, import 16.74s, tests 130.86s, environment 10ms)
  ```

  Test-only checkpoint: `979b02c17f710d48ef646fc877bbaf9f63166bb1`.

## Cycle 20 — keep full-year recovery authoritative across readers

- Started 2026-08-26 at 06:57 IST, after the preceding cycle's clean checkpoint and workflow
  preflight. This is one recovery-consistency change spanning seven background modules, not a
  change to portal behavior. Independent privacy and security reviews completed three rounds.
- Canonical target state now takes precedence when it disagrees with a completed aggregate.
  Summary reconstruction returns a blocked read-only view; it preserves ledger identity, revision,
  timestamps and targets and omits `completedAt`. The original local ledger is not rewritten by
  reads or refused Start/Clear operations. Existing active-run and target-review precedence remains.
- A shared predicate uses the existing positive-target set. It is deliberately not the negation
  of completion eligibility: plan validity, empty plans and ZIP delivery retain separate guards.
  A false result from this predicate is not proof of completion or permission to clear data.
- Start checks the existing recovery before reconciliation or cleanup; current-state reads prefer
  it to competing summaries; Clear preserves unresolved state. Explicitly validated recovery still
  uses the existing ledger/target/revision checks. The pending route retains account confirmation,
  and interrupted-running retry remains refused. No guard was relaxed.
- Message and recovery selection now share one helper. Unconfirmed-download priority is retained;
  interruption selects a running target only for the corresponding action-required step. A copied
  historical diagnostic does not change generic recovery selection. Ordinary current-target
  preference remains. The running retry refusal keeps its staging/checkpoint reason and discard
  instruction without naming a period that may differ from the returned canonical recovery.
- Persistence eligibility changes: the existing blocked summary can now survive the canonical
  session serializer where the contradictory completed projection was rejected. This is not
  persistence-neutral. No field, data category, storage key, serializer rule, allowlist or write
  path was added. Display-only target evidence remains excluded from storage. Historical tests
  separately assert blocked reconstruction and rejection of a forced contradictory completion.
- Evidence boundary: all inputs are synthetic factory-built ledgers accepted by the actual
  validator, with canonical target signals and messages. This establishes reader behavior, not
  that a normal workflow produces the inconsistent input. The initial unit/stubbed-reader checks
  did not exercise actual browser storage, portal, download, authenticated session or service-worker
  termination. The later isolated-browser check is distinguished below. Legacy no-plan completed
  records and empty plans are not claimed to be accepted by the validator.

### Regression and discrimination evidence

- Initial corrected baseline: four new files, 106 cases, 90 failures and 16 passing controls.
  The reader matrix's first draft contained an invalid single-period competitor; it was corrected
  before the recorded baseline (28 failures / 6 passes). Six existing historical assertions also
  required adjustment from rejected completion to the new blocked projection; their separate
  forced-completion rejection assertion was retained. No failed blocking assertion was weakened.
- Review added mixed-target, current-preference, copied-diagnostic and actual recovery-handler
  cases. Final focused matrix: 121 passing cases in four files; TypeScript also passed. Positive
  controls cover settled targets, ordinary noncomplete aggregates, active/target-review precedence,
  validated pending retry, and unchanged ledger/target/revision/running rejection guards.
- Independent review caught and closed three target-alignment cases before checkpoint. The actual
  retry handler refuses interrupted recovery without writes; the actual manual-observation handler
  changes only the named target. These use isolated storage and staging stubs, not browser actions.

  | Reverted behavior            | Failed / selected | Discriminating result                                                         |
  | ---------------------------- | ----------------: | ----------------------------------------------------------------------------- |
  | Clear preservation           |             7 / 7 | Expected refused response; received `cleared: true`; original ledger absent   |
  | Current-state priority       |           14 / 21 | Expected recovery summary; competing summary had no recovery identity         |
  | Early Start ordering         |            7 / 14 | Expected revision 7; received revision 8 after an unwanted checkpoint         |
  | Existing-ledger priority     |             7 / 7 | Unexpected `full-fiscal-year-retained-staging-scope-conflict`                 |
  | Nonterminal projection       |           14 / 14 | `expected 'complete' to be 'blocked'`                                         |
  | Pending confirmation         |             1 / 7 | `expected false to be true`                                                   |
  | Shared cause selection       |             4 / 4 | Expected the target's recovery cause; received the positive-result cause      |
  | Shared recovery identity     |            9 / 12 | Period mismatch; retry unexpectedly accepted; manual observation not recorded |
  | Current interruption context |             2 / 2 | `expected 'April' to be 'May'`                                                |
  | Period-neutral refusal       |             1 / 1 | Refusal named a period different from its returned recovery identity          |

  Each mutation was restored. The shared-cause mutation's first attempt was invalidated because
  its process had not completed before restoration; the recorded rerun waited for exit and failed
  all four selected cases. Initial mixed-target failures are not counted again as additional tests.
  Final reviewed blobs are `be0ef54f8785550c4da14ec1ce9e14de66bb0f88` (summary) and
  `9ab7cea9b27405fea9cd896820341ddb2ff4e8d9` (retry refusal). Both independent reviewers reported
  no remaining findings against these blobs; this is source review, not release qualification.

### Scope and line accounting

| File under `src/background`                   | Before | After |
| --------------------------------------------- | -----: | ----: |
| `filed-returns-current-state.ts`              |    148 |   152 |
| `filed-returns-full-fiscal-year-ledger.ts`    |    432 |   442 |
| `filed-returns-full-fiscal-year-run-state.ts` |    245 |   241 |
| `filed-returns-full-fiscal-year-summary.ts`   |    585 |   609 |
| `filed-returns-full-fiscal-year-recovery.ts`  |    439 |   439 |
| `filed-returns-full-fiscal-year.ts`           |    558 |   563 |
| `local-data.ts`                               |    144 |   146 |

- Production total: 2,551→2,592 lines, a net addition of 41. This correctness change is not a net
  code reduction. The obsolete aggregate-coercion helper was deleted after its responsibility moved
  to the canonical read-only view. No source module or import edge was removed.
- New test/helper lines: fixtures 93, readers 268, Start 308, summary 270, panel 104; total 1,043.
  The existing historical recovery test changed from 2,181 to 2,183 lines, without adding cases.
- Read-only TypeScript AST scan: 177 source modules, 778 import edges, six WXT/HTML roots, zero
  zero-importer candidates, zero unreachable modules, zero unresolved local imports and zero
  nonliteral dynamic imports. The fixed point was reached in one pass. Type-import reachability
  does not prove runtime use of every export. No Graphify index exists in this lane.

### Packaged 320px check

The actual packaged panel consumed old/current summary producers using identical canonical
synthetic ledgers. The old producer came from `c88b51a`; UI assets were unchanged. This compares
producer effects through the real controller/render path, not old/new production browser sessions.
The fresh task-owned browser profile blocked page network requests and stubbed runtime responses.
All fixtures used no detected portal context (`context: null`), not a live sign-in assessment;
no recovery or download action was executed.

| Target status        | Baseline shell | Current shell | Operable controls, before→after |
| -------------------- | -------------: | ------------: | ------------------------------: |
| Pending              |     1,576.81px |    1,765.91px |                             6→6 |
| Running              |     1,576.81px |    1,640.33px |                             6→6 |
| Download unconfirmed |     1,637.61px |    1,717.92px |                             7→7 |
| Blocked              |     1,576.81px |    1,673.92px |                             6→6 |
| Failed               |     1,576.81px |    1,673.92px |                             6→6 |
| Cancelled            |     1,576.81px |    1,657.13px |                             6→6 |
| Manually observed    |     1,576.81px |    1,690.72px |                             6→6 |

- All seven headings changed from `Periods processed, ZIP unconfirmed` to the named paused-period
  warning. Across all seven fixtures, inline height increased 108.06→188.38px, and an existing disabled inline retry became
  visible (disabled controls 2→3). The pack card stayed 109.41px. This is a visibility correction,
  not a density reduction or satisfaction of the default three-to-four-control budget.
- The mixed-target page named April consistently and measured 1,734.11px. Fifteen pages had 320px
  document width and zero measured horizontal clipping. The blocked page at 400px measured
  1,595.34px; restoring 320px restored 1,673.92px. The saved-run disclosure closed and reopened by
  keyboard. Screenshot inspection found the warning, evidence and controls readable.
- Long recovery pages still scroll, and the initial inline copy still uses a generic recovery
  remedy while the detailed cause appears below. No native side-panel resize, zoom, screen reader,
  live action, worker restart or authenticated behavior is qualified by this check.
- Full source/test gate passed: build, full Vitest, TypeScript, zero-warning ESLint, repo-wide
  Prettier, package verification and diff checks. Final suite: 131 files, 2,503 tests, 121 more than
  Cycle 19. Package remains 1.01 MB. Known synthetic workflow/review-test stderr and the TypeScript
  source-map warning were non-failing. Exact final three Vitest lines:

  ```text
        Tests  2503 passed (2503)
     Start at  07:17:11
     Duration  208.88s (transform 8.89s, setup 0ms, import 28.55s, tests 151.82s, environment 14ms)
  ```

- Checkpoints: `166cb6d fix(recovery): preserve unresolved full-year state across readers` and
  `5f28c76 test(recovery): trace full-year recovery through readers and actions`.
  The browser was closed and its exact task-generated 14 MB profile removed. Across fifteen
  synthetic pages there were zero action messages and zero observed page network requests.
  Generated extension output remains only for subsequent cycle verification, not in git.
- Additional read-only sweep: 6,480 factory-built inputs varied two target statuses, aggregate
  status, current-target position, a historical diagnostic and recency. All passed the ledger
  validator. Checked source immutability, recovery identity/status/revision, nonterminal projection,
  named unconfirmed/interruption identity and persisted recovery/display-evidence boundaries.
  The old producer had 1,232 nonterminal-projection, 500 unconfirmed-identity and 10 interruption-
  identity violations. The current producer had none of those checked violations. Counts overlap
  and are not additional tests, normal-workflow coverage or performance measurements.
- The initial persistence comparator used JSON property order and reported false differences;
  the recorded sweep uses structural equality. The canonical summary parser rejected 1,280 old
  projections versus 48 current projections. The remaining 48 are all-positive legacy cleanup
  combinations, outside this target-disagreement repair; they are not counted as success or fixed.
  Their source/reader behavior remains a separate cleanup follow-up. The original ledger validator
  and summary serializer were not modified to make these generated combinations pass.

### Additional isolated-browser runtime check

- A second fresh profile loaded the same gated package without runtime-message stubs. A generated
  canonical ledger was seeded only in that profile. The real summary message handler returned
  blocked recovery, the expected period, the existing recovery identity/revision and twelve
  display-evidence rows; the stored source ledger remained structurally identical.
- Closing and relaunching that entire isolated browser with the same profile created a new worker
  object. The actual message handler reconstructed the structurally identical summary, and the
  panel again displayed the named paused-period warning. The local ledger remained unchanged.
  This is synthetic browser-restart reconstruction, not an authenticated run or a test that kills
  only the service worker at a specific in-flight checkpoint.
- The actual Options-page Clear button was then clicked once for each of the seven unresolved
  synthetic target statuses, reloading the page between cases. All seven displayed the specific
  unresolved-recovery refusal; each stored ledger remained structurally equal to its input.
  These are real UI inputs against the isolated package, distinct from the fifteen stubbed
  pages' zero-action check. No download, portal, retry, observation or discard action was used.
- Page network blocking was enabled before the restart and subsequent Clear checks; it observed
  zero requests in that interval. It is not a browser-wide network audit. The Options refusal
  screenshot was inspected at 320px. The browser was closed and its exact 9.7 MB profile removed.
- This adds runtime evidence for reconstruction and refused Clear only. It does not validate
  live account identity, portal navigation, staging bytes, download correlation or recovery effects.
- Cycle closed at 07:42 IST, 45 minutes after its 06:57 start. The reviewed evidence checkpoint was
  `3417003`; its final interval included a disclosed cadence pause and read-only next-cycle scoping.
  No additional implementation, gate run or live evidence is attributed to that pause.

## Cycle 21 — cleanup-only saved-run warnings

- Started 2026-08-26 07:42 IST. This cycle applies Impeccable's clarify guidance to an absent
  status message, not a redesign or a new recovery workflow. Canonical cleanup ledgers have no
  current target. The old panel displayed their delivery evidence and guide, but no inline warning.
- Three validator-accepted fixtures use the real cleanup checkpoint builder and summary producer:
  downloaded cleanup, no-artifacts cleanup and legacy cleanup. At 320px with no detected portal
  context, baseline shell heights were respectively 1,152.59, 1,152.59 and 1,170.78px. Each had four
  controls, no disabled controls and no inline button. These are synthetic packaged pages, not
  live portal captures or evidence of the normal workflow origin of every fixture.
- The inline renderer now falls back to the summary's canonical reason after the existing
  ambiguous-ZIP and current-period branches. Its heading is `Saved run needs attention`, which
  does not promise another ZIP for a cleanup-only state. The canonical delivery evidence and
  specific current-period/overlay instructions are unchanged.
- The existing full-year inline action additionally requires a current period. This prevents
  malformed direct props from gaining a new button when the fallback makes their warning visible.
  The canonical parser already rejects that malformed recovery/period pairing; valid recovery
  identities continue to route to the same callback. No new action or target identity is created.
- Retained-scope conflict copy now tells the user to return to the saved selection and resolve
  it, without promising files, a final-ZIP retry or an available discard control. Its rejection,
  signals, action type, resumability and ledger identity/revision remain unchanged.
- Initial test construction incorrectly assumed every cleanup summary passed the durable parser:
  eight cases stopped at that assumption before checking visibility. Those failures are not
  counted as warning discrimination. The corrected matrix has eight whole-panel render cases,
  two explicit existing-parser boundary cases, four inline-action cases and four scope-copy cases.
  Corrected baseline: 14 failures and four passes across 18 new cases. With the fix and neighbouring
  regressions, 72 focused cases passed across five files. The first TypeScript check found missing
  response-union narrowing in the new scope-copy tests; explicit property checks corrected it.
- Each temporary production mutation was allowed to finish before restoring its source:

  | Mutation                                            | Focused failures | Observed discriminator                                                                           |
  | --------------------------------------------------- | ---------------: | ------------------------------------------------------------------------------------------------ |
  | Remove fallback warning                             |                8 | `expected undefined to be defined`                                                               |
  | Restore final-ZIP heading                           |                8 | warning did not contain `aria-label="Saved run needs attention"`                                 |
  | Remove current-period action guard                  |                2 | `expected { label: 'Retry this period', …(2) } to be null`                                       |
  | Restore both retained-scope copy branches           |                4 | expected retained-run wording; received prepared-files/final-ZIP or staged-files/discard wording |
  | Replace canonical reason with generic portal advice |                8 | warning did not contain the canonical summary paragraph                                          |

  Source hashes were identical before and after the mutation sequence: inline status `695cd4f`,
  presentation `a6845df`, run state `c6250cf`. No mutation was left in the working tree.

### Boundary and deliberately excluded follow-ups

- The producer emits cleanup-phase signals for downloaded and no-artifacts cleanup that the
  existing durable signal allowlist does not accept. The canonical summary parser rejects those
  summaries as `unknown`; legacy cleanup is accepted. The tests record this rather than removing
  signals or manufacturing a successful round-trip. Adding those persisted values is outside the
  no-widening boundary. Owner decision: authorize a separate allowlist/serializer review with
  reconstruction, redaction and lifecycle tests, or retain the present rejection. Risk: silently
  treating this UI fix as durable-summary qualification would overstate the evidence.
- Direct and parsed legacy messages differ because the parser reconstructs canonical copy. Each
  rendering assertion checks its actual input message; it does not claim those bodies are equal.
- Selection changes can still hide a cleanup-only summary, and the guide's existing cleanup start
  label can still refer to a final ZIP. Those are separate selection/action-label work, not fixed
  by the status-only fallback. No successful cleanup or retry is claimed in this cycle.
- The broader proposal to substitute every full-year body with the target's message was rejected:
  a retained running target can still carry active-checking wording, and the inline helper owns two
  specific overlay remedies. Removing it without tracing those contracts would lose information.
- No persistence schema, allowlist, stored field, authority, download evidence, portal navigation,
  manifest, dependency or release claim changed in this cycle. The primary checkout is untouched.

### Review extension and packaged evidence

- The fallback also affects export-pending states without a period. Ten additional cases use the
  actual export, intent and observing checkpoint builders, then test both direct and parsed
  summaries. Removing the fallback failed exactly four export cases (`expected '' to contain`
  the neutral warning label); moving it before ambiguity handling failed all six download-check
  cases, which expected `Check Browser Downloads` or `Check final ZIP status`. Both mutations
  finished before restoration; the three production hashes still matched the values above.
- The first full gate passed 134 files / 2,521 tests. A second complete gate is required after the
  ten-case review extension; the earlier pass is not represented as covering those added tests.
- Packaged browser matrix: three baseline pages and eight updated pages. Updated pages cover
  three direct cleanup states with both absent and unsupported portal contexts, plus accepted
  parsed legacy state in both contexts. These pages stub only runtime responses with synthetic
  producer output; they do not establish an authenticated portal context.

  | Direct cleanup state | Baseline shell at 320px | Updated shell at 320px |
  | -------------------- | ----------------------: | ---------------------: |
  | Downloaded           |              1,152.59px |             1,244.41px |
  | No artifacts         |              1,152.59px |             1,244.41px |
  | Legacy               |              1,170.78px |             1,262.59px |

  The new warning is 91.81px high. Both context variants have equal heights. Parsed legacy is
  906.97px because its canonical parser omits per-period display evidence; that is not a claimed
  density improvement. All eight updated pages retained four controls, zero disabled controls,
  zero inline buttons, their existing delivery text, and a 320px document width.

- Screenshot review covered the initial warning, delivery card, per-period evidence and parsed
  legacy state. The no-artifacts page measured 1,167.42px at 400px width; returning to 320px restored
  1,244.41px. The pages intentionally scroll; status is visible initially, while the later guide
  may remain below the fold. No native side-panel resize, browser zoom or screen reader is claimed.
- Normal click/keyboard input advanced the unchanged guide through all four steps and returned
  through Back to Step 1, without changing the scope or submitting the final action. The catalogue
  disclosure opened and closed using Enter. The warning remained visible at the same scope. The
  Step 4 screenshot confirmed the separate `Retry final ZIP` label and portal-foreground helper
  contradiction for no-artifacts cleanup; those are queued for the next bounded copy cycle.
- Across the eleven stubbed pages there were no action messages. Page-scoped network blocking
  observed zero requests. This is not a browser-wide network audit.
- The isolated browser was then restarted without response stubs. The real packaged background
  reconstructed each of the three generated cleanup ledgers as a structurally identical summary,
  with its warning visible and no inline button. Each stored ledger remained unchanged. Repeating
  all three after closing and relaunching the entire isolated browser created new worker objects
  and again preserved both summaries and source ledgers. No cleanup, retry or download action was
  submitted. These six real-handler checks are synthetic reconstruction evidence, not live portal,
  staging-byte, cleanup-effect or in-flight worker-termination qualification.
- In particular, reconstruction from the source ledger succeeded for the two phase summaries the
  durable-summary parser rejects. That does not turn their failed summary round-trip into a pass.
- Independent privacy and security reviews passed the three production blobs. Final review also
  checks the expanded precedence tests and this evidence record; no release readiness is claimed.
- Five further stubbed packaged pages covered export pending, export retry, download started,
  persisted intent and exact-ID observing. All preserved their producer body, had no inline button
  and no action message, and measured 320px document width. Their headings respectively remained
  the neutral warning, neutral warning, Browser Downloads check, Browser Downloads check and exact
  ZIP-status check. The first extra probe used a stale browser helper after restart and loaded no
  page; passing the current context explicitly corrected the harness before these measurements.
- The sixteen total stubbed pages and the separate six real-handler checks observed zero page
  network requests in their monitored contexts. The isolated browser was closed, and its exact
  task-generated 14 MB profile was removed. No downloaded file or user profile was involved.
- Line accounting: `inline-status.tsx` 342→350, `presentation-state.ts` 231→231, run-state
  241→239; production total 814→820 (+6). The three new test files contain 175, 131 and 90 lines
  (396 total), and one existing expected heading changed without adding/removing a test. This is
  a visibility/copy fix, not a net code reduction. No production module was added or removed.
- After the precedence extension, all 82 focused cases passed across five files, and the repeated
  full suite passed 134 files / 2,531 tests: 28 additional tests since Cycle 20, with none removed.
  Its exact last three lines are:

  ```text
        Tests  2531 passed (2531)
     Start at  07:59:17
     Duration  191.65s (transform 4.93s, setup 0ms, import 23.98s, tests 140.95s, environment 12ms)
  ```

  The same known synthetic workflow/review stderr and TypeScript source-map warning were
  non-failing. The production package remains 1.01 MB. No authenticated or release gate is claimed.

- The repeated build, full suite, TypeScript, zero-warning ESLint, repo-wide Prettier, package
  verifier and diff check all passed. Source checkpoint: `dc9dbb4`; test checkpoint: `e0cabc0`.
  Independent final privacy review reconciled the new test counts, line counts and evidence
  boundaries with no actionable finding. The three rounds were fixture/baseline correction,
  independent source review, and expanded precedence/runtime/evidence review.
- Next-cycle priority changed on observed evidence: cleanup action/helper/busy wording now comes
  before unused-wrapper deletion. The background trace supports the local-cleanup intent for a
  matching, unchanged ledger, but a stale summary is not execution authority. Do not promise zero
  downloads-API calls or unconditional cleanup-only execution from UI signals. Selection retention
  and the two summary-parser rejections remain separately bounded.

### Short-window follow-up within Cycle 21

- At 08:07 IST, an additional 320×600 reduced-motion check falsified the broader initial-view
  assumption. The unchanged guide autofocus scrolled downloaded/no-artifacts cleanup to 496px and
  legacy cleanup to 514px on opening. Their warning rectangles were entirely above the viewport.
  The earlier 320×900 measurements are valid, but do not qualify shorter initial views.
- Impeccable's hardening guidance therefore extended this same visibility cycle before closure.
  The guide now focuses a field only after the existing Continue/Back action requests it. It does
  not steal initial focus. The request is consumed before focusing; normal and StrictMode mounts
  retain existing focus, while forward navigation and Back to the first field still focus normally.
- Rejected `preventScroll` alone because it would leave focus in an offscreen field; rejected a
  blanket step-zero exclusion because Back to the first step must still focus it. No guide step,
  selection, enabled/disabled rule, control, callback or background action changed.
- The revised ten-case interaction file failed three cases before the fix. Removing the new mount
  guard after the fix failed both normal/StrictMode cases with expected existing button, received
  select. Removing the user-request assignment failed six navigation/focus cases, including Back.
  The source was restored to blob `d92b301` after both mutations. JSDOM proves focus behavior, not
  scrolling; the real browser must separately establish viewport visibility.
- Independent UI review approved the request-ref approach and confirmed there are no other move
  callers or ordinary no-op navigation paths. The earlier 2,531-test gate predates this follow-up;
  a fresh full gate and short-window remeasurement are required before its checkpoint.
- After rebuilding, all three 320×600 pages opened at scroll position 0 with body focus. Each
  warning was fully visible from y=120.80px to y=212.61px. Shell heights, evidence and four-control
  counts were unchanged. There were no duplicate IDs or broken labelled/described-by references.
- Native keyboard input then moved from the body to the guide field with Tab (deliberately
  scrolling it into view), to Continue with another Tab, and to the financial-year field with
  Enter. Tab then Enter on Back returned focus to the first field. No action message was sent.
  Initial and post-navigation screenshots were inspected separately; this is not screen-reader
  qualification. Existing warning colors yielded calculated contrast ratios of 15.28 for the
  heading and 5.72 for body text against the warning background; no color or font rule changed.
- This adds six stubbed pages, three before and three after the focus fix, to the earlier matrix.
  They observed zero page network requests. Their separate 14 MB profile was closed and removed.
  Final source review passed exact guide blob `d92b301` and interaction-test blob `668f636`.
  Guide lines are 218→223; interaction tests 254→280, with two new cases and none removed.
- Post-focus focused gate: 92 tests across six files. The third full Cycle 21 suite passed 134
  files / 2,533 tests, now 30 new tests since Cycle 20. Its exact final three lines are:

  ```text
        Tests  2533 passed (2533)
     Start at  08:09:44
     Duration  175.33s (transform 4.49s, setup 0ms, import 17.36s, tests 138.82s, environment 9ms)
  ```

  The four production files total 1,032→1,043 lines (+11). This supersedes the three-file +6
  subtotal, not the earlier per-file measurements. Existing scope/action guards remain unchanged.

- The post-focus build, full suite, TypeScript, zero-warning ESLint, repo-wide Prettier, package
  verifier and diff check passed. Focus source checkpoint: `07b34d5`; tests: `517fb4c`. UI and
  privacy reviewers approved the exact source/test blobs and the qualified evidence record.
- Intentional keyboard tradeoff: entering the first field now takes one explicit Tab instead of
  receiving automatic focus on open. Mouse click count and guide navigation are unchanged. This
  preserves the warning and existing focus position before the user chooses to enter the guide.

# Cycle 22 — cleanup action and pending copy (2026-08-26 08:27 IST)

- Ownership added after rechecking the lane registry (no other lane files): popup
  `flow-summary.ts`, `components.tsx`, `scope-action-panel.tsx`, and new cleanup-action tests in
  `tests/panel` and `tests/popup` plus their synthetic fixture helper. Existing owned popup model,
  presentation and inline-status files remain in scope. Root owns production; the UI test agent
  owns only the three named new test/helper files. No other checkout is touched.
- Acceptance: cleanup intent is truthful in idle and pending UI; disabled states, callbacks,
  message payload, exact-ID/ambiguous precedence and separate delivery evidence remain unchanged.
  No persistence, portal behavior, eligibility, permission or dependency change is authorized.
- Pre-change measurements made during the preceding cycle's read-only scoping: three direct
  cleanup fixtures at guide step four all read “Retry final ZIP” and ask for foreground portal
  visibility. At 320px, shell heights are 1,317.77px for downloaded/no-artifacts and 1,335.95px for
  legacy cleanup; five whole-page controls, none disabled, no horizontal overflow. Three deferred
  synthetic Start responses all show “Packing your files”, portal instructions and 12/12 progress;
  heights are 801.84px / 801.84px / 820.03px, with the guide hidden. Each click sends exactly the
  existing Start message with the selected single-scope payload. No actual cleanup was executed.
- An independent 78-case model baseline covers 13 summary inputs, matched/mismatched scopes and
  three busy states; 55 cases are disabled. The first custom-loader attempt failed because it
  resolved only `.ts`; the successful baseline uses a TSX-aware resolver. Browser baseline has
  six pages and zero observed page-network requests. All deferred responses were resolved and the
  browser closed. These are synthetic observations, not authenticated or browser-wide evidence.
- Preflight passed before edits. Source baseline: flow-summary 146, scope-form-model 191,
  scope-action-panel 31, components 268, presentation-state 231 and inline-status 350 lines
  (1,217 total). Latest full baseline remains 134 files / 2,533 tests from Cycle 21.
- Decision: use the explicit retained cleanup marker only for copy. Exclude unresolved target
  metadata and ambiguous handoffs; preserve all existing authorization helpers. Pending copy says
  the saved run is being checked before retrying cleanup, not that cleanup has succeeded or that
  stale state cannot redirect/refuse execution. Legacy complete-with-retained-staging and summary
  parser allowlist gaps remain separate boundary items.

## Cycle 22 — implementation and discrimination

- Six presentation files changed. One shared cleanup-copy classifier consumes existing categorical
  signals; it is not an authorization predicate. Scope action copy uses the canonical scope
  matcher, replacing the identical private comparison. Disabled calculation, portal eligibility,
  external refusal precedence, callbacks and message payload are unchanged. The pending view keeps
  its existing presentation kind but does not display period progress as cleanup progress.
- The first 23 popup cases failed nine expected label assertions against unchanged source. After
  the action fix, the first panel baseline had eight expected pending-copy failures and one
  incorrect ordinary-download fixture: unsupported context selects ContextState, not InlineStatus.
  Correcting that fixture before changing pending presentation yielded eight failures / 39 passes
  across the final 47 new cases. No assertion was weakened to accommodate changed runtime behavior.
- The new tests cover four cleanup sources (three real checkpoint producers plus the accepted
  legacy parser result), actual React guide interaction, one unchanged Start callback/scope,
  deferred blocked response, unchanged delivery and period evidence, ordinary/export controls,
  scope mismatch, external refusal, unrelated busy states and contradictory recovery props.
  The two existing parser rejection cases remain explicit in the earlier status test.
- Focused verification passed 162 tests across nine files. The first TypeScript pass found three
  optional-property errors in test construction; explicit null/default handling and a checked
  canonical recovery fixture fixed them. TypeScript then passed. These are fixture corrections,
  not changes to production validation or stored data.
- The 2,340-case before/after matrix has zero changed disabled decisions (1,572 remain disabled).
  Exactly 32 labels change, all matching cleanup selections under idle or Start-busy state,
  including inputs normalized to the default PDF. The smaller 78-case baseline is a subset-style
  check, not additional independent coverage or a test-suite count.

Each mutation below ran serially against the 47 new cases, then was restored before the next one.
All twelve exited with failure. The six final source hashes exactly match the pre-mutation hashes.

| Mutation                                                        | Failed cases | Representative failure                                                   |
| --------------------------------------------------------------- | -----------: | ------------------------------------------------------------------------ |
| Bypass existing retry eligibility in copy classifier            |            3 | Expected `Downloading...`; received `Checking saved run`                 |
| Ignore current period                                           |            2 | Expected `Retry final ZIP`; received `Retry local cleanup`               |
| Ignore target recovery/review                                   |            3 | Expected `Retry final ZIP`; received `Retry local cleanup`               |
| Ignore ambiguous handoff                                        |            6 | Markup unexpectedly contains `Retry cleanup for this saved run.`         |
| Ignore explicit cleanup marker                                  |            4 | Expected `Retry final ZIP`; received `Retry local cleanup`               |
| Borrow copy despite external refusal                            |            1 | Markup unexpectedly contains `Retry cleanup for this saved run.`         |
| Restore period progress during cleanup check                    |            8 | Expected the progress element to be null; received an HTMLDivElement     |
| Replace canonical inline pending reason with portal instruction |            8 | Expected `Pack is checking the saved run before retrying local cleanup.` |
| Remove cleanup pending presentation                             |            8 | Expected `Checking saved run`; received `Packing your files`             |
| Restore standalone “Waiting for Chrome” pending reason          |            4 | Expected `Pack is checking the saved run before retrying local cleanup.` |
| Bypass scope matching for helper copy                           |            2 | Cross-scope markup unexpectedly contains cleanup instructions            |
| Bypass scope matching for action label                          |            2 | Cross-scope markup unexpectedly contains `Retry local cleanup`           |

- Independent privacy and security source reviews passed on the restored six-file snapshot.
  No live or release qualification is inferred from those reviews. The module audit reaches a
  fixed point immediately: 177 source modules, 777 unique internal edges, six WXT/HTML/config
  roots, no orphan or unreachable modules, no unresolved local code imports and no nonliteral
  dynamic imports. The config-to-manifest edge adds one external root edge. Type imports count;
  export-level liveness is not established. No production module was added or deleted.
- Line accounting: flow-summary 146→166, scope-form-model 191→188, scope-action-panel 31→33,
  components 268→272, presentation-state 231→246, inline-status 350→358; total 1,217→1,263 (+46).
  This is a truthful-state repair with one duplicate removed, not a net reduction. New tests/helper
  total 574 lines before any later gate-driven fixture correction. No historical tests removed.

### Cycle 22 — browser-review rectification scope

- Ownership adds `tests/background/full-year-no-export-reopen.test.tsx`; the already-claimed
  panel surface and full-year summary reader are included in this cycle's rectification.
  No other active lane claims these paths. The test was delegated and frozen for root's red run.
- Decision at 08:58 IST: retain the single truthful-cleanup improvement, including the actual
  reopen path that lost the existing no-export explanation. Independent security review confirmed
  this can restore an existing signal without a new field, signal value, allowlist or write-on-read.
  The signal has a cleanup-phase consumer, so this is not described as globally display-only.
  Require the exact cleaned-without-export phase plus nonempty, positively not-filed targets.
  Existing completion/ledger validation and ambiguous-delivery behavior remain unchanged.

- Independent Impeccable Assessment A found pending feedback above the visible 320×600 viewport
  after the guide unmounted: downloaded/no-artifacts y=-108.70 to -33.06; legacy -127.20 to -51.56.
  Focus fell to BODY. The status now receives focus only on the user-triggered false→true cleanup
  transition, not initial mount, using tabindex=-1. The neutral local-cleanup header removes the
  contradictory portal prerequisite while preserving signed-in/access-blocked precedence.
- Assessment A's rebuilt-browser recheck passes all three canonical states: pending status
  y=120.80 to 196.44, scrollY=0, focus on status, next Tab reaches Details. Initial idle mount
  remains on BODY and first Tab reaches the guide. No new sequential stop, overflow, duplicate ID
  or broken ARIA reference. Each flow emits one stubbed Start with unchanged scope; no recovery
  message. Initial busy mount is unit-tested, not browser-tested; screen-reader speech is untested.
- Before the focus/header follow-up, the three rebuilt 320px idle heights were 1,285.39 / 1,285.39 /
  1,303.58px, each 32.38px shorter than baseline; pending 781.45 / 781.45 / 799.64px, each 20.39px
  shorter. Idle retains five whole-page controls; pending has one (Details), no guide/progress.
  A fourth accepted legacy-parser case measured 947.95px idle / 444.02px pending and intentionally
  has no per-period evidence. These are stubbed presentation observations, not cleanup proof.
- The initial browser measurement helper referenced an obsolete message-counter name, then an
  undefined page binding. Both failed before Start; the failed page was closed and the corrected
  helper completed all four cases. Deferred responses were resolved and that browser closed.

### Cycle 22 — actual synthetic cleanup and reconstruction

- A separate fresh extension profile had only installation metadata, no downloads or remote tabs.
  Seeded one canonical no-artifacts-cleanup-pending ledger with twelve positively not-filed targets,
  no current target or download attempt, and an empty OPFS root. The existing user-facing guide
  issued Start once, without response stubs. A combined observation timed out and reset the helper;
  the precise failing wait was not established. Start was never repeated.
- Read-only recovery found the durable ledger complete / cleaned-without-export, twelve not-filed
  targets, zero downloads and zero remote tabs. The reopened summary lost the existing no-export
  signal and incorrectly rendered “Periods processed, ZIP unconfirmed.” This proves the empty
  synthetic cleanup path completed, not that real staged files were removed or a live run qualified.
- Two canonical completion→JSON reopen→summary→panel tests failed the old reader at
  `expected markup to contain aria-label="No ZIP created"`; eight controls passed. The reader
  restores the existing no-export signal only for exact cleaned-without-export plus nonempty all
  not-filed targets. Direct and accepted durable-parser results now agree. Parser evidence omission
  stays intentional. Empty targets and validator-accepted contradictory downloaded targets remain
  negative controls. No new persisted field, value, allowlist, eligibility or schema was introduced.
- Initial rebuilt-profile reopen still used cached worker code although fetched bundle bytes matched
  disk. Explicit extension reload temporarily blocked its page in headless Chromium; closing and
  reopening the same profile loaded the new worker. The final actual GET summary and panel both
  report “No ZIP created · no eligible files.” Ledger bytes/revision remained unchanged across
  rebuild/reopen; only installation metadata changed on launch. A separate subsequent GET changed
  neither local nor session storage and emitted zero storage-change events. Zero downloads and
  remote tabs remained. Panel height 1,244.41px at 320px, without horizontal overflow.
- A reconnect attempt using the default headless shell timed out because it did not load the
  extension; full Chromium restored the worker. Only successful read-only reopen page intervals
  observed zero network requests; the lost pre-timeout counter is not browser-wide network proof.
  Screenshots were inspected, not committed. No authenticated portal session was used.

Six additional mutation groups were run serially and restored with matching file hashes:

| Mutation                               | Failed cases | Representative failure                                            |
| -------------------------------------- | -----------: | ----------------------------------------------------------------- |
| Remove cleanup-triggered focus         |            4 | Expected status HTMLElement; received HTMLBodyElement             |
| Autofocus an initially busy mount      |            1 | Expected existing HTMLButtonElement; received status HTMLElement  |
| Restore portal-prerequisite header     |            4 | Expected `Saved run · local cleanup`; received portal instruction |
| Allow empty target evidence            |            1 | Signals unexpectedly include `full-fiscal-year-no-zip-artifacts`  |
| Ignore contradictory downloaded target |            2 | Signals unexpectedly include `full-fiscal-year-no-zip-artifacts`  |
| Infer no-export without exact phase    |            4 | Signals unexpectedly include `full-fiscal-year-no-zip-artifacts`  |

- Full suite before these final rectifications: 136 files / 2,580 tests, start 08:42:32, duration
  154.38s. This is historical evidence, not the final-source gate. Latest focused result before the
  empty-target control: 59/59; the final reader file alone passes 11/11. Final full gates follow.
- Final source line counts: flow-summary 146→167, scope-form-model 191→188, scope-action-panel
  31→33, components 268→272, presentation-state 231→246, inline-status 350→370; panel-surface
  245→247; full-year-summary 609→616. Total 2,071→2,139 (+68). The existing oversized status and
  summary modules remain a documented refactoring opportunity; no unrelated split was attempted.
  New tests/helper: 178 + 283 + 213 + 107 = 781 lines, sixty new tests, zero removed tests.

### Cycle 22 — independent design and technical assessment

- Impeccable Assessment A completed before any detector output entered synthesis. Its initial
  25/40 design score rose to 27/40 after the two focused fixes; the retained P2 is discoverability:
  cleanup still requires scrolling past twelve evidence rows and navigating three selection steps.
  Changing recovery workflow or adding another action is a separate cycle, not silently included.
- Independent Assessment B ran the bundled local detector against the inline-status markup:
  exit 0, JSON `[]`, zero findings and zero false positives. It separately verified three actual
  packaged-panel views with synthetic deferred responses, normal clicks, unchanged single-scope
  Start messages, and blocked-response restoration. It did not inspect Assessment A's report.
- Mutable browser preflight succeeded, but the unchanged extension CSP blocked the localhost
  detector script. No in-page detector result or user-visible overlay is claimed. DOM inspection
  and screenshots were the fallback. Its temporary server stopped and browser closed. The
  deterministic scan did not identify the rendered small-type issue found by the browser check.
- P3 follow-up outside the changed inline-status component: Your pack and delivery metadata
  render at 11px, below DESIGN's 12px floor. This is a design-contract/readability finding, not a
  claim that font size alone violates WCAG. Scope a later typesetting change to the owning shared
  typography rules (`.section-label` and `.pack-summary-meta` in `src/styles/popup.css`) and
  remeasure density; no global style change was added to this cleanup cycle.
- Scoped technical audit: accessibility 3/4 (keyboard/ARIA/contrast inspected, actual speech not
  qualified); performance 3/4 (no new dependency, animation or repeated layout read; no performance
  trace); responsive 3/4 (320×600 and wider-to-narrower checks pass, small metadata remains);
  theming 3/4 (existing light-theme tokens retained, no new theme claims); anti-patterns 4/4
  (no new decorative template or redundant action). Total 16/20, Good within this limited surface.
  These scores are reviewer judgments, not certification or measured performance benchmarks.
- Positive evidence: exact delivery uncertainty survives, status feedback is visible after action,
  controls retain meaningful names and a 44px primary target, and disclosures contain secondary
  detail. Remaining uncertainties include real screen-reader speech, zoom/system-font variation,
  actual populated staging cleanup and authenticated runtime qualification.
- Questions are skipped under the owner's explicit away/autonomous instructions. The bounded
  next actions are clarify the saved-cleanup route, then typeset the 11px metadata and polish.
  No unsupported return control, multi-select or stronger capability claim is proposed.

### Cycle 22 — final gated checkpoint

- Final source checkpoint `d5fe4bd`; tests/helper checkpoint `f34689f`. Eight production-file
  hashes match the final security review. Privacy review closed both low wording findings after
  historical baseline labels and the ledger-transition test name were corrected. No source
  changes followed either approval.
- Build passed (1.01 MB); TypeScript, zero-warning ESLint, repo-wide Prettier, package verification
  and diff checks passed. Full suite: 137 files, 2,593 tests, sixty more than Cycle 21 and none
  removed. The synthetic review/preflight diagnostics and missing TypeScript source-map warning
  remain non-failing test output, not evidence of live PR or branch failures. Exact final footer:

  ```text
       Tests  2593 passed (2593)
    Start at  09:04:03
    Duration  159.59s (transform 3.04s, setup 0ms, import 14.22s, tests 129.11s, environment 9ms)
  ```

- The preceding final-source run also passed 137 files / 2,593 tests at 09:00:54 in 161.95s;
  the second run followed a test-description-only wording correction. Never two full suites at once.
- All root baseline/reopen profiles and independent A/B browser profiles are closed and deleted.
  A separate final generated-byte canary probe is in progress; it is not a live portal run and does
  not retroactively strengthen the earlier empty-staging evidence.

### Cycle 22 — generated-byte cleanup isolation controls

- At 09:08–09:10 IST, two additional fresh disposable profiles exercised the actual packaged Start
  handler, one each for canonical downloaded-cleanup-pending and legacy-cleanup-pending. The ledger
  fixture was built by the existing completion fixture and cleanup checkpoint producer, validated
  before seeding, and had no current target or download attempt. No response stubs were installed;
  the message wrapper only counted calls while forwarding them unchanged.
- Each profile began with installation metadata only and an empty OPFS root. Three generated files
  were written: 22 bytes under the active staging directory, a 14-byte sibling-directory canary and
  an 11-byte root canary. These bytes are not valid portal artifacts and carry no taxpayer data.
  The normal three Continue clicks followed by Retry local cleanup sent exactly one Start.
- Both active staging directories were absent afterward; both canaries retained their exact text.
  The downloaded fixture ended complete / cleaned-after-download and retained its saved wording;
  the legacy fixture ended complete / cleaned-legacy and retained “ZIP unconfirmed,” with neither
  delivery nor no-export signal added. Each had zero browser downloads and remote tabs. Observed
  context HTTP(S) requests were zero, not a claim about all worker network activity.
- The saved wording in the first fixture derives from the seeded synthetic delivery phase, not
  an observed browser download. This checks cleanup isolation and phase-preserving presentation,
  not target identity, artifact validity, real download correlation or authenticated behavior.
  All three cleanup-phase variants now have a bounded actual synthetic handler observation:
  no-artifacts with empty staging; downloaded and legacy with generated active-directory bytes.
- Both browsers were closed and their exact disposable profiles deleted; canaries were disposable
  test data removed with those profiles, not user files. No source/test change or gate rerun was
  needed for these additional observations.
- Byte sizes above are UTF-8 lengths of the exact written strings. The first setup helper printed
  a hard-coded 21-byte active payload count; recomputation corrected it to 22. File metadata was not
  separately sampled before deletion. Canary contents and directory absence were actually read.

### Cycle 22 — final responsive stress and handoff boundaries

- Independent follow-up doubled the root font from 16px to 32px at 320×600 for all three cleanup
  phases: status body 12→24px, heading 13→26px. Idle warning remained fully visible at
  y=194.78–481.17 with BODY focus; after normal activation, pending status was y=189.28–410.88,
  focused, scrollY=5.5. Document width stayed 320px, with no observed clipping in inspected status,
  evidence, summary, helper and action elements. Each Start was stubbed, exactly once.
- This is root-font stress, not actual browser zoom or screen-reader qualification. The packaged
  harness cannot mount initially busy without an action because the controller initializes busy to
  null; that case remains unit-tested only. The independent browser/profile were closed/deleted.
- The pending-cleanup serializer/allowlist gap remains an owner boundary; the new completed
  no-export reconstruction does not fix or authorize it. Selection changes can still hide a
  cleanup-only summary. The shared action component still has its pre-existing unscoped portal
  independence calculation; this cycle changed its copy matcher, not that eligibility calculation.
  A later bounded review should trace real callers before changing it, preserving refusal priority.
- The bookkeeping-delete policy decision remains open. No live portal, real download, Chrome Web
  Store, release, hosted CI, current-head PR review or general durability qualification is claimed.
  Manifest policy, WXT configuration, dependency manifest and lockfile match the lane's base.
- Read-only caller tracing at handoff narrows the direct-prop mismatch concern: the only live
  `ScopeFormAction` path is PanelSurface → PanelGuidedScope, supplied with the controller's
  canonically matched `scopedFlowSummary`. The exported legacy ScopeForm wrapper has no production
  importer. The malformed direct-prop test shape is therefore not established as a live panel
  authorization defect. Removing that unused wrapper remains a separate reduction candidate.
- The final scoped critique is archived in
  `.impeccable/critique/2026-08-26T03-42-56Z__src-entrypoints-popup-inline-status-tsx.md`.
  Snapshot write and metadata trend read succeeded; this is the first snapshot for that target,
  so there is no historical trend. The temporary report body was deleted after writing.
- The critique archive is ignored by the repository's existing `.impeccable/` rule. An attempted
  ordinary stage was refused; no force-add or ignore-rule change was made. It remains a local
  worktree artifact. The scored findings, limits and follow-ups are also recorded in this tracked
  validation document; the archive itself is not claimed as part of the Git checkpoint.

### Final disk cleanup and reproducibility

- At 09:16 IST, deleted only this lane's `node_modules` and `.output` after all local gates and
  browser work. Immediately before deletion, their measured footprints were 308,572 KiB and
  1,076 KiB (309,648 KiB combined). Both are confirmed absent; source, tests, worktree, branch,
  tracked evidence and the local ignored critique archive remain. Generated `.wxt` types occupy
  32 KiB; no browser profile remains there. Other worktrees and their dependencies were untouched.
- Filesystem available space measured 68,502,896 KiB immediately before and 68,514,188 KiB after
  cleanup, a difference of 11,292 KiB. This shared filesystem was changing independently, and pnpm
  links can share storage; the directory footprint is not claimed as physically reclaimed space.
- Recreate this lane's dependencies with `pnpm install --frozen-lockfile`, then prepare/build WXT
  before type/test checks. No dependency or manifest changed. Final source/test diffs against their
  checkpoints are empty. Gates were run before generated dependencies/output were removed.
- The final two Markdown records are checked with the same already-loaded Prettier standalone
  parser/config after cleanup; this requires no reinstall or new dependency. This is a formatting
  check, not a claim that the full suite ran without dependencies.
- Final handoff will close the current wall-clock cycle near the requested 09:30 IST window.
  Any intervening hold after evidence and cleanup is explicitly idle, not additional implementation
  or test execution. No new cycle, feature, release or PR operation is started during that hold.
- Handoff closed at 09:29 IST. Cycle 22 spans 08:27–09:29 (62 minutes), including a disclosed
  approximately 09:17–09:29 idle hold. Earlier checkpoint rounds 1–17 did not meet the requested
  cycle duration; their real timestamps remain visible. This record does not claim an unbroken
  compliant overnight cadence. The goal is not marked complete and the open owner boundaries remain.

### Cycle 83 — GST tab-focus retention

- A selected GST tab that cannot be brought to the foreground now yields a fixed blocked response
  and canonical persisted summary, before any portal-owned navigation, artifact trigger or download
  attempt. Tab-focus and containing-window-focus rejections share the same non-sensitive state;
  unavailable-tab and unavailable-tab-session states retain their own existing outcomes.
- The regression first rejected with a synthetic focus failure. Restored focused proof covers each
  focus operation, the exact canonical message and its persisted projection, and absence of artifact
  triggering. Privacy and security reviews passed after a privacy-requested window-focus coverage
  closure; the final serial gate passed 152 files and 2,837 tests with no storage, target-binding,
  download-evidence, MV3 or sensitive-data regression.

### Cycle 84 — legacy staging ownership reduction

- Caller tracing removed the obsolete artifact-progress reserve/clear exports and their eight
  self-only tests. The live selected-artifact flow continues to use the scope-bound durable bundle
  ledger; local-data recovery and target review retain the artifact-progress staging reader.
- The fixed-point import scan found no orphaned former export and confirms the active replacement.
  Security review closed after the matching reduction-plan update. Focused recovery coverage passed
  5 files and 168 tests; the final serial suite passed 152 files and 2,829 tests, an exact eight-test
  decrease attributable to the deleted self-only tests. No persisted schema, download evidence, MV3,
  permission, host or CSP behavior changed.

### Cycle 85 — main-world execution audit

- The initially suspicious empty low-level signal list is not a lossy surface: its fixed execution
  reason reaches the shared blocked message and retained-checkpoint rule. Existing focused coverage
  distinguishes it from a portal generation timeout and verifies no browser download begins. No
  change was retained.

### Cycle 86 — start-checkpoint fallback audit

- A failed fallback checkpoint preserves the original exact-ID intent and returns the fixed
  checkpoint-failed recovery message; it does not grant completion or retry authority from an
  unrecorded browser outcome. No change was retained.

### Cycle 87 — compact initial context

- The packaged browser verifier now checks the initial checking/unavailable panel context at 320px
  for horizontal overflow, clipped controls and sub-44px controls. Its shell-width lower bound now
  respects the documented horizontal gutters at the narrow viewport while retaining the wider-layout
  threshold. The complete gate passed 152 files and 2,829 tests, package verification and packaged
  browser verification; this is local synthetic verification, not a live portal qualification.
