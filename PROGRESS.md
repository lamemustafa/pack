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
