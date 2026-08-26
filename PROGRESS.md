# Sustained catalogue-overhaul progress

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
