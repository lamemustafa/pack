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
