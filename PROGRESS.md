# Sustained catalogue-overhaul progress

## Cycle 65 — remove the unused controller status projection

- Window: 2026-08-27 06:10–06:15 IST. This is a bounded duplicate-fact/code-reduction checkpoint;
  its actual duration is recorded without an idle hold.
- Picked: repeated controller literals suggested that the returned `status` field might be a stale
  projection rather than a human-visible surface. It was written on context reads, flow responses
  and action errors, alongside the actual `actionError` and flow-summary UI state.
- Measured: Graphify is installed but this worktree has no graph data, so exact importer tracing was
  used. `PanelSurface`, the only production hook consumer, reads presentation, summary, busy and
  action-error fields but never `pack.status`; the only remaining `status` fixture was the shared
  synthetic panel controller. No source read consumes the returned field.
- Changed: removed the unused React state, all seven writes, the returned field and its test-fixture
  value. This deletes duplicate stale messages without changing the actual context, flow-summary or
  safe-error projections that the panel renders.
- Gate: focused controller/panel/guided-scope renders passed 3 files and 44 tests. Build,
  TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and `git diff --check`
  passed. Exact Vitest footer:

  ```text
       Tests  2817 passed (2817)
    Start at  06:11:15
    Duration  154.58s (transform 2.52s, setup 0ms, import 12.49s, tests 125.96s, environment 8ms)
  ```

- Checkpoints: `cec3921 refactor(popup): remove unused controller status`; the progress record
  follows in a separate documentation checkpoint. No live/authenticated GST qualification, release
  claim, push or PR action was made.
- Learned / next: a value returned from a live hook can still be dead if its only consumer surface
  ignores it. Continue the duplicate-fact audit from live render consumers, not state writers.

## Cycle 64 — audit disabled-control descriptions across the panel

- Window: 2026-08-27 06:06–06:10 IST. This is a quiet keyboard/screen-reader audit; its actual
  duration is recorded without an idle hold.
- Picked: every disabled control must either name its current reason or point to visible reason
  text. Static source review covered panel presets and guided scope, the shared scope action,
  inline-status actions and recovery controls.
- Measured: every conditional `aria-describedby` target is rendered in the same branch as its
  disabled control. Preset, scope-action, inline portal-gate and recovery reason IDs are stable and
  unique per mounted surface. The guided field always references its visible step hint; its busy
  state is not live in `PanelSurface`, which unmounts the guide while a run is active. Controls that
  remain mounted while busy expose their state through their accessible label (for example,
  “Working…” or “Run in progress”) rather than an unresolved reference.
- Result: no source change. Guided-scope interaction, recovery-action and inline-status suites
  passed 3 files and 86 tests; `git diff --check` and worktree status were clean.
- Learned / next: review a description relationship as conditional rendered DOM, not merely an ID
  string. Continue the duplicate-fact audit on a module outside this action surface.

## Cycle 63 — reconcile the test-file baseline discrepancy

- Window: 2026-08-27 06:04–06:08 IST. This is a quiet evidence audit; its actual duration is
  recorded without an idle hold.
- Picked: the objective’s static baseline names 152 test files, while every current full Vitest gate
  reports 151. A higher assertion count does not explain one missing test file.
- Measured: the current tracked test-file count is 151 and matches Vitest. A count over every
  reachable branch tree from `master` to `HEAD` observed 124, 125, 126, 127, 131, 134, 137, 124,
  128, 147, 149, 150 and 151 files; no reachable tree contains 152.
- Result: no source or test change. The evidence does not identify a removed test to restore, and
  recreating an unknown baseline test would create ungrounded coverage. `VALIDATION.md` now records
  the discrepancy under Uncertainty, including the evidence needed for an owner to resolve it.
- Gate: `pnpm exec prettier --check VALIDATION.md PROGRESS.md`, `git diff --check` and worktree
  status passed before the documentation checkpoint.
- Checkpoint sequencing: the required preflight immediately after the separate validation commit
  correctly rejected the still-uncommitted progress record. After this record committed, preflight
  passed on the clean tree; no test, build, type, lint or package gate was needed for docs-only
  evidence.
- Learned / next: a count mismatch must be attributed, not silently offset by unrelated new tests.
  Continue auditing a fresh human-visible state while retaining this owner-input boundary.

## Cycle 62 — audit scoped portal-independent cleanup eligibility

- Window: 2026-08-27 06:01–06:04 IST. This is a quiet guard audit; its actual duration is
  recorded without an idle hold.
- Picked: `ScopeFormAction` can treat a retained full-year cleanup as portal-independent. A prior
  validation note left open whether that unscoped direct prop could enable a different selected
  scope without a supported portal tab.
- Measured: production has one `ScopeFormAction` caller: `PanelSurface` → `PanelGuidedScope`.
  It supplies the controller’s scope-matched summary; if a saved run belongs to a different scope,
  `PanelSurface` supplies an authoritative disabled external block because the background refuses
  that outstanding review before reading a new requested scope. The exported legacy `ScopeForm`
  wrapper has no production importer. Existing direct-prop coverage deliberately documents the
  unscoped compatibility shape, while external-block coverage proves it cannot authorize the live
  panel path.
- Result: no source change. Changing the direct-prop behavior would alter an unestablished caller,
  while the live caller already preserves the stricter background refusal. Components, cleanup-action
  and guided-panel suites passed 3 files and 51 tests; `git diff --check` and worktree status were
  clean.
- Learned / next: evaluate portal independence together with the caller’s scope matcher and
  external-block precedence, not from a reusable component prop in isolation. Continue a fresh
  lossy-surface or duplicate-fact audit.

## Cycle 61 — retain interrupted-run acknowledgement reasons

- Window: 2026-08-27 05:56–06:00 IST. This is a short lossy-surface regression checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: `acknowledgeInterruptedRun` handles its message response directly instead of going through
  the shared flow-response helper, so it needed its own proof that a specific safe rejection still
  reaches the controller’s user-visible error state.
- Measured before: start-flow, context, refresh, and storage-change rejections had safe-message
  regressions, but acknowledgement did not. Its source correctly preferred `safeMessage`; the
  gap was evidence, not a production change.
- Changed: added an acknowledgement rejection fixture with a specific safe message and generic
  handler error. The controller must retain the specific safe message. No production behavior,
  persistence, portal action, download evidence, or public copy changed.
- Discrimination: temporarily preferring `response.error` in the acknowledgement branch made the
  new test fail with `BACKGROUND_MESSAGE_HANDLER_FAILED` instead of “Pack could not clear the saved
  run until its local state is checked.” The source preference was restored before final gates.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2817 passed (2817)
    Start at  05:57:14
    Duration  153.70s (transform 2.48s, setup 0ms, import 12.47s, tests 125.14s, environment 8ms)
  ```

- Checkpoints: `e6daad0 test(popup): retain interrupted-run safe rejection`; the progress record
  follows in a separate documentation checkpoint. No live/authenticated GST qualification, release
  claim, push or PR action was made.
- Learned / next: direct message handlers are independent user-visible boundaries even when they
  look structurally identical to a shared helper. Continue on a terminal path rather than adding
  redundant start-flow coverage.

## Cycle 60 — require browser evidence before single-period saved copy

- Window: 2026-08-27 05:48–05:55 IST. This is a focused correction to a user-visible financial
  completion claim; its actual duration is recorded without an idle hold.
- Picked: the panel’s shared presentation state called every complete single-period run “saved by
  your browser”, while the pack-summary card already withheld that claim without a completed,
  non-empty browser-download signal. Both messages render for the same run, so an unconfirmed run
  could contradict itself on screen.
- Measured before: importer tracing confirmed `PanelSurface` feeds the shared presentation into
  `InlineStatus` and renders `PackSummary` alongside it. The prior inline branch then discarded a
  cautious presentation body and restored the unsupported single-file saved claim.
- Changed: one popup-bound confirmation predicate now drives the pack card, presentation state,
  and inline status. A complete single-period run without positive evidence now says browser
  download unconfirmed and directs the user to Browser Downloads; it retains the existing specific
  filename-override copy, and confirmed runs still say saved. Existing GST-owned filename-override
  signal names are reused rather than duplicated.
- Discrimination: temporarily making the shared predicate always true failed 7 focused assertions:
  the inline status again announced the selected file saved, the presentation state returned the
  success state, and five existing pack-summary cases falsely claimed a save. The signal predicate
  was restored before final gates.
- Required review: Pack privacy review PASS found no credential/session, taxpayer-data, storage,
  network, permission, selector, or public-claim expansion. It confirmed the reused values are
  fixed existing signal names and no filename or portal value reaches the UI.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2816 passed (2816)
    Start at  05:51:34
    Duration  154.02s (transform 2.47s, setup 0ms, import 12.40s, tests 125.48s, environment 8ms)
  ```

- Checkpoints: `603c676 fix(popup): require download evidence for saved copy`; the progress record
  follows in a separate documentation checkpoint. No live/authenticated GST qualification, release
  claim, push or PR action was made.
- Learned / next: terminal status alone is not delivery evidence. Trace all co-rendered summary and
  status copy as one surface, then continue the lossy-surface audit with a different terminal path.

## Cycle 59 — mutate-check untrusted summary-period counts

- Window: 2026-08-27 05:41–05:46 IST. This is a short test-quality checkpoint; its actual
  duration is recorded without an idle hold.
- Picked: `PackSummary` renders a parsed period count supplied through a safe signal only when it
  is an integer in the declared 0–36 range, but the existing test sampled only a valid count.
- Measured before: `fixedCountSignal` already falls back to the honest “summary included” wording
  for malformed counts. The focused pack-summary suite had no regression coverage for negative,
  above-range, or non-numeric signal payloads.
- Changed: added parameterized coverage for `-1`, `37`, and non-numeric counts. Each requires the
  generic summary-included wording and forbids the untrusted count from reaching the visible pack
  summary. No production behavior, persistence, portal action, download evidence, or public copy
  changed.
- Discrimination: temporarily removing the 0–36 bounds made the test fail for `-1` and `37`; the
  rendered summary incorrectly stated “summary for -1 periods” and “summary for 37 periods”. The
  source bound was restored before final gates.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2812 passed (2812)
    Start at  05:42:23
    Duration  154.64s (transform 2.51s, setup 0ms, import 12.52s, tests 125.95s, environment 8ms)
  ```

- Checkpoints: `9467803 test(popup): bound summary period count`; the progress record follows in a
  separate documentation checkpoint. No live/authenticated GST qualification, release claim, push
  or PR action was made.
- Learned / next: the visible summary correctly fails closed on malformed structured metadata, and
  the test now proves its numerical range rather than merely a happy-path parse. Continue the
  duplicate-fact audit on a fresh module.

## Cycle 58 — make the disabled-state design rule screen-reader complete

- Window: 2026-08-27 05:38–05:41 IST. This is a short documentation/accessibility checkpoint;
  its actual duration is recorded without an idle hold.
- Picked: `DESIGN.md` required unavailable matrix cells to state their reason only “on hover”,
  despite the current popup and panel controls correctly exposing disabled reasons as visible text
  and through `aria-describedby`.
- Measured before: focused scope-action, recovery-action, and inline-status tests exercise those
  existing relationships (3 files, 84 tests). The design contract was stale: hover alone cannot
  explain a disabled control to keyboard or screen-reader users.
- Changed: the internal matrix-cell rule now requires visible reason text and a programmatic
  relationship from a disabled control to that reason; it explicitly rejects hover-only
  explanations. No production UI, portal behavior, persistence, download evidence, or public copy
  changed.
- Required review: Pack privacy review PASS found no credential/session, taxpayer-data, storage,
  network, manifest, selector, or public-claim change.
- Gate: the 3 focused suites passed 84 tests; `pnpm exec prettier --check DESIGN.md` and
  `git diff --check` passed before the source checkpoint.
- Checkpoints: `a42f73a docs(design): require described disabled reasons`; the progress record
  follows in a separate documentation checkpoint. No live/authenticated GST qualification, release
  claim, push or PR action was made.
- Learned / next: visual unavailable styling is not sufficient documentation for a disabled
  control. Continue a bounded mutation sample on a separate user-visible safety boundary.

## Cycle 57 — audit guided-panel navigation while an action is active

- Window: 2026-08-27 05:36–05:38 IST. This is a quiet keyboard/screen-reader audit, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: guided-panel Back and Continue controls do not have their own busy disable state, which
  initially looked like it could let a user hide an in-flight final action by changing guide steps.
- Measured: `PanelSurface` derives `running` from the effective busy state or an active summary and
  removes the entire `PanelGuidedScope` while true. The guide navigation therefore cannot be
  interactive during the action; its field-level busy prop is not a competing live control surface.
- Result: no source change. Adding another busy reason to unmounted navigation would be dead UI and
  duplicate the existing action/status state. Guided interaction and panel-surface suites passed
  2 files and 34 tests; `git diff --check` and worktree status were clean.
- Learned / next: trace the parent visibility guard before adding per-control disabling. Continue
  the accessibility audit on a control that remains mounted in its potentially disabled state.

## Cycle 56 — retain specific flow-rejection reasons in the popup

- Window: 2026-08-27 05:31–05:36 IST. This is a short lossy-surface test-quality checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: action-response failures already prefer `safeMessage` over a generic transport error, but
  the popup controller covered that rule for mount, refresh, and summary-change reads rather than a
  user-initiated flow action.
- Measured before: the action rejection projection correctly retained its safe message in source,
  but no focused test proved that specific fact reached the controller’s human-visible error state.
- Changed: added an action-response regression that starts a flow with a specific safe rejection and
  requires the controller to retain that exact message. No production behavior, persistence, portal
  action, download evidence, or copy changed.
- Discrimination: temporarily replacing the safe-message preference with the transport error made
  the test fail: it received `BACKGROUND_MESSAGE_HANDLER_FAILED` instead of the specific safe
  rejection. The source was restored before final gates.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2809 passed (2809)
    Start at  05:32:35
    Duration  154.71s (transform 2.49s, setup 0ms, import 12.44s, tests 126.21s, environment 8ms)
  ```

- Checkpoints: `3efe0e6 test(popup): retain flow safe rejection`; the progress record follows in a
  separate documentation checkpoint. No live/authenticated GST qualification, release claim, push
  or PR action was made.

## Cycle 55 — mutate-check saved-file evidence counting

- Window: 2026-08-27 05:29–05:31 IST. This is a quiet test-quality checkpoint, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: per-target evidence must distinguish periods finished without a filed artifact from files
  whose browser download Pack can positively prove.
- Measured: temporarily counting `not-filed` outcomes as saved made the focused UI test fail. The
  rendered status changed from one of three saved to three of three saved even though only one
  actual file had correlated download evidence.
- Result: no source change. The strict saved-only count was restored before the focused rerun; the
  target-evidence suite passed 1 file and 6 tests, with `git diff --check` and worktree status
  clean. This preserves fail-closed completion wording.
- Learned / next: the named count test catches the exact misleading aggregate it describes. Keep
  sampling boundaries where product text could imply stronger download proof than the runtime has.

## Cycle 54 — bound the 320px rendered-panel verification gap

- Window: 2026-08-27 05:28–05:30 IST. This is a quiet panel-state audit, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: the next backlog item requires verifying every declared panel state at 320px without
  horizontal scrolling, clipped controls, or undersized targets.
- Measured: the repository already has a packaged-extension 320px verifier that checks preset and
  expanded-catalogue controls. It obtains the supported panel context by injecting synthetic GST
  page content. That is a portal simulation, which this overnight objective explicitly forbids.
- Result: no browser verifier was run and no source changed. The static package-verifier and panel
  surface suites passed 2 files and 44 tests; `git diff --check` and worktree status were clean.
- Owner decision needed: authorize the existing synthetic browser verifier for this local layout
  proof, or defer rendered 320px qualification. The current prohibition prevents extending it to
  the remaining loading, empty, error, permission-denied, and catalogue states; static tests alone
  are not equivalent layout evidence.

## Cycle 53 — require canonical artifact-label context

- Window: 2026-08-27 05:23–05:28 IST. This is a short duplicate-fact corrective checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: `filedReturnsArtifactLabel` had an optional return-type argument with a context-free
  `All formats` fallback, although both production importers already supply the canonical return
  type and the catalogue owns return-specific artifact vocabulary.
- Measured before: importer tracing found only the popup summary and fiscal-year summary callers,
  both passing their scope return type. Connector tests covered selection expansion but not direct
  label derivation. The initial GSTR-1 fixture expected an assumed label; the catalogue correctly
  supplied `Summary (PDF)`, and the test was aligned to that canonical output.
- Changed: the label helper now requires the return type and delegates every label to the capability
  catalogue. New focused tests cover all-formats and single-format labels; no portal behavior,
  persistence, download action, artifact selection, or public copy changed.
- Discrimination: temporarily returning the wire artifact value made the new test fail with
  `PDF_AND_EXCEL` rather than the catalogue label `All formats`. The source was restored before
  final gates.
- Required review: Pack privacy review PASS found no credential/session, taxpayer-data, storage,
  network, telemetry, permission, or public-claim change. It confirmed that the required context
  preserves the portal-specific boundary and prevents context-free labeling.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2808 passed (2808)
    Start at  05:25:01
    Duration  154.05s (transform 2.54s, setup 0ms, import 12.45s, tests 125.42s, environment 8ms)
  ```

- Checkpoints: `ea4d663 refactor(gst): require artifact label context`; the progress record follows
  in a separate documentation checkpoint. No live/authenticated GST qualification, release claim,
  push or PR action was made.

## Cycle 52 — mutate-check last-run diagnostic privacy boundary

- Window: 2026-08-27 05:22–05:23 IST. This is a quiet test-quality checkpoint, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: the compact last-run diagnostic surface intentionally shows terminal state and safe signal
  IDs without rendering the flow-step message or selected scope values.
- Measured: temporarily adding the flow-step message to that diagnostic view made its focused test
  fail at the message-exclusion assertion. The same test also protects financial year and period
  from rendering in this compact surface.
- Result: no source change. The diagnostic view was restored before the focused rerun; its suite
  passed 1 file and 2 tests, with `git diff --check` and worktree status clean. No sensitive value
  was copied into this record.
- Learned / next: this is a discriminating privacy test for the diagnostic projection. Continue the
  lossy-surface audit where a user-facing safe message is intentionally projected, not into a view
  designed to expose only stable safe-signal IDs.

## Cycle 51 — mutate-check retained cleanup eligibility

- Window: 2026-08-27 05:21–05:23 IST. This is a quiet test-quality checkpoint, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: the full-year cleanup-action suite claims that portal-independent cleanup is unavailable
  without retained local-file proof, a fail-closed financial recovery boundary.
- Measured: temporarily removing the `full-fiscal-year-opfs-retained` guard from
  `canRetryFullFiscalYearZipWithoutPortal` made the focused suite fail: the missing-retained-marker
  case incorrectly rendered `Retry local cleanup` and `Retry cleanup for this saved run.`
- Result: no source change. The guard was restored before the final focused rerun; cleanup-action
  and flow-summary suites passed 2 files and 41 tests, with `git diff --check` and worktree status
  clean. This is a behavioural discrimination audit, not a relaxation of retained-evidence policy.
- Learned / next: the fixture’s missing-retained-marker variant catches the exact unsafe eligibility
  broadening it names. Continue sampling a distinct boundary rather than adding redundant coverage.

## Cycle 50 — audit scope-form lock explanations

- Window: 2026-08-27 05:20–05:22 IST. This is a quiet keyboard/screen-reader audit, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: the wider download scope form disables its controls during an active operation or retained
  final-ZIP retry, so it was the next candidate after the discrete recovery actions.
- Measured: the primary action already uses the shared `scope-action-reason` relationship whenever
  disabled. Its exact reason is derived by the same action model as the control state. The field
  lock only occurs while the run/action status or retained local retry state is already visibly
  represented; a target review deliberately keeps the scope controls usable and explains the
  explicit recovery choice instead.
- Result: no source change. Adding a generic second explanation to the disabled selects/radios
  would duplicate the canonical action/status surface and could contradict a state-specific retry
  label. Focused components and recovery suites passed 2 files and 40 tests; `git diff --check` and
  worktree status were clean.
- Learned / next: distinguish a disabled button that needs its adjacent reason bound from a form
  lock whose canonical explanation is already bound to the decision action. Continue with a separate
  test-quality sample rather than widening this settled contract.

## Cycle 49 — bind active recovery-state explanation for assistive technology

- Window: 2026-08-27 05:16–05:21 IST. This is a short accessibility corrective checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: the recovery menu used a disabled `Run in progress` control alongside a precise note that
  retry controls will appear only if progress stops, but it had no programmatic connection to that
  explanatory note.
- Measured before: active-run coverage asserted both visible strings and rejected an invented pause
  control, but it did not prove that the disabled status control received its existing explanation.
- Changed: the active-run note now has a stable ID and the sole disabled active-run control uses
  `aria-describedby` to reference it. This changes no run state, retry policy, portal behavior,
  persistence, download behavior, or user-visible copy.
- Discrimination: temporarily removing the relationship made the active-run test fail with the
  missing `aria-describedby="recovery-run-active-reason"` markup. The source was restored before
  final gates.
- UI review: the Impeccable product-UI accessibility guidance preserves the compact existing
  recovery surface while giving its disabled status control a resolvable explanation.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2807 passed (2807)
    Start at  05:16:57
    Duration  153.58s (transform 2.49s, setup 0ms, import 12.34s, tests 125.13s, environment 8ms)
  ```

- Checkpoints: `bf7d539 fix(a11y): describe active recovery state`; the progress record follows in
  a separate documentation checkpoint. No live/authenticated GST qualification, release claim,
  push or PR action was made.

## Cycle 48 — bind portal-gated recovery-action reasons for assistive technology

- Window: 2026-08-27 05:10–05:16 IST. This is a short accessibility corrective checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: the recovery menu rendered a specific portal-needed reason for disabled portal actions,
  but neither its target-review start-again action nor its full-year retry/start-again actions
  referenced that explanation programmatically.
- Measured before: the recovery tests proved that the reason appeared and that the actions were
  disabled. They did not prove that a screen reader could associate the one reason with exactly the
  portal-gated controls. Local download reconciliation/cleanup and cancel controls intentionally
  remain available without the portal and are not described by the portal-only reason.
- Changed: the existing recovery reason receives a stable ID. Only the portal-gated restart action
  in target review and the two portal-gated actions in full-year review reference it. Tests assert
  the target-review button relation and exactly two full-year references; no copy, action authority,
  scope, portal behavior, persistence, or download behavior changed.
- Discrimination: temporarily removing the relationships made the focused recovery suite fail in
  three branches: missing target-review restart association, zero rather than two full-year
  associations, and missing full-year retry association. The source was restored before final gates.
- UI review: the Impeccable product-UI accessibility guidance preserves established recovery copy
  and component vocabulary while making the actual disabled portal controls describable.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2807 passed (2807)
    Start at  05:12:36
    Duration  154.06s (transform 2.50s, setup 0ms, import 12.33s, tests 125.59s, environment 8ms)
  ```

- Checkpoints: `4a2081b fix(a11y): describe portal-gated recovery actions`; the progress record
  follows in a separate documentation checkpoint. No live/authenticated GST qualification, release
  claim, push or PR action was made.

## Cycle 47 — bind portal-gated inline-action reasons for assistive technology

- Window: 2026-08-27 05:05–05:10 IST. This is a short accessibility corrective checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: portal-gated inline primary actions visibly stated why they were disabled, but the button
  had no programmatic association with that existing explanation.
- Measured before: the inline-status test asserted that every portal-gated action was disabled and
  printed its reason, but did not assert an accessible description target. A visible sibling
  paragraph alone does not reliably describe a disabled control to screen-reader users.
- Changed: the existing portal-disabled reason paragraph now has a stable ID, and only the matching
  portal-gated action receives `aria-describedby`. Enabled and busy actions remain unchanged. The
  parameterized recovery test requires both the relation and its resolved markup ID; no copy,
  action authority, scope, portal behavior, persistence, or download behavior changed.
- Discrimination: temporarily removing the button relationship made the targeted suite fail with
  `expected ... to contain 'aria-describedby="inline-status-portal-disabled-reason"'`. The source
  was restored before final gates.
- UI review: the Impeccable product-UI accessibility guidance required the disabled control to be
  programmatically connected to its explanation while retaining the established component and copy.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2807 passed (2807)
    Start at  05:07:30
    Duration  153.79s (transform 2.46s, setup 0ms, import 12.33s, tests 125.30s, environment 8ms)
  ```

- Checkpoints: `b641921 fix(a11y): describe portal-gated actions`; the progress record follows in
  a separate documentation checkpoint. No live/authenticated GST qualification, release claim,
  push or PR action was made.

## Cycle 46 — bind disabled final-action reasons for assistive technology

- Window: 2026-08-27 04:55–05:04 IST. This is a short accessibility corrective checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: the shared final-action component showed disabled-state reason text, but its disabled
  button had no programmatic association with that explanation.
- Measured before: guided-flow coverage verified that a final action was disabled during retained
  recovery, but neither the panel nor the popup markup asserted a resolvable description. The
  visible reason alone is insufficient screen-reader evidence.
- Changed: a disabled shared action now gives its existing reason paragraph a stable ID and applies
  `aria-describedby` to the disabled button. Enabled actions remain unchanged. Panel and popup
  coverage assert the relationship and a non-empty reason; no copy, action authority, scope,
  portal behavior, persistence, or download behavior changed.
- Discrimination: temporarily removing the button relationship made the panel test fail with
  `expected null to be 'scope-action-reason'`. The source was restored before final gates.
- Gate rectification: the initial full run correctly failed one popup static-markup assertion that
  expected the old disabled-button tag. The assertion now requires the reason ID and relationship;
  the rerun passed. The unrelated review-gate warnings and missing TypeScript source-map warning in
  that first log did not determine test success; the concrete failure was the old markup assertion.
- UI review: the Impeccable product-UI accessibility guidance required a programmatic association
  for a disabled control's explanation, not merely visible adjacent prose.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2807 passed (2807)
    Start at  05:01:05
    Duration  153.20s (transform 2.45s, setup 0ms, import 12.30s, tests 124.83s, environment 8ms)
  ```

- Checkpoints: `d6fa544 fix(a11y): describe disabled scope actions`; the progress record follows
  in a separate documentation checkpoint. No live/authenticated GST qualification, release claim,
  push or PR action was made.

## Cycle 45 — prove disabled preset reasons resolve for assistive technology

- Window: 2026-08-27 04:48–04:55 IST. This is a short accessibility test-quality checkpoint; its
  actual duration is recorded without an idle hold.
- Picked: disabled preset buttons already use `aria-describedby`, but coverage did not prove that
  the ID points to a real, non-empty human-readable reason.
- Measured before: the first fixture used no portal context and correctly rendered the panel's
  context surface rather than presets. A supported context plus a retained different-scope recovery
  reaches the actual disabled-preset branch. The displayed reason is the existing canonical action
  label, not the raw saved-run prose.
- Changed: added one interaction regression that checks every disabled preset has an ID, that the
  ID resolves in the DOM, and that the resolved reason has non-empty text. No production markup,
  action authority, scope selection, portal behavior, or persistence changed.
- Discrimination: temporarily changing the production `aria-describedby` to an unbound ID made the
  new test fail with `expected null not to be null` at the description target. The production markup
  was restored before final gates. An earlier optional-chaining assertion mistakenly passed a missing
  target; the retained test requires the target element explicitly.
- UI review: the Impeccable product-UI accessibility guidance was applied to make the test assert a
  resolvable disabled-control explanation rather than visual appearance or duplicated copy.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2807 passed (2807)
    Start at  04:51:53
    Duration  154.50s (transform 2.46s, setup 0ms, import 12.35s, tests 126.03s, environment 8ms)
  ```

- Checkpoints: `9899a8c test(panel): verify disabled preset reasons`; the progress record follows
  in a separate documentation checkpoint. No live/authenticated GST qualification, release claim,
  push or PR action was made.

## Cycle 44 — audit artifact-acquisition exception preservation

- Window: 2026-08-27 04:45–04:47 IST. This is a quiet lossy-surface audit, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: the first bounded exception family from the goal's lossy-surface backlog: GSTR-3B PDF,
  GSTR-1/GSTR-2B page-generated, and GSTR-3B/GSTR-2B JSON acquisition paths.
- Measured: every relevant `catch` returns a named `ArtifactFailureReason` rather than a generic
  success/failure flag. The trigger retains that reason as `artifact-<reason>` and resolves the
  matching canonical user-safe message. Checkpoint retention also distinguishes externally visible
  action uncertainty from pre-action failures.
- Result: no source change. Replacing a named reason with an undifferentiated fallback would weaken
  the existing fail-closed recovery contract; the current boundary already preserves the specific
  fact to the human-facing flow step.
- Gate: focused acquisition and checkpoint suites passed 3 files and 76 tests; `git diff --check`
  and worktree status were clean. The Cycle 43 full gate remains the applicable repository-wide
  evidence because this audit retained no product or test source change.
- Learned / next: exception catch syntax alone is not evidence of loss. Continue with a boundary
  where a specific reason crosses a projection or persistence surface, rather than duplicating this
  already-preserving acquisition audit.

## Cycle 43 — derive persisted observation scope IDs without widening acceptance

- Window: 2026-08-27 04:40–04:47 IST. This is a short duplicate-fact checkpoint; its actual
  duration is recorded without an idle hold.
- Picked: persisted observer-state validation manually restated the three supported scope IDs in its
  acceptance set, ready-state resolver, message selection, and GSTR-3B default.
- Measured before: the parser is a security boundary: it accepts only known keys, canonical
  connector/page/state/signal/action values, clears invalid session input, and must not begin to
  accept a future runnable return merely because the catalogue changes.
- Changed: an explicit typed three-return observation allowlist now resolves through the canonical
  scope helper. Ready-state and message selection use the same resolver. The allowlist deliberately
  remains fixed rather than deriving from every supported return, so future return support is still
  rejected until this canonicalization surface is updated intentionally.
- Focused evidence: observation-state, observer, and tab-selection suites passed 3 files and 83
  tests. New parameterized coverage accepts and retains the exact canonical ready scope for GSTR-3B,
  GSTR-1, and GSTR-2B; existing mismatched-scope and extra-field cases still clear state. This is a
  structural duplicate removal with output-preserving assertions, so no behavioral red-proof
  mutation was appropriate.
- Required review: background/MV3 security review PASS confirmed strict parsing, session-only
  canonicalization, invalid-input clearing, no persisted-field widening, and future-return
  fail-closed behavior. No permissions, CSP, download, target, or external-code change occurred.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2806 passed (2806)
    Start at  04:42:30
    Duration  153.67s (transform 2.56s, setup 0ms, import 12.29s, tests 125.32s, environment 8ms)
  ```

- Checkpoints: `57d2780 refactor(background): derive observation scope IDs`; the progress record
  follows in a separate documentation checkpoint. No live/authenticated GST qualification, release
  claim, push or PR action was made.

## Cycle 42 — derive navigation defaults from the canonical scope descriptor

- Window: 2026-08-27 04:34–04:40 IST. This is a short duplicate-fact checkpoint; its actual
  duration is recorded without an idle hold.
- Picked: the portal-availability detector and DOM-only navigator each retained the same raw GSTR-3B
  default scope ID despite the canonical return descriptor owning it.
- Measured before: non-GSTR-3B flows pass an explicit scope ID to these boundaries; the default
  serves only the established GSTR-3B entry point. Existing navigation coverage asserted the click
  and no-network behavior but did not directly lock its default scope ID.
- Changed: both defaults now call `filedReturnScopeId("GSTR-3B")`; the existing navigation test
  asserts the preserved exact result. No click candidate, constructed URL, request, timing,
  safe signal, safe message, availability classification, persistence, target binding, or download
  behavior changed.
- Focused evidence: navigator, flow-navigation routing, and session-write-boundary suites passed
  3 files and 237 tests. This is a structural duplicate removal with output-preserving assertions,
  so no behavioral red-proof mutation was appropriate.
- Required review: GST privacy review PASS found no portal-action expansion, session/taxpayer data,
  storage, telemetry, logging, public claim, manifest, host, CSP, or reach change.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2803 passed (2803)
    Start at  04:36:23
    Duration  153.77s (transform 2.49s, setup 0ms, import 12.31s, tests 125.33s, environment 8ms)
  ```

- Checkpoints: `ceebd8b refactor(gst): derive default navigation scope`; the progress record
  follows in a separate documentation checkpoint. No live/authenticated GST qualification, release
  claim, push or PR action was made.

## Cycle 41 — derive observer scope IDs from the return descriptor

- Window: 2026-08-27 04:27–04:34 IST. This is a short duplicate-fact checkpoint; its actual
  duration is recorded without an idle hold.
- Picked: the GST page observer and its visible-return helper manually restated all three supported
  scope IDs, while the catalogue is the canonical owner of those values.
- Measured before: importer tracing showed the helper is live in both the observer and the
  observation-state validation path. Existing observer coverage asserted GSTR-1 and GSTR-2B scope
  IDs but did not directly assert the GSTR-3B ready path.
- Changed: `scopeIdForVisibleReturnLabel` now resolves through the existing return descriptor; the
  observer derives its GSTR-3B default and its GSTR-1/GSTR-2B ready responses through that helper.
  A focused GSTR-3B regression asserts the preserved scope ID. No observer state, safe signal,
  safe message, portal action, navigation, storage, target binding, or download behavior changed.
- Focused evidence: observer and observation-state suites passed 2 files and 29 tests. This is a
  structural duplicate removal with output-preserving assertions, so no behavioral red-proof
  mutation was appropriate.
- Required review: GST privacy review PASS found no taxpayer/session data, logging, persistence,
  transmission, portal interaction, public claim, manifest, host, CSP, or reach change.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2803 passed (2803)
    Start at  04:30:21
    Duration  153.90s (transform 2.49s, setup 0ms, import 12.28s, tests 125.52s, environment 8ms)
  ```

- Checkpoints: `6076ad3 refactor(gst): derive observer scope IDs`; the progress record follows in
  a separate documentation checkpoint. No live/authenticated GST qualification, release claim, push
  or PR action was made.

## Cycle 40 — derive the no-run acknowledgement scope from the return descriptor

- Window: 2026-08-27 04:20–04:27 IST. This is a short duplicate-fact checkpoint; its actual
  duration is recorded without an idle hold.
- Picked: the no-active-run acknowledgement response retained its own GSTR-3B scope-ID literal
  while active runs already derived their scope IDs from the canonical return descriptor.
- Measured before: an interrupted active run correctly used its recorded return type, but the
  no-run fallback duplicated the exact GSTR-3B descriptor value. With no persisted run there is no
  selected return type to recover, so GSTR-3B is the established canonical acknowledgement default.
- Changed: the response now passes `run?.scope.returnType ?? "GSTR-3B"` to the existing
  `filedReturnScopeId` resolver. The default still resolves to
  `gst-filed-returns-gstr3b-pdf-private-v0`; active-run output remains derived from its stored
  return type. No persistence, portal action, target binding, download evidence, or user-visible
  acknowledgement semantics changed.
- Focused evidence: `tests/background/filed-returns-active-run.test.ts` and
  `tests/background/filed-returns-current-state.test.ts` passed 2 files and 14 tests. This is a
  structural duplicate removal, so no behavioral red-proof mutation was appropriate.
- Required review: background/MV3 security review PASS found no permissions, host, CSP, content
  script, download, persistence, or target-evidence change.
- Final gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and
  `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2803 passed (2803)
    Start at  04:23:44
    Duration  153.77s (transform 2.54s, setup 0ms, import 12.39s, tests 125.17s, environment 8ms)
  ```

- Checkpoints: `d78f92c refactor(background): derive acknowledgement scope ID`; the progress
  record follows in a separate documentation checkpoint. No live/authenticated GST qualification,
  release claim, push or PR action was made.

## Cycle 39 — remove a self-only ambiguity path and its orphaned guard

- Window: 2026-08-27 04:09–04:20 IST.
- Picked: a hardcoded GSTR-3B scope ID in the ambiguity-trigger helper during the duplicate-fact
  audit.
- Measured before: the helper accepted any return target but emitted the GSTR-3B scope ID. Importer
  tracing showed `runDownloadTriggerOnce` had no production caller; its only caller was its own test.
  The ambiguity guard module had no other importer. Live selected-artifact and single-period flows
  use the retained `runDownloadStepWithRetry` validator instead.
- Changed: deleted the test-only trigger helper, its self-only test, and the orphaned guard module.
  The remaining module validates connector, canonical scope, state, bounded signals, and safe message
  before live callers proceed. This removes a dormant generic target path; it does not alter portal
  clicks, target binding, persistence, or download completion evidence.
- Gate rectification: the first full suite correctly failed the public-copy scanner because `git
ls-files` includes a file deleted but not yet staged. The scanner now ignores only tracked entries
  absent from the working tree; present files retain full claim scanning. That full-suite failure is
  the red proof for the test-infrastructure correction.
- Focused evidence: messaging and public-copy suites passed 2 files and 23 tests; exact searches
  found zero remaining references to the deleted symbols. The repository has no separately named
  unreferenced-module command, so fixed-point evidence is exact importer search plus TypeScript.
- Required reviews: MV3 security review PASS; privacy review PASS. Both found no permission, host,
  CSP, storage, target-evidence, public-copy, taxpayer-data, or reach regression.
- Final gate: build passed at 1.04 MB; TypeScript passed; ESLint passed with zero warnings;
  Prettier passed repo-wide; package verification passed; `git diff --check` passed. Exact Vitest
  footer:

  ```text
       Tests  2803 passed (2803)
    Start at  04:17:38
    Duration  153.07s (transform 2.50s, setup 0ms, import 12.27s, tests 124.71s, environment 8ms)
  ```

- Learned / plan change: an exported function in a live module can still be dead. Importer tracing
  must precede a duplicate-fact repair; deleting the unreachable behavior is safer than widening its
  contract to make the duplicated fact accurate.

## Cycle 38 — audit 320px panel-state coverage

- Window: 2026-08-27 04:08–04:12 IST.
- Picked: the objective's panel-state matrix at the 320px floor.
- Measured before: current component tests render honest loading, unsupported, access-denied,
  action-error, running, partial, blocked, complete, unavailable and cancelled families. The current
  packaged browser verifier remeasures the supported guided-flow and expanded catalogue geometry;
  historic synthetic packaged measurements cover every presentation family at 320px.
- Disposition: no source change. Extending the current verifier to inject arbitrary portal contexts
  would create a new portal-state simulation, which the objective forbids. Static rendering confirms
  no blank body or misleading chooser for the non-ready families, but is not presented as fresh
  geometry proof. The existing browser measurement remains valid only for its supported-flow scope.
- Impeccable audit influence: the project/product register and current panel system were re-read.
  The deterministic detector reports one pre-existing `width` transition on the 4px run-progress
  bar; it is an intentional state-progress motion but remains a performance advisory, not a new
  finding or change.
- Focused evidence: panel surface and guided-scope interaction suites cover the visible state and
  unsupported-control contracts. This is a quiet evidence-boundary audit, not portal qualification
  or a complete-gate claim.
- Learned / plan change: distinguish prior packaged layout evidence from current semantic coverage.
  The next cycle returns to duplicate-fact/test-quality work that can be qualified locally without
  manufacturing a portal state.

## Cycle 37 — audit typed selected-artifact storage failures

- Window: 2026-08-27 04:06–04:08 IST.
- Picked: the typed session-summary read/write state consumed by selected-artifact recovery.
- Disposition: no source change. The storage boundary returns distinct unavailable reasons; the
  consumer retains them as separate blocked recovery states, and durable-status maps them to
  distinct stable signals. Malformed state is also separately redacted and retained.
- Focused evidence: existing regression cases cover malformed data, failed replacement write, and
  failed read. The state tests prove unavailable storage never becomes retryable missing progress.
  This is a quiet audit, not portal qualification or a complete-gate claim.
- Learned / plan change: the critical distinction is present at both the storage and durable-status
  boundaries. The next audit moves to the requested 320px panel state matrix, where honest visible
  treatment matters more than another storage-path pass.

## Cycle 36 — audit ambiguous trigger transport failure

- Window: 2026-08-27 04:05–04:06 IST.
- Picked: the one-shot, side-effectful download-trigger transport catch.
- Disposition: no source change. Its generic ambiguity response is intentionally more specific than
  an untrusted transport exception: it says Pack cannot confirm whether the portal received the
  click, forbids an automatic retry, and directs the user to check browser downloads before a manual
  retry. No typed safe reason exists inside the caught failure to preserve.
- Focused evidence: the existing fake-timer test holds the trigger message unresolved, asserts the
  user-action-required state and exact ambiguity signal, and proves exactly one send. This is a
  quiet audit, not portal qualification or a complete-gate claim.
- Learned / plan change: preserve a supplied safe reason, but never manufacture one from a failed
  side-effectful transport. Continue looking for places that already have a typed reason and discard
  it before durable or visible output.

## Cycle 35 — audit terminal-download reconciliation before summary reads

- Window: 2026-08-27 04:04–04:05 IST.
- Picked: the summary handler's ignored result from terminal-download reconciliation.
- Measured before: a summary read awaits reconciliation and intentionally discards its boolean.
  At first glance that resembles the lossy catches fixed in Cycles 33–34.
- Disposition: no source change. A failed download lookup returns `false` before reconciliation,
  so it cannot promote a target without completed browser evidence. The following summary read uses
  durable state, which remains `download-observing` rather than claiming success or retrying
  blindly. Listener and startup reconciliation retain later opportunities to observe terminal
  evidence. Surfacing a raw browser lookup rejection would be neither a specific safe reason nor a
  safer state transition.
- Focused evidence: durable-download-reconciler and durable-acquisition-recovery suites passed 2
  files and 19 tests; `git diff --check` passed. This is a quiet audit, not a portal qualification
  or a complete-gate claim.
- Learned / plan change: do not equate every `catch(() => false)` with silent loss. The decisive
  distinction is whether the returned durable state remains honest and recoverable. Continue with
  only catches that replace an already-available safe reason or erase a terminal state.

## Cycle 34 — surface durable-summary refresh failures

- Window: 2026-08-27 03:59–04:04 IST.
- Picked: the storage-change branch of the saved-summary read path.
- Measured before: when durable recovery state changed, the open panel re-read its summary but
  returned early for every failed response. A safe failure therefore left no visible action error
  and could leave stale recovery presentation on screen.
- Without-fix proof: the new storage-change regression expected
  `Pack stopped while handling saved local recovery state. Try again.` and received `null`.
- Changed: the listener now displays its safe response, displays an honest unexpected-response
  failure, and catches rejected reads with the existing local-recovery fallback. Successful clears
  still preserve the user-selected scope. No background, portal, persistence-schema, download, or
  target-binding behavior changed.
- Focused evidence: popup-controller suite passed 1 file and 8 tests; TypeScript, focused lint,
  focused formatting, and `git diff --check` passed before the complete gate.
- Final gate: build passed at 1.04 MB; TypeScript passed; ESLint passed with zero warnings;
  Prettier passed repo-wide; package verification passed; `git diff --check` passed. Exact Vitest
  footer:

  ```text
       Tests  2804 passed (2804)
    Start at  04:00:38
    Duration  154.01s (transform 2.49s, setup 0ms, import 12.39s, tests 125.57s, environment 8ms)
  ```

- Learned / plan change: a durable-state listener is a user-facing read boundary, not a best-effort
  cache update. Continue auditing only fire-and-forget paths where failure has a terminal effect;
  intentionally advisory reconciliation must remain explicitly distinguished.

## Cycle 33 — preserve named context-read failures

- Window: 2026-08-27 03:49–03:58 IST.
- Picked: the context-read branch of the lossy-surface audit.
- Measured before: the background protocol may return a static `safeMessage` for an unexpected
  context-refresh failure, but the initial panel read and the on-demand refresh rendered only the
  internal error code. The handler also called that request an undifferentiated extension request.
- Without-fix proof: the new mount regression failed with expected
  `Pack stopped while handling the current GST Portal state. Try again.` and received
  `BACKGROUND_MESSAGE_HANDLER_FAILED`.
- Changed: both context presentation paths now prefer `safeMessage`; the background names
  `PACK_GET_CONTEXT` as the current GST Portal state and assigns it a stable handler site. Added
  tests for initial load, refresh, and a rejected browser query. The last proves the static safe
  response omits the rejected detail. No portal action, persisted field, download evidence, or
  target-binding behavior changed.
- Focused evidence: popup-controller and GST-tab-selection suites passed 2 files and 58 tests.
  The first complete gate exposed only a test TypeScript narrowing error; the assertion was given
  the harness's explicit controller type, then the focused and full gates were repeated. No source
  behavior was changed in that correction.
- Required review: MV3 security review PASS. No manifest, permission, CSP, content-script,
  persistence, download-correlation, or sensitive-data exposure regression was found.
- Final gate: build passed at 1.04 MB; TypeScript passed; ESLint passed with zero warnings;
  Prettier passed repo-wide; package verification passed; `git diff --check` passed. Exact Vitest
  footer:

  ```text
       Tests  2803 passed (2803)
    Start at  03:55:26
    Duration  156.19s (transform 2.81s, setup 0ms, import 13.26s, tests 126.48s, environment 8ms)
  ```

- Learned / plan change: a safe message is only safe if each consumer displays it. Continue the
  lossy-surface audit at storage-change summary refreshes and fire-and-forget reconciliation paths,
  separating intentionally advisory work from terminal user-visible failures.

## Cycle 32 — make all-formats expansion return-type-aware everywhere

- Window: 2026-08-27 03:43–03:48 IST.
- Picked: the remaining generic all-formats expansion helper after the prior duplicate-fact audit.
- Measured before: acquisition and durable-review paths use the return-type-aware catalogue selector,
  but the scope copy used a generic artifact list for its multi-file decision and the filename helper
  used that same generic list for its default artifact. Its legacy bundle expansion was always
  `PDF, EXCEL`, while the supported catalogue may offer a different concrete set.
- Changed: removed the generic expansion helper. Both callers now use the canonical selection
  selector with `returnType`; non-bundle selections are normalized singletons and a bundle derives
  the supported concrete formats from the catalogue. Added a regression assertion that the default
  bundled GSTR-3B filename remains the canonical PDF artifact. This is a structural
  single-source-of-truth correction; it does not change portal acquisition or download completion.
- Focused evidence: selector, all-formats, filename, and scope-model suites passed 4 files and 23
  tests. The existing all-formats tests already mutate-protect return-specific expansion, including
  GSTR-3B's PDF/data bundle; the new filename test proves its default consumes that selector.
- Required reviews: privacy review PASS; MV3 security review PASS. Neither found a changed
  permission, host, CSP, storage, portal boundary, target-binding, or download-evidence path.
- Gate: build passed at 1.04 MB; TypeScript passed; ESLint passed with zero warnings; Prettier
  passed repo-wide; package verification passed; `git diff --check` passed. Exact Vitest footer:

  ```text
       Tests  2800 passed (2800)
    Start at  03:44:55
    Duration  153.98s (transform 2.56s, setup 0ms, import 12.32s, tests 125.48s, environment 8ms)
  ```

- Learned / plan change: a type-level bundle name is not a safe source for concrete artifacts.
  Any user-visible or durable interpretation must take the selected return type into account. The
  next audit returns to lossy catches where a specific reason may be dropped before the user sees it.

This is the append-only cycle log for the continued catalogue-overhaul lane. Each cycle records
measured current state, one coherent improvement, its complete gate, and any evidence that changed
the next plan. Synthetic evidence is labelled; no entry implies an authenticated GST Portal run.

## Cycle 1 — pin stages at the emitted-signal boundary

- Window: 2026-08-26 01:07–01:14 IST.
- Picked: the mandatory staged-signal discrimination gap from independent review.
- Measured before: the durable-signal suite had two allowlist-acceptance loops but zero assertions
  mapping an input stage to its exact emitted token. Exact-symbol audit found two typed staged-error
  families: 9 target-review-clear stages and 10 single-period cleanup-checkpoint stages. Graphify
  was installed but this lane has no graph index, so the audit used exact symbol and type searches.
- Changed: added 19 parameterised assertions at the builder boundary. Production builders and
  runtime behavior are unchanged.
- Mutation proof: replacing the target-review builder with the valid constant
  `filed-returns-target-review-clear-failed:storage-key-missing` failed 8 of 9 new cases. Replacing
  the cleanup-checkpoint builder with the valid constant
  `single-period-cleanup-checkpoint-failed:bundle-missing` failed 9 of 10. In both mutations, the
  pre-existing allowlist acceptance remained green; this reproduces the missing coverage class.
- Gate: build passed at 997.37 kB; full Vitest passed 125 files and 2,106 tests; TypeScript passed;
  ESLint passed with zero warnings; Prettier passed repo-wide; package verification passed. Exact
  Vitest footer:

  ```text
       Tests  2106 passed (2106)
    Start at  01:09:53
    Duration  157.30s (transform 3.03s, setup 0ms, import 12.75s, tests 130.44s, environment 7ms)
  ```

- Checkpoint: `0013008 test(connectors): pin staged signal tokens`.
- Learned / plan change: the defect was broader than the nine-stage review-clear family because the
  ten-stage cleanup family had the same false assurance. No third typed `FailureStage`/staged-error
  builder exists in current source. Other dynamic safe-signal constructors are not claimed clean;
  they remain inputs to the later duplicate-fact and test-quality cycles.

## Cycle 2 — close Direction B product parity

- Window: 2026-08-26 01:15–01:29 IST.
- Picked: compare every explicit Direction B behavior with the packaged product and close or
  disposition every divergence.
- Measured before: prototype and product both had four steps, one select, one active scope, a 3→4
  control budget, focus restoration, nine rows, six non-interactive unsupported rows and zero 320px
  overflow. The prototype listed concrete artifact availability; the product disclosure reduced all
  supported rows to `available`. Direct Playwright input disproved a suspected keyboard difference:
  Enter on the prototype's focused select did not advance it either.
- Changed: supported rows now derive and display their concrete artifact labels from the same
  catalogue object. Bundle selections remain in the final file step because they are combinations,
  not additional portal artifacts. Removed the unused optional start-scope override and 25 lines of
  stale preset-era comments left after preset deletion. Added the full parity ledger in
  `design-lab/10-catalogue-overhaul/05-direction-b-parity.md`.
- Without-fix proof: the new render assertion failed once against the old disclosure, reporting
  expected `Monthly · available · Filed return (PDF) · Portal data (JSON)` and received the
  nine-row markup containing only `Monthly · available`.
- Packaged synthetic measurement after the change: step heights 624.76 / 693.55 / 676.76 /
  681.95px; 3 / 4 / 4 / 4 controls; select focused at every step; catalogue-open height 1,092.70px;
  zero overflow or clipped descendants; zero unsupported controls. The prototype's open catalogue
  was 1,405.84px. No portal action ran.
- Impeccable audit: deterministic detector returned `[]`; technical score 19/20. No P0/P1/P2
  finding remained in this cycle; assistive-technology qualification stays open for its dedicated
  cycle.
- Gate: build and package verification passed at 997.44 kB; full Vitest passed 125 files and 2,107
  tests; TypeScript passed; ESLint passed with zero warnings; Prettier passed repo-wide. Exact
  Vitest footer:

  ```text
       Tests  2107 passed (2107)
    Start at  01:26:03
    Duration  167.97s (transform 3.09s, setup 0ms, import 13.44s, tests 138.45s, environment 8ms)
  ```

- Checkpoints: `7382070 feat(panel): show catalogue artifact availability` and
  `afdb6aa refactor(panel): remove preset-era residue`.
- Learned / plan change: the prototype is a direction, not a specification to copy literally.
  Dynamic FY/month availability, real guarded run states, exact action copy and concrete-artifact
  semantics are intentional product improvements. The next cycle must enumerate product-only
  loading, empty, error and permission states rather than pretending the prototype covers them.

## Cycle 3 — make every catalogue and panel state honest

- Window: 2026-08-26 01:30–02:00 IST.
- Picked: the product-only state matrix — loading, empty/ready, unsupported, access denied,
  downloading, partial, complete, unavailable, blocked, error and cancelled — plus every declared
  catalogue periodicity and unsupported row.
- Measured before: the captured access-denied page was detected as a generic unsupported GST page,
  so the panel told the user to navigate to filed returns. A cancelled run had explicit reset copy
  in presentation state, but the inline renderer returned nothing for it. Focused without-fix proof
  failed three tests for access classification/presentation and two tests for cancelled-state
  visibility.
- Changed: added a neutral `gst-access-denied` context and `access-denied` presentation. The copy
  says only that the portal blocked the page; it does not guess whether authentication or
  authorization caused it. Trusted GST-origin context reporters are now distinct from actionable
  automation tabs: the error page can replace stale reduced context, but cannot be remembered or
  selected for navigation/download work. Cancelled recovery now renders its existing confirmation.
  Exact component tests cover the remaining run families and all nine catalogue decisions.
- Review rectification: privacy review rejected the first sign-in-only interpretation and then the
  remaining signed-in header. Both were replaced with neutral access-blocked copy. Security review
  found that the actionable-tab guard made the new state unreachable; handler tests now prove
  trusted reporting, `PACK_GET_CONTEXT` refresh, stale-context clearing, no actionable-tab
  overwrite and no script injection when the reporting content script is present. Final committed
  privacy verdict is CLEAN and security verdict is PASS.
- 320 × 900 synthetic component measurement: all 11 presentation families used production markup
  and CSS in Chromium, with document width 320px, zero clipped descendants and non-empty text.
  Final neutral access denial measured 426.66px tall with one action. The open catalogue measured
  1,018.70px tall, 9 rows, 6 explicit `not available in Pack` decisions and 0 row controls. This did
  not boot the extension or contact GST.
- Gate rectification: two full-suite attempts exposed the same pre-existing 40,000-digit workbook
  hot path crossing the five-second test boundary in different integration tests. The workbook had
  converted one already-unrepresentable canonical decimal through a huge `BigInt` only to discard
  its over-limit explanation. A validated single input longer than Excel's text limit now returns
  the same bounded nonnumeric fallback directly; multiple inputs still take the exact-sum path so
  cancellation can shorten a total. The two precision tests passed together, and all nine changed
  test files passed 223 tests before the full gate.
- Complete gate: build passed at 998.39 kB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,128 tests.
  The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
       Tests  2128 passed (2128)
    Start at  01:56:41
    Duration  187.68s (transform 5.53s, setup 0ms, import 21.44s, tests 143.43s, environment 20ms)
  ```

- Checkpoints: `4f42b74 feat(panel): make access states observable` and
  `dfc6112 perf(connectors): bound oversized workbook totals`.
- Learned / plan change: a context may be safe to observe without being safe to act on. The next
  accessibility cycle must qualify keyboard and screen-reader semantics on the actual panel and
  preserve this reporting/action separation; source ARIA alone is not assistive-technology proof.

## Cycle 4 — remount and announce each guided field

- Window: 2026-08-26 02:01–02:16 IST.
- Picked: keyboard and screen-reader sanity for the actual four-step guide at 320px.
- Measured before: every step reused one `<select>` node. Advancing changed its visible label and
  hint while the node remained focused; calling `.focus()` on that already-focused node produced no
  new focus event. The new boundary test failed because the second field was the same DOM element as
  the first.
- Changed: keyed the native select by the canonical step key. Each step now mounts a new field and
  the existing effect focuses it, producing a fresh focus event. Added permanent assertions for all
  four step announcements, labels, described-by hints, atomic polite status and focused field.
- Real Chromium keyboard/AX evidence at 320 × 900, using production component code and styles in a
  temporary local harness:
  - Tab and Enter advanced through all four steps; Back returned from Step 3 to Step 2 and focused a
    newly mounted Financial year field; six select-focus events were observed across forward/back
    navigation.
  - Chromium's accessibility tree exposed `Step 1 of 4` through `Step 4 of 4` as status nodes. The
    focused comboboxes were named Return, Financial year, Filed period and File, with their exact
    visible hints as accessible descriptions.
  - Select and final-action focus rings computed to 2px solid with a 2px offset.
  - Space opened Catalogue & limits; it exposed 9 list items, 6 explicit unsupported decisions and
    0 row controls, with 320px document width and no clipped descendant.
  - Shift+Tab returned to the final action and Enter submitted exactly FY 2025-26, full fiscal year,
    GSTR-3B, PDF. The synthetic live status confirmed receipt.
- Arrow-key boundary: Playwright delivered ArrowDown to the enabled focused native select with
  `defaultPrevented: false`, but macOS owns the native select popup and Playwright could not observe
  an option change inside that OS surface. Arrow option movement therefore remains unqualified; no
  custom keyboard interception was added and the control remains a native select.
- Impeccable detector: `[]`. Focused panel suite: 4 files and 41 tests before the final semantic
  assertion; the final interaction file passed all 8 tests.
- Complete gate: build passed at 998.40 kB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,130 tests.
  The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
       Tests  2130 passed (2130)
    Start at  02:14:04
    Duration  153.06s (transform 2.61s, setup 0ms, import 11.78s, tests 126.20s, environment 7ms)
  ```

- Checkpoint: `5f96e16 fix(panel): remount fields between guided steps`.
- Learned / plan change: browser AX evidence can qualify names, descriptions, roles and focus, but
  it is not a VoiceOver/NVDA announcement transcript. The next cycle moves to duplicate-fact and
  density review while retaining native-select Arrow movement as an explicit external uncertainty.

## Cycle 5 — make supported-return identity single-source and fail closed

- Window: 2026-08-26 02:17–02:32 IST.
- Picked: trace every runtime representation of supported-return identity back to the declarative
  catalogue before changing catalogue density.
- Duplicate removed: the portal-mechanics descriptor table repeated each supported return as its
  key, `returnType`, label, scope ID and signal slug. It now stores only portal mechanics; labels,
  scope IDs and slugs derive from the catalogue-backed functions. The descriptor file measured 74
  lines before and 67 after. Three other hand-written supported-return unions now use the
  catalogue-derived `FiledReturnsReturnType`.
- Security rectification: review found that broadening `ArtifactRequest.returnType` could make a
  future supported row fall through to the GSTR-3B acquisition path. Dispatch now names GSTR-2B,
  GSTR-1 and GSTR-3B explicitly and fails any forward-unknown runtime value as
  `unsupported-target` before portal inspection or action.
- Without-fix proof: with the explicit dispatch temporarily removed, the forward-unknown test
  failed with `TypeError: Cannot read properties of undefined (reading 'label')` instead of a
  blocked result. Restored code passed all 32 artifact-source tests and proved zero fetch and zero
  click for the unknown value.
- Line accounting: descriptor 74→67; artifact source 348→357 for the explicit fail-closed switch
  and type import; artifact validation 97→97; background trigger 1,041→1,042; regression test
  680→699. The safety boundary is intentionally explicit even though it offsets the net production
  line reduction.
- Privacy review: CLEAN. No logging, storage, identifiers, session material or capability claim
  changed. Security review: PASS after rectification; target binding, action identity, download
  evidence and background boundaries remain unchanged.
- Complete gate: build passed at 998.00 kB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,131 tests.
  The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
       Tests  2131 passed (2131)
    Start at  02:28:16
    Duration  192.64s (transform 4.49s, setup 0ms, import 23.31s, tests 147.09s, environment 12ms)
  ```

- Checkpoint: `1cfb6b9 refactor(connectors): derive supported return identity`.
- Learned / plan change: a type that expands from configuration needs runtime dispatch to remain
  explicitly fail closed. The next cycle returns to the measured 1,018.70px expanded catalogue and
  asks whether grouping can improve scanning without hiding any unsupported decision.

## Cycle 6 — group catalogue decisions at the 320px floor

- Window: 2026-08-26 02:33–02:45 IST.
- Picked: reduce the measured 1,018.70px expanded catalogue without removing a declared row,
  periodicity, artifact label or unsupported decision.
- Without-fix proof: the grouping assertion failed because the surface exposed only `9 rows` and
  repeated `not available in Pack` on every unsupported row. The failing expectation was
  `expected … to contain '3 available · 6 unavailable'`.
- Changed: the summary now reports 3 available and 6 unavailable. Two heading-separated lists show
  exact available artifacts and unavailable periodicities. The unsupported decision appears once
  as the group heading; its six rows remain reference-only list items and are arranged in two
  columns at the 320px floor. The catalogue still renders zero row controls.
- Real Chromium at 320 × 900 with production component code and CSS: expanded panel height measured
  810.83px versus the retained 1,018.70px baseline, a 207.87px (20.4%) reduction. The catalogue
  itself measured 428.95px; the document remained exactly 320px wide with no clipped descendant.
  Chromium exposed headings `Available 3` and `Not available in Pack 6`, lists of 3 and 6 items,
  all exact artifact/periodicity text, two 137px unsupported columns and zero links, buttons or
  selects inside the catalogue.
- Impeccable detector: two advisory font-size findings at unchanged `panel.css` lines 39 and 85;
  neither intersects this diff. The added heading reuses the existing documented 0.75rem step.
- Privacy review: CLEAN; grouping preserves the explicit Pack limitation and introduces no claim,
  identifier, logging, storage or session-data change. Security review found no affected security
  surface: selection, messages, background/content behavior and downloads are unchanged.
- Complete gate: build passed at 998.69 kB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,132 tests.
  The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
       Tests  2132 passed (2132)
    Start at  02:40:54
    Duration  212.43s (transform 6.79s, setup 0ms, import 26.21s, tests 162.33s, environment 10ms)
  ```

- Checkpoint: `8e51754 feat(panel): group catalogue availability`.
- Learned / plan change: grouped limitation copy can be both more explicit and materially shorter
  when list semantics retain every individual decision. The next cycle resumes the generic-reason
  audit rather than compressing the default guide further.

## Cycle 7 — retain exact artifact-checkpoint clear reasons

- Window: 2026-08-26 02:46–03:06 IST.
- Picked: continue the generic-reason audit at `clearArtifactAcquisitionCheckpoints`, whose 16
  fail-closed exits and caught operations all returned the same `{ state: "blocked" }` result. The
  target-review boundary consequently persisted one generic clear-failure signal and message.
- Measured before: a storage-read discrimination test failed with
  `expected { state: 'blocked' } to deeply equal { reason: 'storage-read-failed', state: 'blocked' }`.
  The same missing reason shape covered intent, checkpoint validity, browser-download lookup,
  target correlation, danger, size, cancellation, download state and session-storage removal.
- Changed: a closed 16-value GST connector vocabulary now travels through the discriminated
  cancellation result, a fixed durable signal, canonical user-visible copy and the retained target
  review. Exception text and browser or portal values never enter the signal or message. Previous
  reason tokens are replaced rather than accumulated.
- Security rectification: the first persistence form could add two signals to an otherwise valid
  31-signal review, cross the 32-signal cap and replace its artifact-ownership marker with a generic
  rejection record. A second cancellation could then skip checkpoint clearing and remove the
  durable guard. Enrichment now uses strict parsing and retains the original valid review unchanged
  if the diagnostic cannot fit. A two-call regression proves both attempts re-enter clearing,
  neither removes or overwrites the review, and the artifact marker remains.
- Discrimination evidence:
  - Collapsing the producer result to `storage-read-failed` caused 15 named exit tests to fail; only
    the genuine storage-read row stayed green.
  - Collapsing the signal builder to `storage-read-failed` caused 31 failures: 15 boundary
    propagation rows, 15 explicit builder-string rows and the closed-contract uniqueness check.
  - Restoring the unsafe over-cap canonical fallback made the first two-call response `blocked`
    where the retained review test expected `user-action-required`.
- Production line accounting: artifact acquisition state 651→669; target review 1,534→1,570; new
  clear-reason vocabulary 0→27; durable signals 710→717; durable status 451→518. The added lines are
  the bounded diagnostic contract, canonical messages and fail-closed cap handling; clearing and
  completion permissions are unchanged.
- Privacy review: CLEAN. Security review: PASS. Both are hash-bound to
  `7f974fc34a89cf371630d53192caba3a00fadb1b`. No sensitive values, logging, public capability claim,
  permission, CSP, content, dependency, target-binding or download-completion behavior changed.
- Complete gate: build passed at 1.00 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,181
  tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
       Tests  2181 passed (2181)
    Start at  03:02:10
    Duration  153.83s (transform 2.55s, setup 0ms, import 11.33s, tests 128.81s, environment 7ms)
  ```

- Checkpoint: `7f974fc fix(recovery): retain checkpoint clear reasons`.
- Learned / plan change: diagnostic enrichment itself is a durable-state mutation and must be
  tested at the storage cap across repeated user actions. The next cycle continues the duplicate
  and generic-reason audit on an untouched boundary, starting from readers of durable state.

## Cycle 8 — distinguish unavailable selected-artifact progress from missing

- Window: 2026-08-26 03:07–03:38 IST.
- Picked: audit an untouched durable-state reader. `readPersistedArtifactProgress` caught every
  session-summary failure as `null`; the canonical reader also removed malformed progress and
  returned `null`. The selected-artifact runner interpreted both as no prior artifacts and could
  continue toward another portal action.
- Measured before: the new read-failure case rejected with `synthetic session read failure` instead
  of a blocked response. The malformed-result case progressed until it failed with
  `TypeError: Cannot read properties of undefined (reading 'ok')`; neither path produced an
  actionable, durable reason.
- Changed: one connector-owned vocabulary distinguishes `malformed-summary`,
  `storage-read-failed` and `storage-write-failed`. The session boundary returns missing only when
  the key is genuinely absent. All other states become fixed canonical signals/messages with
  `canResume: false`, and the selected-artifact runner returns before page preparation, visible
  scope checks or download triggering.
- Privacy rectification: the first fail-closed version retained the unknown malformed object so it
  could remain a guard. Privacy review correctly found that unconstrained input could contain
  sensitive values. The final version atomically overwrites the same key with a parser-validated,
  canonical blocked `FiledReturnsFlowSummary`; it adds no key, sentinel or field. The raw input is
  gone, and a second read recognizes the fixed signal and stays blocked. If redaction cannot be
  written, the caller reports `storage-write-failed` and still performs no portal action.
- Discrimination evidence:
  - Collapsing malformed/read/write back to `null` caused three tests to receive `null`; the
    separate genuinely missing row remained green.
  - Collapsing the signal builder to the read reason caused five failures: malformed and write
    boundary rows, two emitted-signal rows and the durable-vector uniqueness check.
  - Removing the canonical malformed replacement failed the redaction test because the stored
    value remained `{ unknown: "synthetic noncanonical value" }` instead of a blocked summary.
- Production line accounting: artifact progress 278→338; selected-artifact runner 928→940; session
  summary boundary 72→113; new canonical reason vocabulary 0→28; durable signals 717→722; durable
  status 518→540. The added code makes the prior implicit missing/error distinction explicit and
  keeps user copy derived from canonical signals.
- Privacy review: CLEAN after rectification and exact-head bound to
  `259163a61c138648497a9d3fe47c8b7c671f1ca0`. Security review: PASS on the stable source snapshot;
  exact-head binding recorded in `VALIDATION.md`. No dependency, manifest, permission, CSP,
  target-binding or download-completion behavior changed.
- Complete gate: build passed at 1.00 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,193
  tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
       Tests  2193 passed (2193)
    Start at  03:33:10
    Duration  148.44s (transform 2.43s, setup 0ms, import 10.84s, tests 124.04s, environment 7ms)
  ```

- Checkpoint: `259163a fix(recovery): block unavailable artifact progress`.
- Learned / plan change: redaction and durable blocking are not competing goals when unknown input
  is replaced atomically by an existing canonical record. The next cycle continues the reader
  audit and asks whether any other malformed durable record is deleted before a safe replacement
  or explicit user-visible disposition exists.

## Cycle 9 — retain filename uncertainty through canonical reopen

- Window: 2026-08-26 03:39–04:04 IST.
- Picked: continue the duplicate/error-boundary audit at the post-completion filename check. A
  rejected browser query, a missing exact item and a completed item without a filename all became
  the same no-warning result as an exact requested-name match. The already-proven download stayed
  complete, but the user-facing result overstated what Pack knew about its saved name.
- Disproved candidate: the durable terminal-download reconciler also catches browser search
  failures. That path retains its exact-ID `download-observing` review and retries reconciliation
  on later popup reads; it neither marks completion nor grants a fresh download action, so no
  action-safety change was made there.
- Changed: the canonical filename comparison now distinguishes `matched`, `overridden` and
  `unavailable`. Direct artifacts and selected ZIPs retain exact-ID, safe, non-empty completion
  while emitting closed reasons for missing filename, missing exact item or browser-query failure.
  Filename warnings are also preserved when ZIP staging cleanup needs attention.
- Review rectification: security review found the four new reasons were initially absent from the
  durable allowlist, which could remove a valid completion on persistence. Privacy review then
  found that canonical reopen retained the signal but dropped its warning, first for completed
  summaries and targets and then for the partial selected-ZIP early-return branch. The final
  version centralizes six fixed filename-outcome signals, allows the pre-existing direct override,
  reconstructs fixed warning copy for complete, partial and target states, and accepts only the
  exact previous canonical target message as migration input. No filename, path or caught error is
  persisted or interpolated.
- Discrimination evidence:
  - The initial observable tests failed four cases: direct missing filename plus ZIP missing item,
    missing filename and search rejection.
  - Mutating missing filename back to `matched` failed two direct/ZIP cases. Collapsing all three
    ZIP reasons to one token failed the other two parameter rows.
  - Removing the four initial allowlist entries failed exactly four persistence/reopen cases with
    `expected null not to be null`.
  - Before canonical-copy reconstruction, 13 tests failed: six reopened summaries lost warnings,
    six target messages lost warnings and direct override was rejected. The remaining partial-path
    early return then failed exactly two partial ZIP reopen cases.
- Production line accounting: artifact download 224→235; filename comparison 38→42; staged ZIP
  507→537; durable signals 722→734; durable status 540→580. The added code is a bounded diagnostic
  and canonical-copy contract; download completion and retry authority are unchanged.
- Review: privacy CLEAN/PASS and security PASS, both exact-commit bound to
  `94b45dcaca3d926a5433e9a700a578bbe15a072c`. No manifest, permission, host, CSP, dependency,
  telemetry, sensitive-data, target-binding or completion-evidence change was found.
- Complete gate: build passed at 1.01 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,216
  tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
   Test Files  125 passed (125)
        Tests  2216 passed (2216)
     Start at  04:00:44
     Duration  155.40s (transform 2.84s, setup 0ms, import 13.34s, tests 126.71s, environment 8ms)
  ```

- Checkpoint: `94b45dc fix(downloads): retain filename uncertainty`.
- Learned / plan change: a fixed durable signal is incomplete unless every canonical renderer that
  can reopen it preserves the same actionable caution, including special-case early returns. The
  next cycle audits other post-completion diagnostic families for allowlist-plus-renderer agreement.

## Cycle 10 — preserve confirmed fiscal-year ZIP copy after reopen

- Window: 2026-08-26 04:05–04:11 IST.
- Picked: apply Cycle 9's producer/allowlist/renderer agreement check to the full-fiscal-year ZIP
  signal family.
- Measured before: the canonical summary renderer used
  `includes("full-fiscal-year-zip-download")` to select review copy. The positive
  `full-fiscal-year-zip-downloaded` token also contains that substring, so a validated complete run
  reopened with `Pack could not confirm the final fiscal-year ZIP` despite retaining its confirmed
  delivery signal. Existing agreement tests stopped before canonical persistence and did not catch
  the copy inversion.
- Without-fix proof: the new persistence/reopen test failed one case. Expected complete copy was
  replaced by the final-ZIP review sentence while `status: complete` and
  `full-fiscal-year-zip-downloaded` both remained present.
- Changed: the review matcher now uses the actual negative/observing family prefix
  `full-fiscal-year-zip-download-`. It still covers ID missing/not found, search unavailable,
  started, state unknown and unconfirmed signals; it excludes only the positive
  `full-fiscal-year-zip-downloaded` token. No state, signal, user action, retry or completion guard
  changed. Production line count remains 580→580.
- Review: privacy CLEAN/PASS and security PASS, both exact-commit bound to
  `4979c69f25090b083019b11096a9fe041f649d92`. Reviewers confirmed closed durable parsing precedes
  copy selection and every current negative signal still maps to review.
- Complete gate: build passed at 1.01 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,217
  tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
   Test Files  125 passed (125)
        Tests  2217 passed (2217)
     Start at  04:08:06
     Duration  156.13s (transform 2.86s, setup 0ms, import 13.54s, tests 127.21s, environment 8ms)
  ```

- Checkpoint: `4979c69 fix(recovery): preserve confirmed zip copy`.
- Learned / plan change: prefix families need delimiter-aware matching; a positive terminal token
  can otherwise be swallowed by its negative sibling. The next cycle checks other broad
  `includes`/`startsWith` renderer predicates against their positive terminal siblings.

## Cycle 11 — preserve no-artifacts fiscal-year copy after reopen

- Window: 2026-08-26 04:12–04:18 IST.
- Picked: continue the canonical producer/allowlist/renderer audit at the positive absence branch.
  A completed fiscal-year run can intentionally create no ZIP when no filed-return artifacts are
  available, but canonical reopen discarded that fact and selected the generic completed-download
  sentence.
- Measured before: the new persistence/reopen test failed 1 of 116 session-boundary cases. It
  retained `status: complete`, `flowStep.state: downloaded` and
  `full-fiscal-year-no-zip-artifacts`, but received
  `Pack completed the local filed-return download for the saved fiscal-year run.` instead of copy
  saying that no ZIP was created.
- Changed: the canonical renderer now selects a fixed `full-year-no-artifacts` message only when
  the summary is complete and carries the exact no-artifacts signal. Interrupted, active,
  needs-action, cleanup-failed, ZIP-review, positively-not-filed and target-review branches remain
  earlier and therefore fail closed. No state, signal, user action, persistence, cleanup, retry or
  completion authority changed.
- Production line accounting: durable status 580→586. The session persistence/reopen regression
  test is 1,162→1,191 lines.
- Review: privacy CLEAN/PASS and security PASS, both exact-commit bound to
  `6f05ed0be4f8021b72e67b9cdfa05d28764181b9`. Reviewers confirmed the fixed copy contains no
  taxpayer, portal, session, path, filename or exception value, and that every blocked recovery
  class retains precedence.
- Complete gate: build passed at 1.01 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,218
  tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
   Test Files  125 passed (125)
        Tests  2218 passed (2218)
     Start at  04:14:22
     Duration  149.25s (transform 2.43s, setup 0ms, import 10.91s, tests 124.67s, environment 7ms)
  ```

- Checkpoint: `6f05ed0 fix(recovery): preserve no-artifacts copy`.
- Learned / plan change: status alone is not sufficient canonical copy authority; a terminal
  absence signal can materially narrow what “complete” means. The next cycle audits other generic
  terminal branches for exact positive or absence signals that are retained but not rendered.

## Cycle 12 — retain fixed portal failure causes through full-year reopen

- Window: 2026-08-26 04:19–04:32 IST.
- Picked: compare the target-level canonical cause with the session-level full-year renderer. Live
  ledger summarisation already reconstructed fixed system-error, scheduled-downtime and
  access-denied/expired-session copy, but persistence saw `full-fiscal-year-run-needs-action` first
  and replaced every cause with generic recovery prose on reopen.
- Measured before: the three new persistence rows all failed while 116 existing session-boundary
  cases passed. Each retained its exact portal signal but received
  `Pack needs an explicit recovery action before continuing the saved fiscal-year run.` instead of
  the fixed portal sentence.
- Changed: one shared closed mapping now owns the three existing portal-cause message keys for
  target and summary rendering. Only blocked/partial full-year `run-needs-action` summaries consult
  it; complete and cancelled outcomes cannot be relabelled. No new copy, signal, state, user action,
  field or runtime authority was introduced.
- Review rectification: privacy review found that an allowlisted mixed vector could also carry
  cleanup failure, final-ZIP uncertainty or target review, and the first implementation would hide
  those stronger instructions behind the portal cause. The final classifier centralizes the
  existing cleanup/ZIP projection, then gives cleanup/ZIP and target review precedence inside the
  mixed `run-needs-action` path while preserving the prior order for every non-mixed path.
- Discrimination evidence:
  - Without portal-cause projection, 3 of 119 session-boundary rows failed with generic recovery
    copy replacing the three exact causes.
  - Moving portal projection ahead of stronger recovery after rectification failed all three mixed
    rows: cleanup, unconfirmed ZIP and target review each reopened with the system-error sentence.
    Restoring the committed order passed all three.
- Production line accounting: durable status 586→606; session persistence/reopen tests
  1,191→1,281. The production increase is the shared cause/recovery classification; the larger test
  increase is the six-state isolated-plus-mixed durable matrix.
- Review: privacy CLEAN/PASS after rectification and security PASS, both exact-commit bound to
  `0817a1081ec3fdb8f94fc830514dd17100b7830a`. No sensitive data, portal payload, storage widening,
  completion/retry authority, background/download behavior, manifest, permission, host, CSP or
  dependency change was found.
- Complete final gate: build passed at 1.01 MB; package verification passed; TypeScript passed;
  ESLint passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and
  2,224 tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest
  footer:

  ```text
   Test Files  125 passed (125)
        Tests  2224 passed (2224)
     Start at  04:27:30
     Duration  150.18s (transform 2.57s, setup 0ms, import 10.91s, tests 125.60s, environment 7ms)
  ```

- Checkpoint: `0817a10 fix(recovery): retain portal failure cause`.
- Learned / plan change: retaining a specific reason is unsafe unless stronger coexisting recovery
  evidence is ordered first. The next cycle audits other reason projections not just for missing
  copy, but for contradictory valid signal combinations that can suppress a stricter instruction.

## Cycle 13 — qualify legacy full-year delivery copy

- Window: 2026-08-26 04:32–04:45 IST.
- Picked: audit the three independently composed canonical fragments: base durable state, derived
  summary output and filename outcome. A legacy-compatible complete full-year summary may retain
  only `full-fiscal-year-complete`; without either confirmed ZIP delivery or explicit no-artifacts
  evidence, the generic renderer still claimed the local download completed.
- Measured before: the existing terminal-aggregate persistence row accepted the legacy summary,
  then the new copy assertion failed 1 selected test because it received
  `Pack completed the local filed-return download for the saved fiscal-year run.` The compatibility
  state remained valid; only its claim exceeded its evidence.
- Changed: a full-year-scope-only complete ambiguity key now says the run completed but the final
  ZIP download was not confirmed. It preserves the summary, status, state and signals and grants no
  retry. Confirmed ZIP and explicit no-artifacts outcomes remain more specific.
- Composition rectification: the first implementation still allowed a filename-outcome fragment to
  append `Pack completed the download` to both legacy ambiguity and explicit no-artifacts copy.
  Filename detail is now omitted for those two non-delivery keys only. Confirmed direct, selected
  ZIP and fiscal-year ZIP outcomes retain their warnings.
- Scope rectification: security review found the first ambiguity classifier trusted an allowlisted
  full-year token without checking scope. The final classifier receives canonical scope; both
  legacy ambiguity and no-artifacts branches require `FULL_FISCAL_YEAR`. A valid March completion
  carrying an extra full-year token remains March copy and retains its filename warning.
- Discrimination evidence:
  - Without the ambiguity key, 1 selected test received the generic completed-download claim.
  - Before filename suppression, a legacy ambiguity row produced two contradictory sentences:
    unconfirmed final ZIP followed by completed download.
  - Before scope binding, 1 selected valid March completion reopened as a saved fiscal-year run and
    lost its filename warning.
  - Removing no-artifacts filename suppression failed both overridden and unavailable rows; each
    appended completed-download language after `No ZIP was created`. Restoring it passed both.
- Production line accounting: durable status 606→625; session persistence/reopen tests
  1,281→1,378.
- Review: privacy CLEAN/PASS after one Medium rectification and security PASS after one WARN
  rectification, both exact-commit bound to
  `bcc86f6da8ffd6fc0443ceb163314d38762a2344`. No sensitive data, storage widening, state/action,
  retry/completion authority, background/download behavior, manifest, permission, host, CSP or
  dependency change was found.
- Complete final gate: build passed at 1.01 MB; package verification passed; TypeScript passed;
  ESLint passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and
  2,228 tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest
  footer:

  ```text
   Test Files  125 passed (125)
        Tests  2228 passed (2228)
     Start at  04:41:23
     Duration  151.32s (transform 2.55s, setup 0ms, import 11.50s, tests 124.68s, environment 7ms)
  ```

- Checkpoint: `bcc86f6 fix(recovery): qualify legacy full-year delivery`.
- Learned / plan change: signal allowlisting is not scope binding, and later diagnostic fragments
  cannot be allowed to supply evidence the base status lacks. The next cycle audits other
  full-year-only summary keys for cross-scope canonical injection.

## Cycle 14 — scope all full-year canonical status copy

- Window: 2026-08-26 04:46–04:53 IST.
- Picked: follow Cycle 13's scope-binding finding through the remaining full-year-only summary keys.
  Durable parsing allowlists each signal but does not reject every cross-scope combination, so a
  single-period summary could carry a foreign full-year token without becoming malformed.
- Measured before: all five selected cross-scope rows failed. Resume confirmation, interrupted run,
  active run and final-ZIP review each replaced March recovery copy with full-year-specific copy;
  a foreign `full-fiscal-year-zip-downloaded` token changed ordinary single-period cleanup into
  confirmed final-fiscal-year-ZIP cleanup.
- Changed: canonical scope is derived once. Resume, interrupted, run-needs-action, active,
  no-artifacts, legacy delivery ambiguity, final-ZIP review and final-ZIP-delivered cleanup now use
  their full-year key only when the canonical period is `FULL_FISCAL_YEAR`. Scope-neutral cleanup
  continues to classify single-period staging safely.
- Dependency removed: summary-level portal-cause copy previously lived only inside the
  full-year-run-needs-action branch. Portal system error, scheduled downtime and
  access-denied/expired-session are now reconstructed independently for any blocked/partial
  summary, after cleanup, not-filed and target-review precedence.
- Discrimination evidence:
  - Before scope binding, 5 selected rows failed with full-year resume/interrupted/active/ZIP-review
    or ZIP-delivered-cleanup copy replacing the expected single-period sentence.
  - Before independent portal projection, 3 selected single-period rows retained their exact portal
    signal but received generic March recovery copy instead of the fixed cause.
- Production line accounting: durable status 625→642; session persistence/reopen tests
  1,378→1,438.
- Review: privacy CLEAN/PASS and security PASS, both exact-commit bound to
  `880a6b73ac9da025bca135847039ad67fc019823`. Reviewers confirmed canonical-scope authority,
  fail-closed cleanup/not-filed/target-review precedence and no sensitive data, storage, runtime,
  download, manifest, permission, host, CSP or dependency drift.
- Complete gate: build passed at 1.01 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,236
  tests. The known missing TypeScript source-map warning remained non-failing. Exact Vitest footer:

  ```text
   Test Files  125 passed (125)
        Tests  2236 passed (2236)
     Start at  04:48:54
     Duration  156.21s (transform 2.87s, setup 0ms, import 13.90s, tests 126.55s, environment 8ms)
  ```

- Checkpoint: `880a6b7 fix(recovery): scope full-year status copy`.
- Learned / plan change: canonical signal vocabularies still need scope-aware consumers; validation
  cannot enumerate every individually valid but cross-domain combination. The next cycle audits
  target-level status rendering for the inverse problem: scope-neutral reasons hidden behind an
  overly specific target status.

## Cycle 15 — keep unresolved target filename copy neutral

- Window: 2026-08-26 04:54–05:10 IST.
- Picked: canonical target copy appended the completed-download filename sentence even when the
  target remained in review. A filename-outcome token describes a browser observation, not proof
  that a completed file belongs to this target.
- Measured before: the initial unconfirmed target-review regression failed because its cautious
  base sentence was followed by `Pack completed the download`. A first implementation attempted
  to use one browser ID plus completed/non-empty tokens as permission for that sentence.
- Review rectification: security correctly rejected the browser-only shortcut because the renderer
  lacks validated scope/action-bound diagnostics. Privacy identified target/action/start/diagnostic
  contradiction vectors that also passed it. The final rule uses completion wording only for the
  canonical `downloaded` target status; all unresolved statuses retain neutral filename cautions.
- Claim rectification: the first neutral override sentence still said Pack recorded a different
  name for the target. Privacy identified both implied ownership and implied filename retention.
  The final sentence explicitly says Pack could not verify that any file belongs to the target;
  it records no raw filename and does not claim one was retained.
- Discrimination evidence: temporarily restoring completion-form copy for unresolved targets failed
  all 7 selected regressions: overridden/unavailable filename outcomes and five connector
  target/action/start/diagnostic contradictions. Each received a completed-download sentence after
  an unverified-download base sentence. Restoring the fix passed all 7.
- Production line accounting: durable status 642→661; full-year ledger tests 1,226→1,274.
- Review: privacy CLEAN/PASS after two Medium rectifications and security PASS after one WARN,
  both exact-commit bound to `2aa4324eb6f13b88d40f20f2e9380d4c7a87e8d0`. No status, state,
  action, target binding, retry, cleanup, persistence, download API, permission, host, CSP or
  dependency behavior changed.
- Complete final gate: build passed at 1.01 MB; package verification passed; TypeScript passed;
  ESLint passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and
  2,243 tests. The known missing TypeScript source-map warning remained non-failing. Exact footer:

  ```text
   Test Files  125 passed (125)
        Tests  2243 passed (2243)
     Start at  05:05:31
     Duration  148.97s (transform 2.44s, setup 0ms, import 11.30s, tests 124.24s, environment 7ms)
  ```

- Checkpoint: `2aa4324 fix(recovery): qualify target filename copy`.
- Learned / plan change: a completion-looking diagnostic fragment must not bypass the canonical
  target status. The next cycle audits summary-level composition where a positive not-filed result
  can coexist with an individually allowed filename signal.

## Cycle 16 — remove filename completion claims from not-filed summaries

- Window: 2026-08-26 05:10–05:16 IST.
- Picked: a positively not-filed single-period result is a valid completed selection with
  `candidate-not-found` state and no download diagnostic. Allowlisted filename tokens could still
  append completed-download prose to that explicit absence result.
- Measured before: all 6 direct/ZIP filename variants passed persistence but failed the reopened
  message assertion. The received value began with the exact not-filed sentence and then appended
  `Pack completed the download`, followed by the overridden/unavailable filename caution.
- Changed: the existing non-delivery filename suppression also recognizes the canonical
  `not-filed` message key. It adds no new copy and preserves status, state, completed periods and
  safe signals. Confirmed direct/ZIP filename warnings and partial-ZIP warnings remain unchanged.
- Clarity review: Impeccable's clarify guidance and the local design contract favor the existing
  precise portal-reported absence sentence. Removing contradictory prose is sufficient; no new
  control, instruction, visual treatment or recovery action was introduced.
- Discrimination evidence: the six selected persistence/reopen rows failed before the one-line
  classifier addition and passed after it. Focused coverage passed 2 files / 192 tests.
- Production line accounting: durable status 661→662; session persistence/reopen tests
  1,438→1,469.
- Review: privacy CLEAN/PASS and security PASS, both exact-commit bound to
  `96127043786637410a326c44fbd4b80e02d1f6a0`. No storage shape, target binding, status/state,
  retry/completion authority, download API, manifest, permission, host, CSP or dependency drift.
- Complete gate: build passed at 1.01 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,249
  tests. The known missing TypeScript source-map warning remained non-failing. Exact footer:

  ```text
   Test Files  125 passed (125)
        Tests  2249 passed (2249)
     Start at  05:12:41
     Duration  211.84s (transform 8.30s, setup 0ms, import 29.96s, tests 148.86s, environment 15ms)
  ```

- Checkpoint: `9612704 fix(recovery): suppress not-filed filename claims`.
- Learned / plan change: terminal selection completion is not always file delivery. With those
  claims separated, the next cycle consolidates the duplicated filename-family classifier while
  preserving the confirmed/unresolved wording and override precedence exactly.

## Cycle 17 — consolidate filename classification without changing copy

- Window: 2026-08-26 05:17–05:26 IST.
- Picked: the confirmed and unresolved filename helpers repeated the same overridden/unavailable
  family checks. Their safety difference belongs in the selected sentence, not in two classifiers
  that can drift independently.
- Measured before: all 19 filename-focused cases passed on the pre-refactor source, including four
  newly covered ZIP-neutral variants and two mixed-signal precedence cases. The production file
  had 662 lines and two classifiers with the same overridden-first ordering.
- Changed: one local helper accepts an explicit `download` or `unresolved-target` presentation
  context. Canonical target status still selects that context; summary non-delivery suppression
  remains outside the helper. All four sentences are byte-for-byte unchanged. Canonical signal
  arrays now test membership directly instead of nesting two equivalent `some` calls.
- Integration correction: TypeScript found the migration-only third caller after the initial
  signature change. It now supplies the same download presentation context explicitly and still
  consumes only truthiness before its unchanged exact-message comparison.
- Equivalence/discrimination evidence: focused ledger/session coverage passed 198 tests after
  reduction. A mutation making unavailable-name win over overridden-name failed both mixed-signal
  rows: expected the different-name warning, received the unavailable-name warning. Restoring the
  original precedence passed both.
- Production line accounting: durable status 662→645 (17 lines removed); full-year ledger tests
  1,274→1,306. No module was deleted or import edge changed. The source-module scan, including
  WXT/config and HTML entry roots, found 177 source modules and zero zero-importer candidates.
- Review: privacy CLEAN/PASS and security PASS on exact source head
  `ab82c8a9c09f27e7bca2062f6a0943ff42ca8995`. Both confirmed sentence, precedence, target-mode,
  summary-suppression and historical-migration equivalence; no authority or MV3 drift.
- Complete gate: build passed at 1.01 MB; package verification passed; TypeScript passed; ESLint
  passed with zero warnings; Prettier passed repo-wide; full Vitest passed 125 files and 2,255
  tests. The known missing TypeScript source-map warning remained non-failing. Exact footer:

  ```text
   Test Files  125 passed (125)
        Tests  2255 passed (2255)
     Start at  05:21:58
     Duration  169.84s (transform 3.74s, setup 0ms, import 18.09s, tests 133.72s, environment 9ms)
  ```

- Checkpoint: `ab82c8a refactor(recovery): share filename classification`.
- Learned / plan change: cached-message validation is another consumer of these strings. The next
  end-to-end audit follows historical ledger copy through validation, storage reads and summary
  reconstruction, without weakening identity or download-evidence checks.
- Pacing correction: checkpoint rounds 15–17 were shorter than the requested 45–75-minute cycles.
  Their real timestamps remain recorded; they are not evidence that the requested cadence was
  met. The next cycle is a deeper bounded compatibility audit rather than another short copy edit.

## Cycle 18 — historical filename recovery across durable boundaries

- Window: 2026-08-26 05:27–06:12 IST; source checkpoint at 05:56 IST, followed by independent
  evidence review, synthetic narrow-surface checks and read-only next-cycle sizing.
- Picked: follow the filename-copy change through exact ledger validation, current-state reads,
  canonical session persistence/reopen, explicit recovery and local-data clearing.
- Measured before: exact pre-Cycle-15 unresolved filename caches made otherwise-valid ledger reads
  return null. With the ledger as the only recovery record, current-state recovery disappeared and
  broad local clearing returned success instead of the existing unresolved-recovery refusal.
  After restoring cache admission, session reconstruction independently reintroduced completion
  wording. A blocked-only copy fix still missed partial/running/cancelled aggregate states.
- Changed: one exact historical derived-message allowance, without rewriting the stored ledger;
  outward copy remains reconstructed from canonical fields. Filename presentation now uses the
  existing canonical message key, not aggregate status. Confirmed cleanup keys and complete keys
  retain completion-form copy; a single-period partial key additionally requires the existing
  confirmed ZIP evidence predicate. Explicit no-delivery suppression is unchanged.
- Review/rectify: privacy found the aggregate-status bypass, measured by 18 failing non-blocked
  rows. Security found that a partial key alone was not delivery proof; 16 negative partial-ZIP
  rows failed before the predicate was required. The original marker-only partial fixture is
  retained with neutral copy, alongside separately evidenced positive controls. Neither fix
  changes status, scope, target binding, retry/manual authority or the evidence predicate itself.
- Guard coverage: literal historical messages, all six filename variants, mixed-family precedence,
  edited/prefixed/appended text, whitespace, wrong period/family, absent/unknown/duplicate/over-cap
  signals, wrong target/scope/plan, mismatched diagnostics, unsupported positive status claims,
  stale/wrong recovery identity, final-click absence, interrupted targets and explicit retry.
  Current-state and clear tests assert storage, ZIP and portal-action non-effects.
- Final discrimination: removing exact cache admission failed 34 selected read/current-state/clear
  cases; restoring unconditional completion filename copy failed 62 cases, with 12 controls
  passing. Forcing neutral copy for every outcome failed 12 proven-delivery controls while 30
  unconfirmed controls passed. All mutations were restored byte-for-byte to the gated source;
  the restored four-file focused run passed 382 tests and the later session-only run passed 182.
- Historical scope: distinct blocked/failed keys preceded the filename suffix introduction, so
  no generic-base-plus-suffix compatibility was invented for those statuses. An in-memory
  source-module comparison across nine prior revisions accepted all 1,944 derived-cache input
  combinations per revision. This is a cache-message check using current dependencies, not a
  historical-build or whole-ledger qualification.
- Measured line accounting: durable status 645→656; recovery tests 1,665→2,181; session boundary
  tests 1,469→1,681; local-data tests 1,334→1,442. This is a safety fix with 11 added production
  lines, not a reduction claim. No module or import edge changed.
- Review: privacy CLEAN/PASS and security PASS on exact source checkpoint
  `fbfb8964aeb27a8232f1f9cf0fd46894eb00ed6c`. A pre-existing aggregate/target consistency
  limitation remains explicitly separate from those approvals.
- Gate: the first full run was intentionally stopped with exit 130 when review found the
  aggregate bypass; it is not counted as a pass. The final build, TypeScript, zero-warning ESLint,
  repo-wide Prettier and package verification passed at 1.01 MB. Full Vitest passed 125 files and
  2,364 tests, 109 more than the prior checkpoint. Known synthetic workflow/review-gate stderr
  and the missing TypeScript source-map warning remained non-failing. Exact footer:

  ```text
   Test Files  125 passed (125)
        Tests  2364 passed (2364)
     Start at  05:52:21
     Duration  159.46s (transform 2.87s, setup 0ms, import 14.26s, tests 130.41s, environment 7ms)
  ```

- Preflight recheck: refused the in-progress dirty tree. All five changed paths were inspected
  and lane-owned; no unrelated edit was staged. This recheck is not recorded as a preflight pass.
- Checkpoint: `fbfb896 fix(recovery): retain exact historical filename recovery`.
- Learned / next audit: aggregate completion and unresolved target state are not uniformly
  classified at every read boundary. The corrected tests distinguish legacy-plan read rejection,
  canonical-plan read admission and later session-summary rejection. Next-cycle sizing asks
  whether current producers can create that inconsistency before proposing a recovery-safe fix.
  Running/cancelled session summaries also retain their pre-existing generic recovery base copy;
  this cycle changes filename context only. No live or release qualification is claimed.
- Producer sizing result: the read-only audit found no current transition from a coherent ledger
  that produces a complete aggregate with an unresolved target. Target updates/completion checks
  derive completion from terminal targets; restaging/retry/reconciliation move the aggregate back
  to blocked/running. Some readers can preserve already-inconsistent input. Treat the follow-up as
  boundary-invariant hardening, not an established normal-workflow corruption incident; historical
  provenance and arbitrary concurrency remain unproven.
- Narrow-surface check: used the existing Playwright library in an isolated packaged Chromium
  session, with all page network requests blocked and only synthetic message responses. No new
  package was installed. At 320×900 the old override sentence measured 117.58px high; the new
  override caution measured 134.38px, adding one 16.80px line. The unavailable-name caution was
  100.78px. All four old/new/dense fixtures kept document width 320px and had zero measured clipped
  regions. Foreground, settled screenshots confirmed readability after scrolling. Saved-run,
  diagnostic and catalogue disclosures opened and closed with keyboard input; no recovery action
  was executed. The temporary browser/profile was closed and removed.
- Plan change from visual evidence: the twelve-period fixture showed `12 needs review` in the pack
  card but `1 needs review` plus eleven waiting periods in the detailed list. This normal-shaped
  presentation contradiction is a higher-value next cycle than the unproven aggregate producer
  path. Inspect whether the card can derive its count from the existing per-period evidence;
  retain the boundary-invariant hardening item as a separately named follow-up.

## Cycle 19 — one owner for per-period outcome counts

- Window: 2026-08-26 06:12–06:57 IST; source checkpoint at 06:25 IST and test checkpoint at
  06:35 IST. Later work covered evidence review and bounded follow-up sizing; the reviewed
  checkpoint was held briefly at the end to retain the 45-minute cycle cadence.
- Picked: the measured contradiction between the pack card's unfinished-period calculation and
  the adjacent per-period evidence. The card called one review target plus eleven waiting targets
  `12 needs review`; it also called completed periods `ready`, despite their mixed outcome meaning.
- Decision: delete the duplicate calculation and suffix rather than introduce another counter or
  a new classification helper. `TargetEvidence` already owns the explicit outcome counts, and the
  panel is the card's only production consumer. Delivery metadata, warning/recovery components,
  scope routing and all runtime guards remain unchanged. Impeccable's clarification lens favored
  one consistent outcome vocabulary over repeated aggregates.
- Tests: fifteen whole-panel cases cover one review plus eleven waiting, all seven outcomes,
  running/cancelled states, omitted/empty evidence, complete delivery/no-artifacts controls,
  supported single-period cleanup with/without evidence, and recovery/selection scope mismatch.
  The cleanup warning assertion moved from the isolated card to the actual panel composition,
  where it additionally pins an enabled local retry without a portal context.
- Test-quality correction: browser inspection exposed an unsupported return/format combination in
  the new cleanup fixture. It was corrected to the supported GSTR-2B multi-format scope and now
  asserts `All formats`. The mixed-outcome case remains renderer-taxonomy coverage, not a producer
  snapshot. The scope-mismatch unit case is a renderer-input contract, not controller proof.
- Discrimination: restoring the exact original card source failed 12 of 15 cases, including
  `expected [ '12 needs review', '1 needs review' ] to deeply equal [ '1 needs review' ]`.
  Restoring only a numeric `ready` suffix failed all 15 cases. Restoring the final source passed
  four focused files / 53 tests. Source restoration was checked by its exact blob hash.
- Measured reduction: card 116→110 lines; existing card tests 319→320; new panel tests 0→236.
  The source-module scan found 177 modules, 778 resolved edges, zero zero-importer candidates and
  zero unreachable modules from WXT/config/HTML roots. One pass reached the fixed point; no
  module/import edge was removed. Type-only reachability is not executable-export coverage.
- Gate: the first full suite passed but its later formatter check failed; that invocation is not
  a complete gate pass. After formatting and the fixture correction, build, TypeScript,
  zero-warning ESLint, repo-wide Prettier, package verification and diff checks passed. Package
  size remained 1.01 MB. Source-checkpoint suite: 126 files, 2,379 tests, fifteen more than Cycle 18.
  The later producer-backed test addition has its own gate below. Exact source-checkpoint footer:

  ```text
   Test Files  126 passed (126)
        Tests  2379 passed (2379)
     Start at  06:21:59
     Duration  151.66s (transform 2.50s, setup 0ms, import 11.27s, tests 126.04s, environment 8ms)
  ```

- Review: privacy PASS on final source blob `b9dfaa913860da1391bbe3e6c905965902bd13e1`;
  independent UX and module/security reviews found no blocking issue. Those reviews do not
  approve the separately identified full-year cleanup visibility gap.
- Packaged UI: identical dense fixtures at 320×900 measured the card at 124.27→109.43px and
  the panel shell at 1,286.21→1,271.37px. One 14.84px line was removed; five operable controls
  remained five. Running, cancelled, absent-evidence and supported cleanup fixtures retained
  honest copy with zero measured clipping. A 400px pass and return to 320px preserved the counts.
- Controller check: with a synthetic retained-recovery payload, changing the return and changing
  it back retained one review and eleven waiting outcomes. Saved-run and catalogue disclosures
  completed keyboard open/close cycles. Accessible evidence text matched the visible count;
  keyboard focus reached the existing controls without a page trap. No recovery/download action
  was executed, and the page network monitor observed zero requests. This is not live, native
  side-panel, zoom or assistive-technology qualification.
- Checkpoint: `7a012e2 fix(panel): remove duplicate review counts`.
- Learned / next cycle: three current, validator-accepted synthetic cleanup ledgers projected to
  blocked summaries with twelve completed periods, no current period and no recovery target. The
  packaged panel rendered neither an inline status nor recovery details. The old count was already
  zero for those shapes; this is a pre-existing visibility defect, not a count-removal regression.
  Investigate a canonical blocked-status fallback separately, without expanding action authority.
- Deeper proof: three additional tests construct canonical ledgers, require the actual ledger
  validator to accept them, call the real summary producer and render the panel. They cover a
  blocked first target, a blocked target after two not-filed periods and an interrupted active
  target. Restoring the original card failed all three (`12` or `10` plus the real `1 needs review`).
  Combined with the renderer matrix, that restoration failed 15 of 18 cases; all 18 passed after
  restoring the checkpoint source. This adds no production behavior.
- Read-only comparison: old/current card modules, using current dependencies, differed only by the
  intended suffix across 8,640 generated renderer inputs; 2,880 inputs lost that suffix and zero
  had another difference. These are render comparisons, not added tests or valid-run qualification.
  All nine cleanup-phase/evidence-presence combinations produced identical old/current card HTML.
  The isolated browser and its task-generated profile were closed and removed; all observed
  messages were read-only `PACK_GET_*` requests.
- Producer-backed gate: all six required commands and the diff check passed after the additional
  three cases. Final Cycle 19 suite: 127 files, 2,382 tests, eighteen more than Cycle 18; package
  remained 1.01 MB. The same known synthetic warnings were non-failing. Exact final three lines:

  ```text
        Tests  2382 passed (2382)
     Start at  06:31:15
     Duration  166.70s (transform 4.02s, setup 0ms, import 16.74s, tests 130.86s, environment 10ms)
  ```

- Test checkpoint: `979b02c test(panel): trace review counts from canonical ledgers`.
- Follow-up triage: independent review and isolated, in-memory reader probes elevated the
  existing cross-reader consistency item ahead of cleanup presentation. The next cycle will
  preserve unresolved recovery across readers, without changing structural acceptance or adding
  stored fields. These probes used stubbed boundaries, not live storage or portal actions; they
  do not establish that a normal workflow produces the inconsistent input. Cleanup status,
  action-label and selection-retention work remains queued separately. A display-only recovery
  predicate must not be substituted for the existing start-fresh authorization predicate.

## Cycle 20 — 2026-08-26, 06:57–07:42 IST (45 minutes)

- Picked: full-year recovery consistency across readers, elevated by Cycle 19's independent
  triage. Kept cleanup presentation and selection retention separate. Clean preflight passed and
  the lane register had no competing claim before edits.
- Before: 106 new cases gave 90 failures and 16 passing controls against the original source.
  Fixtures used the canonical factory, target-status helper and actual ledger validator. The
  first reader draft's malformed competitor was corrected before that recorded baseline.
- Changed: one shared target-disagreement predicate, a read-only blocked summary projection,
  recovery-preserving reader/Start/Clear ordering, and shared cause/action selection. The existing
  pending confirmation and ledger/target/revision/running retry guards remain. Source ledgers are
  not rewritten by reads/refusals; no new persisted field, category, key or serializer rule exists.
- Persistence qualification: blocked reconstruction now survives the existing session serializer
  where contradictory completed reconstruction was rejected. This is changed eligibility inside
  the existing schema, not persistence-neutral. Display-only evidence remains excluded.
- Three review rounds: mixed-target tests exposed selection differences in unconfirmed and
  interrupted recovery. Further checks exposed a copied-diagnostic context error and a refusal
  that named a different period from the returned action. All were rectified before checkpoint.
  Privacy and security reported no remaining findings on the final source blobs recorded in
  `VALIDATION.md`. No live, normal-workflow-origin or release qualification is implied.
- Discrimination: isolated reverts failed 7 Clear, 14 reader-priority, 7 early-Start, 7 existing-
  ledger, 14 projection, 1 confirmation, 4 cause-selection and 9 identity-selection cases. The
  two copied-diagnostic and one refusal-copy cases failed before their fixes. Passing controls,
  filters and failure messages are recorded in `VALIDATION.md`; these are not summed as test count.
  One prematurely restored mutation was invalidated and rerun while waiting for process completion.
- Gate: build, full Vitest, TypeScript, zero-warning ESLint, repo-wide Prettier, package verifier
  and diff checks passed. Final suite: 131 files / 2,503 tests, 121 more than Cycle 19. The package
  remained 1.01 MB. Exact final three Vitest lines:

  ```text
        Tests  2503 passed (2503)
     Start at  07:17:11
     Duration  208.88s (transform 8.89s, setup 0ms, import 28.55s, tests 151.82s, environment 14ms)
  ```

- Checkpoints: `166cb6d fix(recovery): preserve unresolved full-year state across readers` and
  `5f28c76 test(recovery): trace full-year recovery through readers and actions`.
- Accounting: seven production files 2,551→2,592 lines (+41); five new test/helper files 1,043
  lines; existing historical tests 2,181→2,183. This is correctness work, not a net code reduction.
  The obsolete coercion helper was removed. The module scan reached its fixed point in one pass:
  177 modules, 778 edges, zero orphan or unreachable modules; export-level liveness is not proven.
- Browser: fifteen synthetic packaged pages, with no detected portal context, zero action
  messages and zero observed page network requests. At 320px, all seven recovery statuses now show
  the named paused-period warning. Shell heights increased because recovery is visible; exact
  before/after values are in `VALIDATION.md`. Operable counts stayed 6→6 or 7→7, while an existing
  disabled inline action became visible. No horizontal clipping was measured. Keyboard disclosure
  and 320→400→320 resizing passed. The isolated browser and its exact 14 MB profile were removed.
- Deeper read-only sweep: 6,480 validator-accepted synthetic inputs; zero violations of the checked
  current recovery invariants, versus the documented old-producer violations. Property-order false
  positives were corrected with structural equality. Forty-eight all-positive legacy-cleanup
  summary rejections remain explicit, outside this target-disagreement repair. These are not
  additional tests or evidence that a normal workflow produces every generated combination.
- Learned / next: cleanup-only blocked summaries have no unresolved period and must not acquire
  a manufactured target action. The next bounded item is visible, canonical recovery copy. A
  fallback must remain status-only for missing-period input; existing action helpers must agree
  with what actually renders. Selection retention, cleanup button labels and legacy projection
  consistency remain separately scoped until their own evidence supports a change.
- Additional runtime proof: a second temporary profile used the actual packaged background service,
  with a generated ledger and no runtime-response mocks. A full isolated-browser restart rebuilt
  the same blocked summary and preserved the stored ledger. The actual Options Clear control then
  refused all seven synthetic unresolved statuses with visible error copy and unchanged ledgers.
  This is browser-restart/refusal evidence, not authenticated portal or in-flight-worker-stop
  qualification. The browser was closed and its exact 9.7 MB profile removed; no retry, download
  or portal action was performed. Network monitoring was page-scoped and covered the restart/Clear
  interval only. No source or test file changed after the recorded gate.
- Closed at 07:42 IST. Source/tests were checkpointed at 07:22 and the reviewed evidence at 07:35.
  The final interval included a disclosed cadence pause and read-only next-cycle scoping, not
  additional implementation or test execution. The overall overnight goal remains active.

## Cycle 21 — 2026-08-26 07:42–08:27 IST (45 minutes)

- Picked cleanup-only saved-run visibility: the packaged baseline showed delivery evidence but
  omitted the warning when no period remained. Added a canonical-reason fallback after existing
  specific instructions, a neutral heading and a missing-period action guard. Retained-scope copy
  now names the saved run without promising files, another ZIP or a discard control.
- Corrected the fixture assumption before counting discrimination: two direct cleanup summaries
  fail the existing durable parser. Those rejections remain explicit, not silently bypassed.
  Corrected baseline was 14 failures / four passes across 18 new cases. Ten additional export and
  ambiguity precedence cases raised the new-test total to 28. Seven targeted mutation groups failed
  as intended; sources were restored and hashes verified after every sequence.
- Pre-focus-follow-up result: 82 cases across five files. Repeated full gate passed: build, 134 Vitest
  files / 2,531 tests, TypeScript, zero-warning ESLint, repo-wide formatting, package and diff checks.

  ```text
        Tests  2531 passed (2531)
     Start at  07:59:17
     Duration  191.65s (transform 4.93s, setup 0ms, import 23.98s, tests 140.95s, environment 12ms)
  ```

- Source `dc9dbb4` and tests `e0cabc0` are checkpointed. Production lines: 814→820 (+6); three new
  test files: 396 lines. This is a visibility fix, not net reduction. No production module added
  or removed, and no authority, persistence, manifest, dependency or download guard changed.
- Browser evidence: sixteen stubbed packaged pages plus six separate real-handler reconstruction
  checks. Three cleanup warnings survived whole isolated-browser restarts with unchanged source
  ledgers. At 320px the new warning adds 91.81px; control counts stayed four, with no inline button.
  Specific ambiguous/exact-ID headings and delivery evidence remained intact. Keyboard guide and
  disclosure checks passed without submitting a recovery action. The exact 14 MB synthetic profile
  was removed. Details and limits are in `VALIDATION.md`; no authenticated behavior is claimed.
- Learned / next: the actual guide still labels local cleanup as final-ZIP retry and tells the user
  to keep the portal foregrounded. That visible contradiction outranks the unused-wrapper cleanup.
  The next cycle will trace and correct idle/busy action copy without changing eligibility or
  execution. Summary-parser widening and selection retention remain outside that copy task.
- Initial implementation, verification and evidence review were checkpointed by 08:05 IST. A
  subsequent 320×600 check found that guide autofocus scrolled the warning offscreen. The same
  visibility cycle remains open for a narrowly scoped focus-on-user-navigation correction and a
  fresh gate; the earlier result is not claimed to cover this follow-up.
- Short-window correction: focus now follows only user-requested Continue/Back, including Back to
  step zero. Initial focus is preserved in normal/StrictMode tests. Reverting the mount guard
  failed two cases; removing the navigation request failed six. At 320×600 all three warnings now
  open at scroll position 0, fully visible between y=120.80 and 212.61px; native Tab/Enter navigation
  still scrolls and focuses the guide when requested. Six additional synthetic pages had no broken
  ARIA references or duplicate IDs. Their separate 14 MB profile was closed and removed.
- Updated focused gate: 92 tests / six files. The post-focus full suite passed 134 files / 2,533
  tests, 30 more than Cycle 20 with none removed. The latest exact footer is:

  ```text
        Tests  2533 passed (2533)
     Start at  08:09:44
     Duration  175.33s (transform 4.49s, setup 0ms, import 17.36s, tests 138.82s, environment 9ms)
  ```

- Updated line accounting: four production files 1,032→1,043 (+11); interaction file 254→280;
  three new test files remain 396 lines. The cycle remains open until its cadence close.
- The post-focus build, TypeScript, zero-warning lint, repo-wide formatting, package and diff gates
  also passed. Focus source `07b34d5` and tests `517fb4c` are checkpointed; independent UI/privacy
  review found no actionable issue. Initial keyboard entry now requires an explicit Tab, preserving
  the warning before entering the guide; click count and subsequent navigation are unchanged.
- Closed at 08:27 IST. The final interval included read-only scoping and baseline measurement for
  the next cleanup-copy cycle, then a disclosed cadence pause beginning at 08:22. No implementation
  or test execution is attributed to that pause. The next cycle's baseline browser is closed and
  its synthetic pending requests were resolved. The overnight goal remains active.

## Cycle 22 — 2026-08-26 08:27–09:29 IST (62 minutes)

- Picked the measured cleanup action/busy contradiction, ahead of unrelated wrapper deletion.
  Three cleanup states at 320px advertise a final ZIP and foreground portal use; pending Start
  says files are being packed and shows 12/12 period progress. The existing action routes to
  retained-run reconciliation and, for unchanged canonical cleanup state, local staging cleanup.
- Initial plan was presentation only. No new message, eligibility, persisted value or guard change.
  A 78-case baseline and an expanded 2,340-case normalized-scope matrix are retained for comparison;
  55 and 1,572 cases respectively are disabled. Independent security/privacy preflight agrees with
  conservative marker-based classification and checking-before-cleanup wording.
- Preflight passed. The independent UI agent owns only new observable tests; root owns production
  and evidence. At the baseline checkpoint, synthetic browser pages were closed and no actual
  cleanup had run yet; the later synthetic run and reconstruction correction are recorded below.
- Browser review expanded the initially presentation-only scope within the same cleanup outcome:
  focus the replacement pending status after Start, clarify its local-only header, and restore the
  already-supported no-export signal when reconstructing a positively completed no-export ledger.
  The actual synthetic empty-staging cleanup ran once; a helper timeout required read-only recovery,
  not a second Start. That recovery exposed the reconstruction bug the first green suite missed.
- Independent short-panel recheck now places pending feedback at y=120.80–196.44 at 320×600,
  preserving initial focus and Tab order. Actual rebuilt-worker reopen renders No ZIP created with
  unchanged ledger and zero read-side storage changes. No live/authenticated qualification.
- Handoff accounting check: entries 1–17 are shorter checkpoint rounds, not compliant 45–75-minute
  cycles. Their actual windows remain unchanged; the earlier pacing note named only rounds 15–17
  and was incomplete. Cycles 18–21 each span 45 minutes. This cycle remains open for final gates,
  evidence review, checkpointing and cleanup; no claim of an unbroken overnight cadence is made.
- Final code/test checkpoints: `d5fe4bd` and `f34689f`. Final full suite passes 137 files / 2,593
  tests, with all other required local gates green and no removed tests. Exact footer:

  ```text
       Tests  2593 passed (2593)
    Start at  09:04:03
    Duration  159.59s (transform 3.04s, setup 0ms, import 14.22s, tests 129.11s, environment 9ms)
  ```

- The final read-only evidence review led to a deeper isolated generated-byte cleanup probe.
  One normal Start removed only the seeded active staging directory, preserving sibling and root
  canaries byte-for-byte. No browser download occurred; the seeded delivery phase is synthetic
  provenance, not evidence that Chrome downloaded a file. Legacy uncertainty is checked separately.
- The legacy generated-byte control also preserved both canaries and ended cleaned-legacy with
  ZIP-unconfirmed wording, no new saved/no-export signal and no download. Both exact profiles were
  removed after the checks. Independent 16→32px root-font stress passed at 320×600 for all three
  cleanup variants; this is not browser zoom or screen-reader qualification.
- Final source/security/privacy reviews are clean. Design follow-ups remain the buried cleanup
  route (P2) and existing 11px metadata (P3); no unrelated UI change was included. Remaining owner
  boundaries and real-runtime evidence gaps are preserved in VALIDATION rather than marked done.
- Final evidence checkpoint: `e99a36e`; boundary-review checkpoint: `66dba97`. The complete critique
  snapshot remains local under the existing ignore rule; no force-add or ignore-policy change.
- At 09:16 IST, removed only this lane's dependencies/build output after gates. Measured footprint
  309,648 KiB; both directories absent, source/worktree preserved. Shared-disk available space rose
  by 11,292 KiB across the immediate readings; that change is not attributed solely to this lane.
  All browser profiles/servers are closed and removed. The remaining interval is a disclosed idle
  handoff hold, with no implementation or test work attributed to it.
- Closed at 09:29 IST, within the requested roughly-09:30 handoff window. The idle hold ran from
  approximately 09:17 to 09:29; it is included only in wall-clock duration. Source/tests remain at
  their verified checkpoints. Final documentation formatting and diff checks passed after cleanup.
  No new cycle, push, PR, release operation or live session was started. The goal was not marked
  complete; this is the requested time-bounded handoff, with owner decisions still open.

## Cycle 23 — retain retry-cleanup rejection causes

- Window: 2026-08-27 02:11–02:30 IST (19 minutes). This was a short corrective checkpoint, not a
  cadence-qualifying 45–75 minute cycle; its actual duration is recorded rather than padded with an
  idle hold.
- Picked: the lossy-surface audit at the completed selected-file cleanup retry boundary. It computed
  a staging read, missing-checkpoint, malformed-ledger, scope-conflict, or revision-conflict reason,
  then discarded it by returning the old generic target review.
- Measured before: six parameterised tests failed against the prior source because neither the stored
  review nor the returned flow step contained the named cause. The existing retry test also treated a
  missing durable cleanup checkpoint as an unchanged review, proving the reason was not retained.
- Changed: retry cleanup now projects only existing allowlisted cause signals through the canonical
  target-review parser, persists the blocked review when storage succeeds, and returns the same
  signal to the current UI. A rejected write leaves the old record intact but returns both the exact
  cause and the existing `single-period-bundle-state-persist-failed` signal; it cannot create a
  completion or a new action. No field, permission, dependency, portal action, target binding or
  download-evidence rule changed.
- Discrimination: before the source change all six new cases failed at the absent stored cause.
  Replacing the rejected-write signal with an unrelated existing signal failed its dedicated case:
  `expected ... to contain 'single-period-bundle-state-persist-failed'`. Each mutation was restored
  before final validation.
- Review: required background security review PASS after the rejected-write path was made explicit.
  It found no manifest, CSP, network, target-binding, download-evidence or unsafe completion change.
- Gate: final build and package verification passed; TypeScript, zero-warning ESLint, repo-wide
  Prettier and diff checks passed. Focused recovery suites passed 122 tests. The isolated full serial
  Vitest run passed 2,794 tests. Exact footer:

  ```text
        Tests  2794 passed (2794)
     Start at  02:25:11
     Duration  206.32s (transform 6.71s, setup 0ms, import 30.18s, tests 148.83s, environment 14ms)
  ```

- Checkpoints: `1c7701a fix(recovery): retain retry cleanup causes` and
  `92983a3 test(recovery): cover retry cleanup cause retention`. The progress record is committed
  separately after this append.
- Learned / next: the retry boundary had two distinct storage outcomes: a retained diagnostic and a
  visible-but-unretained diagnostic. The next lossy-surface pass should trace another bounded
  rejection boundary rather than widening signal vocabulary or recovery authority.

## Cycle 24 — name unreadable ZIP staging

- Window: 2026-08-27 02:32–02:46 IST (14 minutes). This is a short corrective checkpoint, not a
  cadence-qualifying cycle; the time is recorded without an idle hold.
- Picked: the ZIP reconciliation boundary that caught a local staging-record read failure, returned
  `null`, and then recorded the different malformed-ledger reason.
- Measured before: the new exact-ID ZIP reconstruction case failed because a thrown local read was
  stored and returned as `single-period-bundle-ledger-malformed`. No staging clear, browser replay,
  or session completion happened in that baseline.
- Changed: the read boundary now returns the existing typed state-read failure, the blocked recovery
  projection retains that signal instead of the malformed signal, and the target-review surface tells
  the user it could not read local recovery state and will not clear or replace staging. The exact
  browser-download ID, positive-evidence requirements, blocked status, retained staging and no-new
  action authority are unchanged.
- Review and discrimination: the initial security review caught that the typed signal was hidden by
  generic recovery copy. The copy branch was added and independently reviewed PASS. Changing the
  condition to the write-failure signal made the copy test fail with the generic staging message;
  it was restored before gates. A briefly launched duplicate suite was terminated before completion
  after detecting an earlier detached suite; no result was used from it.
- Gate: build, TypeScript, zero-warning ESLint, repo-wide Prettier, package verification and diff
  checks passed. Focused recovery and surface tests passed 49 tests. The final isolated serial Vitest
  run passed 2,796 tests. Exact footer:

  ```text
        Tests  2796 passed (2796)
     Start at  02:42:13
     Duration  178.29s (transform 3.57s, setup 0ms, import 19.42s, tests 136.50s, environment 13ms)
  ```

- Checkpoints: `5a9135e fix(recovery): name unreadable ZIP staging` and
  `12c6a5e test(recovery): cover unreadable ZIP staging`. The progress record is committed
  separately after this append.
- Learned / next: a durable signal alone is insufficient when the primary recovery surface replaces
  its meaning. Continue the lossy-surface audit at one bounded catch boundary, preserving the
  distinction between unavailable local state and malformed local state.

## Cycle 25 — retain canonical completion write failure

- Window: 2026-08-27 02:47–02:54 IST (7 minutes). This is a short corrective checkpoint, not a
  cadence-qualifying 45–75-minute cycle; the actual duration is recorded without an idle hold.
- Picked: exact-ID ZIP reconciliation caught a canonical completion storage write failure, but routed
  it through the generic durable-status rejection. The existing allowlisted
  `canonical-completion-persist-failed` stage was not retained, making this storage failure
  indistinguishable from rejected or unreconstructable completion evidence.
- Measured before: the new recovery assertion failed because the returned durable target-review
  surface omitted `single-period-cleanup-checkpoint-failed:canonical-completion-persist-failed`.
  The direct surface test also failed, proving the generic renderer discarded that stage.
- Changed: only a thrown canonical-completion persistence write on the verified single-period ZIP
  path now retains the existing specific cleanup stage. The target-review projection preserves it
  and says that Pack could not save the confirmed ZIP completion after temporary staging cleared.
  The exact download ID, positive download evidence, blocked state, review retention, retry action,
  and no-new-download authority are unchanged. A missing completion key remains on the old generic
  fail-closed path rather than being mislabeled as a write failure.
- Discrimination and review: mutating the emitted stage to `completion-persist-failed` made the
  recovery test fail at the absent canonical-completion stage; the mutation was restored. Required
  background security review PASS found no manifest, network, CSP, target-binding, download-evidence
  or completion-safety regression.
- Gate: focused recovery and surface suites passed 50 tests. Build, TypeScript, zero-warning ESLint,
  repo-wide Prettier, package verification and diff checks passed. The final isolated serial Vitest
  run passed 2,797 tests. Exact footer:

  ```text
        Tests  2797 passed (2797)
     Start at  02:51:04
     Duration  153.59s (transform 2.47s, setup 0ms, import 12.61s, tests 124.90s, environment 8ms)
  ```

- Checkpoints: runtime and test commits follow this record; the progress record is committed
  separately after this append. No live/authenticated GST qualification, release claim, push or PR
  action was made.

## Cycle 26 — distinguish rejected ZIP target binding from checkpoint persistence

- Window: 2026-08-27 02:58–03:07 IST (9 minutes). This is a short corrective checkpoint, not a
  cadence-qualifying 45–75-minute cycle; the actual duration is recorded without an idle hold.
- Picked: staged ZIP export caught both an unavailable extension-Blob fingerprint and a rejected
  pre-download checkpoint callback, then labeled both as a local checkpoint persistence failure.
  The first case is a target-binding diagnostic rejection; no checkpoint callback has run yet.
- Measured before: a synthetic unavailable fingerprint returned
  `single-period-zip-download-state-persist-failed`, despite no checkpoint write or browser download.
  The first new regression failed at the absent `filed-return-download-diagnostics-rejected` signal.
- Changed: the existing durable target-diagnostic rejection signal now describes only the unavailable
  fingerprint branch. It blocks before the callback and browser download, revokes the Blob URL, runs
  the existing not-downloaded staging cleanup, and gives a matching retry instruction. Thrown
  pre-download checkpoint callbacks retain the existing state-persist-failed signal and recovery
  message. No permission, dependency, persisted field, portal action, download completion rule or
  target-binding requirement changed.
- Discrimination and review: replacing the fingerprint branch signal with the old persistence signal
  made the regression fail at the missing diagnostic signal; adding the remedy assertion first also
  failed against the old checkpoint-write instruction. Both mutations were restored. Required
  background security review PASS, including re-review after the remedy adjustment, found no manifest,
  network, CSP, staging-cleanup, target-binding or download-evidence regression.
- Gate: focused ZIP tests passed 29 tests. Build, TypeScript, zero-warning ESLint, repo-wide
  Prettier, package verification and diff checks passed. The final isolated serial Vitest run passed
  2,798 tests. Exact footer:

  ```text
        Tests  2798 passed (2798)
     Start at  03:04:24
     Duration  153.17s (transform 2.51s, setup 0ms, import 12.28s, tests 124.90s, environment 8ms)
  ```

- Checkpoints: runtime and test commits follow this record; the progress record is committed
  separately after this append. No live/authenticated GST qualification, release claim, push or PR
  action was made.

## Cycle 27 — preserve a real 320px panel geometry check

- Window: 2026-08-27 03:08–03:24 IST (16 minutes). This is a short test-quality checkpoint, not a
  cadence-qualifying 45–75-minute cycle; the actual duration is recorded without an idle hold.
- Picked: the release browser verifier proved that the panel mounted, but it did not exercise the
  signed-in guide at the declared 320px floor. CSS-only inspection could not prove that the preset
  controls and expanded catalogue remained inside the rendered panel.
- Measured before: the existing headed packaged-extension check passed at its default viewport. A
  first compact-flow probe correctly found that the catalogue is behind the explicit custom-scope
  door, so the final check opens that door rather than mistaking the preset screen for catalogue
  coverage.
- Changed: the browser verifier now opens a synthetic filed-returns tab on an already approved GST
  host, waits for the canonical supported context, and loads the packaged extension at 320 × 900.
  It asserts no document-wide horizontal scroll, no clipped button/select/summary, and no control
  shorter than 44px for both the presets and the expanded declared catalogue. The synthetic portal
  page remains local to the verifier; no Pack production navigation, portal action, permission,
  persistence, download or target-binding behavior changed.
- Discrimination: temporarily setting each preset to a 320px minimum width made the browser check
  fail with `Pack panel clipped a control at 320px during preset choices`; the stylesheet was
  restored before final gates. The final packaged verifier passes with the normal responsive layout.
- UI review: the Impeccable detector reports only existing advisory debt in `panel.css` (the
  run-progress width transition and pre-existing type-ramp values). This checkpoint adds no
  production CSS and does not suppress or reclassify those findings.
- Gate: focused package-verifier tests passed 27 tests. Build, TypeScript, zero-warning ESLint,
  repo-wide Prettier, package verification, headed browser verification and diff checks passed. The
  final isolated serial Vitest run passed 2,798 tests. Exact footer:

  ```text
   Test Files  151 passed (151)
        Tests  2798 passed (2798)
     Start at  03:21:14
     Duration  153.04s (transform 2.48s, setup 0ms, import 12.34s, tests 124.66s, environment 8ms)
  ```

- Checkpoints: test and progress commits follow this record. No live/authenticated GST
  qualification, release claim, push or PR action was made.

## Cycle 28 — audit guided-field accessibility coverage

- Window: 2026-08-27 03:25–03:29 IST (4 minutes). This is a quiet test-quality audit, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: the keyboard and screen-reader backlog requires that every guided field has a resolvable
  `aria-describedby` hint, not just matching attribute strings.
- Measured before: the existing interaction test advances through all four steps, queries the
  concrete `#panel-guide-hint` element, and asserts the field's `aria-describedby` equals that
  element's ID. It also checks the hint text, label association, live progress state and focus.
- Disproved change: adding an explicit non-empty/query-resolves assertion was redundant. A wrong
  reference failed the existing equality assertion; an empty ID/reference pair failed because the
  existing concrete hint query returned no element. Both temporary source mutations were restored.
- Gate: the restored focused interaction suite passed 16 tests. No product or test source change
  was retained, so the previous full-gate checkpoint remains the applicable behavioural evidence.
- Learned / next: do not count a second assertion as stronger coverage when the current test already
  exercises the same DOM resolution path. Continue with a different test-quality sample or a
  lossy-surface boundary rather than duplicating this check.

## Cycle 29 — surface saved-summary read failures

- Window: 2026-08-27 03:29–03:39 IST (10 minutes). This is a short corrective checkpoint, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: a session-storage failure while reading the saved filed-returns summary reached the
  background handler as an error response, but the panel controller ignored that response and
  rendered otherwise healthy context with no visible recovery-read failure.
- Measured before: the new controller regression failed with `expected null to be ... saved local
recovery state`, proving the response was silently discarded after context succeeded.
- Changed: the generic handler now names this request as saved local recovery state, and the shared
  controller renders its existing safe message (with a local-only fallback) as an action error.
  Context remains usable; no saved summary, action authority, permission, target binding, download
  evidence, persistence field or portal interaction changed.
- Review: required background security review PASS found no MV3, permission, CSP, network,
  persistence, downloads or trust-boundary regression.
- Gate: focused controller tests passed 5 tests. Build, TypeScript, zero-warning ESLint, repo-wide
  Prettier, package verification and diff checks passed. Final serial Vitest footer:

  ```text
   Test Files  151 passed (151)
        Tests  2799 passed (2799)
     Start at  03:35:36
     Duration  153.31s (transform 2.51s, setup 0ms, import 12.33s, tests 124.90s, environment 8ms)
  ```

- Checkpoints: runtime, test and progress commits follow. No live/authenticated GST qualification,
  release claim, push or PR action was made.

## Cycle 31 — audit all-formats label and order ownership

- Window: 2026-08-27 03:40–03:43 IST (3 minutes). This is a quiet duplicate-fact audit, not a
  cadence-qualifying 45–75-minute cycle; its actual duration is recorded without an idle hold.
- Picked: the objective named two historical hardcoded all-formats orders. The current audit traced
  label and ordering ownership across catalogue, artifact normalization and user-facing callers.
- Measured: the catalogue owns each bundle label and description; the leaf artifact vocabulary owns
  concrete fetch/write order; supported-selection expansion derives from those two sources. Focused
  all-formats tests cover all supported return types, including the non-literal GSTR-3B and
  three-format GSTR-2B cases. Production callers of the label helper supply a return type, so the
  legacy no-return fallback is not a displayed second product fact.
- Result: no duplicate production contract remains at this boundary. No compatibility fallback was
  removed without a caller or behavior reason.
- Gate: the existing all-formats focused suite is the relevant contract; no source change was
  retained. The next audit moves to a different duplicate or lossy-surface boundary.
