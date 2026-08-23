# Publication Readiness

This checklist tracks what remains while ComplyEaze Pack is a public V0 Chrome
Web Store beta, and before it can make broader public,
durable full-year, or stable-release claims.

## Current Decision

- Canonical product name: **ComplyEaze Pack**.
- Current package title: **ComplyEaze Pack: GST Return Downloader**.
- V0 Chrome Web Store listing:
  `https://chromewebstore.google.com/detail/complyeaze-pack-gst-gstr/nfnbhekccajjfgkppolomflaeledoccb`.
- Store-published GitHub release for GSTR-1 support:
  [`v0.3.2`](https://github.com/lamemustafa/pack/releases/tag/v0.3.2),
  published as a pre-release from commit
  `7bc2c2604f045c1d5547f6ab63a84dbb91de161e`.
- `v0.3.2` Chrome ZIP asset:
  `https://github.com/lamemustafa/pack/releases/download/v0.3.2/complyeazepack-0.3.2-chrome.zip`
  with SHA-256
  `6bd41a364a2466f0f255bef1b44e93694cc8d95431e7661fea5be3d52c9cdddb`.
- Chrome Web Store package update for `v0.3.2` was submitted through protected
  workflow dispatch on 2026-07-04. Run `28704776806` verified the GitHub release
  assets, uploaded `complyeazepack-0.3.2-chrome.zip`, reported upload state
  `SUCCEEDED`, reported publish state `PENDING_REVIEW`, and returned no
  warnings. A maintainer-provided Chrome Web Store publication email on
  2026-07-06 records item ID `nfnbhekccajjfgkppolomflaeledoccb`, item name
  `ComplyEaze Pack: GSTR-1/GSTR-3B Downloader`, version `0.3.2`, and visibility
  `Public`.
- The past `v0.4.0` release workflow run `29507382500` built and verified the
  exact package and uploaded it with Store state `SUCCEEDED`, but publish
  returned HTTP 400 because dashboard requirements were incomplete. It was not
  published. The historical pending ZIP SHA-256 is
  `6ee4be24cafbe15db69275cac4da6b212f3de49b0f747eb9909eed7d293347c6`.
- Repository source and the GitHub release are the pre-1.0 `v0.5.1` beta. <!-- x-release-please-version -->
  It is published as a pre-release.
  The Chrome Web Store package for `v0.5.0` is **published and live** as a
  pre-1.0 beta. It supersedes `v0.3.2`, which was previously recorded here as
  the last confirmed Store publication.
  `v0.5.0` is therefore the basis for current Store-published public claims,
  and any statement about what users have installed must be read against it.
- Publication does not by itself expand Store-facing durable full-year or
  universal live-period/format claims: those still depend on the live-evidence
  gate below, and synthetic regression coverage of target binding, artifact
  selection, and recovery is not a substitute for it. What publication does
  change is the consequence of a gap — a claim that outruns its evidence is now
  in front of users rather than waiting in review.
- V0 purpose: download filed GSTR-3B PDFs, GSTR-1 summary PDFs, optional
  GSTR-1 e-invoice details Excel files, and auto-drafted GSTR-2B summary
  artifacts locally
  from the user's active, manually authenticated GST Portal session when the
  GST Portal exposes those artifacts.
- GSTR-2B is **in scope**, not experimental. It runs the same user-initiated,
  evidence-backed download path as the other return types, and the derived
  full-year summary CSV is produced for it. A GSTR-2B run with invoice-level
  records also produces its own `full-year-workbook.xlsx`, one sheet per present
  section, distinct from the GSTR-3B consolidated workbook; where no such record
  exists, or the document carries a shape or a value that cannot be written to a
  spreadsheet unchanged, the run keeps the tidy CSV and reports the absence
  rather than emitting a blank or mislabelled workbook. The source-controlled Store listing draft
  names GSTR-2B as supported beta scope and a test binds it to the capability
  table, but the live dashboard fields still carry superseded wording: they are
  corrected only once `docs/chrome-web-store/dashboard-closeout.md` records the
  submission. Treat these values as the draft until that evidence exists.
- Full fiscal year download is a local per-period ledger that runs eligible
  periods through the single-period path after user initiation. The four gates
  below are what it must satisfy before Store-facing V0 advertises it:
  exact-ZIP clean-profile, real-browser restart/resume, reconciliation, and
  privacy-review evidence.
  The decision on how to reach that state is to **record the gates and keep one
  binary** — full-year is advertised once it has earned it, rather than being
  compiled out of Store builds and left present in source builds. Two artifacts
  that behave differently would make the binary the source of truth for what
  Pack offers, and would mean live evidence covers a build users never receive.
  Of the four gates, privacy-review evidence is **partially** recorded. An
  independent privacy review of the summary identity scoping ran against PR #184.
  It returned findings at High severity; each was reproduced, fixed and
  re-verified, and the dispositions are tracked on that PR. The failure mechanics
  are recorded in the private knowledge hub rather than here: this repository is
  public, and the summary feature was never part of a released package, so
  publishing the conditions serves no reader who could act on them.
  The evidence is partial because it covered one change rather than the whole
  feature, and because review of the fixes is still open. The remaining three
  gates require an authenticated live run.
- V0 does not collect GST Portal credentials, OTPs, CAPTCHA responses, cookies,
  or session tokens, and does not log or upload GST document contents. The
  source-build capture path may use temporary local OPFS staging for an explicit
  target-bound ZIP export and its saved recovery/cleanup lifecycle, as described
  in the README and privacy QA checklist. Single-period capture remains bound to
  the user-started action and selected target; protected endpoint replay and
  probing are not production paths.
- The source build contains one additional fail-closed evidence class for a
  portal-created Blob download. `target-bound-portal-click-blob` is limited to a
  single-period GSTR-3B PDF with an exact action and browser-download match. It
  is disabled for GSTR-1, GSTR-2B, selected-file ZIP/OPFS staging and every
  full-year flow, and it is not a Store-facing success claim.
- ComplyEaze Pack is not affiliated with, endorsed by, or operated by GSTN, CBIC,
  or the Government of India.

## GitHub Open-Source Checklist

### Done In Source

- [x] Full Apache-2.0 license text.
- [x] NOTICE file with trademark and government-affiliation disclaimers.
- [x] SECURITY.md with private disclosure route and sensitive-data handling.
- [x] CONTRIBUTING.md with privacy invariants and DCO sign-off.
- [x] CODE_OF_CONDUCT.md.
- [x] TRADEMARKS.md.
- [x] CHANGELOG.md initial v0.1.0 entry.
- [x] GitHub issue templates that prohibit sensitive taxpayer data.
- [x] PR template with privacy/data-flow checklist.
- [x] CODEOWNERS draft for sensitive surfaces.
- [x] Dependabot configuration for npm and GitHub Actions.
- [x] CI workflow with pinned GitHub Actions for format, dependency audit, lint,
      type-check, tests, build, package-policy verification, ZIP creation,
      exact-ZIP verification, checksum generation, and checksum log evidence.
- [x] Package metadata for repository, homepage, bugs, author, and Apache-2.0.
- [x] Manifest metadata, homepage URL, and icon paths.
- [x] Built-package verifier checks exact permissions, hosts, CSP, metadata, and
      icons.
- [x] Release workflow publishes verified ZIP, checksum, and provenance assets
      to GitHub releases after the exact-ZIP verifier passes.

### Must Complete Before Broad Public GitHub Launch

- [x] Public repository exists at `lamemustafa/pack`, matching the source
      metadata and manifest homepage URL.
- [ ] Confirm `contact@complyeaze.com`, `security@complyeaze.com`, and any
      conduct/privacy contacts are monitored.
- [ ] Confirm CODEOWNERS points to the right GitHub owner. It currently uses
      `@lamemustafa` for the personal repository; replace with teams if the repo
      later moves into an organisation.
- [ ] Run final secret/sensitive artifact scan over the exact repository history
      that will be pushed.
- [ ] Ensure no `.output`, `.wxt`, `node_modules`, real GST PDFs, GSTIN-bearing
      filenames, portal screenshots, raw network captures, cookies, headers,
      OTPs, CAPTCHA data, or private notes are committed.
- [ ] Create a signed `v0.1.0` tag after final launch verification.
- [ ] Publish release checksum and source commit for the release ZIP.

## Chrome Web Store Checklist

Every checked item below records at least one verifiable source path, workflow
run identifier, or dated observation. Unevidenced claims stay unchecked.

### Done In Source

- [x] Manifest V3 is asserted by `scripts/verify-extension-browser.mjs`.
- [x] Exact GST host permission allow-list only, defined in
      `src/extension/manifest-policy.ts`.
- [x] No `<all_urls>`, cookies, history, webRequest, debugger/CDP,
      nativeMessaging, tabs, identity, or externally_connectable in any Pack
      build; `scripts/verify-extension-package.mjs` enforces the package boundary.
- [x] Restrictive extension CSP, defined in
      `src/extension/manifest-policy.ts`.
- [x] No remote executable code allowed by
      `scripts/verify-extension-package.mjs`.
- [x] No extension analytics SDK; packaged markers are rejected by
      `scripts/verify-extension-package.mjs`.
- [x] Synthetic reviewer demo exists in `src/background/synthetic-demo.ts`.
- [x] Reviewer instructions exist in `docs/CHROME_REVIEWER_TEST.md`.
- [x] Manifest icons are defined in `src/extension/manifest-policy.ts` and
      verified in the built package by `scripts/verify-extension-package.mjs`.
- [x] Manifest homepage URL is defined in
      `src/extension/manifest-policy.ts` and points to
      `https://pack.complyeaze.com/gst`.
- [x] Protected Chrome Web Store workflow exists for future release updates at
      `.github/workflows/chrome-web-store.yml`.
- [x] Protected Chrome Web Store status monitor exists for post-submit
      review/publication checks without upload or publish side effects at
      `.github/workflows/chrome-web-store-status.yml`.

### Must Complete Before Future Store Updates Or Broader Store Claims

#### Live Evidence Gate

- [ ] For each Store-ready claim, record dated evidence: source commit/tag, exact
      ZIP checksum, clean-profile install result, demo result, authorised live GST
      run result, network/storage audit summary, privacy declaration snapshot,
      reviewer instructions, approver, and date.
- [ ] Public Pack source/status pages are regenerated from this evidence and do
      not claim newer readiness than the recorded gate.

- [ ] Legal review of live GST Portal terms against exact extension behaviour.
- [ ] Privacy Policy, Terms, support URL, source URL, and limited-use statement
      are live and accessible without login.
- [ ] Chrome privacy declarations match the exact final build. Disclose
      personally identifiable information, financial and payment information,
      and website content because Chrome counts local processing. Keep
      authentication information, web history, and user activity unchecked
      unless runtime behavior changes.
- [x] Source-controlled Store screenshots and promotional images use only
      synthetic/redacted data. The seven PNG exports prepared for the past
      `v0.4.0` dashboard update were generated from refreshed source SVGs,
      visually checked, and recorded in
      `docs/chrome-web-store/assets/exports/asset-hashes.json`.
- [ ] The regenerated Store exports are visually reviewed by a maintainer and
      bound to the exact `v0.5.0` submission. Source/export hash agreement alone
      does not satisfy this review.
- [ ] Upload the generated Store screenshot/promotional PNGs to the Chrome Web
      Store dashboard, then record dashboard image review state for the exact
      submitted release.
- [ ] Exact ZIP tested in a clean Chrome profile.
- [ ] Exact ZIP tested against the live GSTR-3B and GSTR-1 flows by an
      authorised user.
- [ ] Full fiscal year ledger resumes after service-worker restart without
      repeating a downloaded target.
- [ ] Full fiscal year ledger resumes after browser restart without retaining
      raw URLs, filenames, local paths, portal HTML, GSTIN/PAN, taxpayer names,
      cookies, credentials, OTP, or CAPTCHA data.
- [ ] Authorised live full fiscal year run reconciles every eligible target as
      downloaded, positively not filed, blocked, or failed in the local ledger.
- [ ] The authorised live full fiscal year recovery matrix below is complete:
      every observation matches a completion-eligible row in the cell legend,
      and every recorded date is valid and no later than the current UTC date.

The selection rows are derived from the supported Cartesian product of
`FILED_RETURNS_RETURN_TYPES` and `FILED_RETURNS_ARTIFACT_TYPES`; a test keeps
this instrument aligned with those canonical constants. The same test derives
each row's acquisition capability from
`supportsFullFiscalYearFiledReturnsRun` and
`supportsFiledReturnsArtifactType`; the document cannot declare that fact. For
each row, the final expectation cell's capability claim must agree with the
derived value. For each acquisition-capable selection, record service-worker
restart, browser restart, interrupted download, cancellation/discard and its
cleanup outcome, and a retained checkpoint whose browser record is no longer available. A
resumed path must not repeat a completed target. An unproven path remains
non-complete until retry or cancellation. Manual observation is only an
explicit non-completing action and still requires retry before ZIP staging.

Every cell must match one complete row in this legend. The test renders the
legend from the same rule table used for validation, so state, reason, date,
column, and completion semantics cannot drift into an independent vocabulary.

<!-- BEGIN: full-year-recovery-cell-legend -->

| State                     | Date constraint                             | Reason                              | Allowed column           | Derived row capability    | Recorded capability claim | Completion-eligible |
| ------------------------- | ------------------------------------------- | ----------------------------------- | ------------------------ | ------------------------- | ------------------------- | ------------------- |
| `pass`                    | valid `YYYY-MM-DD`, today or earlier in UTC | none                                | scenario columns         | any derived capability    | none                      | yes                 |
| `fail`                    | valid `YYYY-MM-DD`, today or earlier in UTC | none                                | scenario columns         | any derived capability    | none                      | no                  |
| `fail-closed-as-expected` | valid `YYYY-MM-DD`, today or earlier in UTC | `expected-fail-closed-boundary`     | scenario columns         | any derived capability    | none                      | yes                 |
| `fail-closed-as-expected` | valid `YYYY-MM-DD`, today or earlier in UTC | `expected-fail-closed-boundary`     | final expectation column | `acquisition-capable`     | `acquisition-capable`     | yes                 |
| `not-applicable`          | valid `YYYY-MM-DD`, today or earlier in UTC | `recovery-scenario-not-applicable`  | scenario columns         | `acquisition-capable`     | none                      | no                  |
| `not-applicable`          | valid `YYYY-MM-DD`, today or earlier in UTC | `recovery-scenario-not-applicable`  | scenario columns         | `not-acquisition-capable` | none                      | yes                 |
| `not-applicable`          | valid `YYYY-MM-DD`, today or earlier in UTC | `selection-not-acquisition-capable` | final expectation column | `not-acquisition-capable` | `not-acquisition-capable` | yes                 |
| `not-yet-run`             | `not-recorded`                              | none                                | scenario columns         | any derived capability    | none                      | no                  |
| `not-yet-run`             | `not-recorded`                              | `not-recorded`                      | final expectation column | any derived capability    | none                      | no                  |

<!-- END: full-year-recovery-cell-legend -->

If these combinations are insufficient, add a rule through review before
recording the observation. No other cell text is permitted, so raw portal URLs,
filenames, download IDs, page or DOM text, local paths, and taxpayer/session
data are unrepresentable in the matrix.

<!-- BEGIN: full-year-recovery-matrix -->

| Return type | Artifact type | Service-worker restart          | Browser restart                 | Interrupted download            | Cancellation/discard and cleanup | Retained checkpoint; browser record unavailable | Expected fail-closed / not applicable                 |
| ----------- | ------------- | ------------------------------- | ------------------------------- | ------------------------------- | -------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| GSTR-3B     | PDF           | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-3B     | JSON          | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-1      | PDF           | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-1      | EXCEL         | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-1      | PDF_AND_EXCEL | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-2B     | PDF           | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-2B     | JSON          | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-2B     | EXCEL         | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |
| GSTR-2B     | PDF_AND_EXCEL | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded | not-yet-run; date: not-recorded  | not-yet-run; date: not-recorded                 | not-yet-run; date: not-recorded; reason: not-recorded |

<!-- END: full-year-recovery-matrix -->

- [ ] Action-bound capture is tested in clean Chrome and Brave profiles plus the
      real profile where the native Save dialog appeared, with "Ask where to
      save each file" on and off, existing filename collisions, and
      multiple-download prompt conditions. Each run must record sanitized
      path-taken evidence that distinguishes confirmed main-world capture, the
      narrowly scoped `target-bound-portal-click-blob` class, and an unconfirmed
      or ambiguous portal click. The target-bound portal-created class must be
      rejected outside single-period GSTR-3B PDF evidence and must not represent
      full-year or staged ZIP work. Plain portal-click evidence must remain
      fail-closed and must not cause a second click or protected endpoint replay.
      If this gate passes for GSTR-3B only, record the product decision to stop at
      GSTR-3B or proceed to GSTR-1 PDF/Excel capture verification before making
      full-year dialog-free claims.
- [ ] Transient artifact-byte handling is limited to explicit user-started,
      target-bound local downloads. The service worker owns main-world capture,
      MIME/size/magic validation, offscreen temporary Blob URL creation,
      `chrome.downloads.download({ saveAs: false })`, terminal browser-download
      observation, Blob URL revocation, offscreen close, and byte disposal. Raw
      PDF, XLS and portal-data JSON bytes must not cross page `postMessage`,
      content-script runtime
      messages, extension storage, IndexedDB, Cache Storage, diagnostics, live
      evidence, logs, telemetry, support bundles, or ComplyEaze systems.
- [ ] File System Access remains a foreground Options-only probe until live
      browser evidence proves a broader flow. The probe is user-click-mediated,
      writes and reads back only synthetic bytes in a user-chosen folder, removes
      the probe file, stores no file or directory handle, and is not used for
      unattended background artifact automation.
      Live evidence notes: Active-profile Brave testing on 2026-07-01 cleared the
      immediate native Save dialog blocker for one GSTR-3B single-month run and a
      two-period local flow run. Active-profile Brave testing on 2026-07-03 completed
      one GSTR-1 PDF+Excel single-month run and one FY 2025-26 GSTR-1 PDF+Excel
      full-year run in the unpacked source build. No exact-ZIP clean-profile
      Chrome/Brave full-year evidence is recorded yet, so browser-profile and
      release-package acceptance remains open. Local packaging follow-up on
      2026-07-03 rebuilt the Chrome MV3 package, produced
      `.output/complyeazepack-0.2.2-chrome.zip`, and updated the exact-ZIP verifier to
      emit package-policy and SHA-256 evidence before the browser-host step. The
      unpacked package, extracted ZIP package policy, and ZIP checksum were verified
      locally. The recorded SHA-256 is
      `58395617e5a5557f2b4c2091396937e82a5f7a857d94127702dff5881babe3e4`. The
      exact-ZIP verifier still stops at the browser-host step because Codex's macOS
      sandbox denies Chromium Crashpad application-support access before Pack loads.
      The verifier now reports that as a sanitized environmental blocker; no browser
      assertions ran in that attempt. Focused unit coverage confirms explicit
      full-year resume does not repeat a downloaded period and stale running ledgers
      do not auto-resume after a service-worker restart, but real Chrome/Brave
      service-worker and browser-restart evidence is still required before durable
      full-year
      claims.
- [ ] Network/storage audit confirms no unexpected destinations or sensitive
      persistence. Any `pack:filed-returns-target-review` record is limited to
      canonical target identifier/scope, safe signals/messages, recovery attempt
      kind/phase, request and bounded candidate-window timestamps, opaque
      action/staging/checkpoint identifiers, the exact numeric browser download
      ID, sanitized diagnostic classes, revisions and timestamps; it contains no
      raw filename, local path, URL/referrer, taxpayer identifier, portal HTML,
      credential, session data or artifact bytes. Shareable evidence uses only a
      neutral `ACTION-*` alias and omits the browser download ID.
- [ ] SBOM, dependency vulnerability review, license scan, and secret scan are
      complete.
      `pnpm audit --audit-level high` hung without output in the sandbox on
      2026-07-03, and the network-capable rerun was rejected by the current
      Codex approval policy. Pack now uses `node scripts/run-dependency-audit.mjs`,
      a timeout wrapper around the same audit command, so local release
      verification fails clearly instead of hanging indefinitely. Treat
      dependency-audit evidence as missing until the audit is run from an
      approved network-capable shell or CI.
- [ ] Multiple-download prompt, session expiration, cancellation, failed
      download, zero-byte/corrupt-file, and service-worker restart paths are
      manually checked.
- [ ] Publisher account MFA, recovery, and team access are verified.
- [ ] Product, engineering, security, privacy/legal, open-source, and release
      manager sign-offs are recorded.
- [x] Initial Chrome Web Store V0 listing published. The dated 2026-07-06
      `v0.3.2` publication evidence recorded below is the basis for this item.
- [x] Protected Chrome Web Store release update submitted through workflow
      dispatch. The `v0.2.1` package was uploaded through GitHub Actions run
      `28542410006` with Chrome Web Store upload state `SUCCEEDED`, publish
      state `PENDING_REVIEW`, and no warnings.
- [x] Submit the `v0.3.2` package through the protected Chrome Web Store
      workflow. Run `28704776806` uploaded the package with Chrome Web Store
      upload state `SUCCEEDED`, publish state `PENDING_REVIEW`, and no warnings.
- [x] Record Chrome Web Store publication evidence for `v0.3.2`. A
      maintainer-provided publication email on 2026-07-06 records item ID
      `nfnbhekccajjfgkppolomflaeledoccb`, item name
      `ComplyEaze Pack: GSTR-1/GSTR-3B Downloader`, item type `extension`,
      version `0.3.2`, and visibility `Public`.
- [x] Record the historical `v0.4.0` package upload. Workflow run `29507382500`
      reported upload state `SUCCEEDED`; that release was not published.
- [ ] Record the `v0.5.0` Chrome Web Store publication evidence. The package
      **is published and live** -- the maintainer observed it on the Store
      dashboard -- so the version claim elsewhere in this file is correct. This
      item stays unchecked because the observation is not auditable from this
      repository: `observation-date: not-recorded`; `observed-state: published,
maintainer-reported`; `observation-location: not-recorded`;
      `submission-method: not-recorded`; `workflow-run-id: not-recorded` (or
      `manual; workflow-run-id: none`); and
      `observer-or-approver: maintainer, undated`. Fill these from the dashboard
      rather than inferring them; a published version with an unrecorded
      evidence chain is exactly what this checklist exists to surface.
- [x] Add a read-only Chrome Web Store status monitor for submitted packages.
      Scheduled runs use the dedicated `chrome-web-store-status` environment so
      publication/rejection monitoring is not blocked by the protected publishing
      approval gate; the source is
      `.github/workflows/chrome-web-store-status.yml`.
- [ ] Record a read-only Chrome Web Store Status run with
      `expected_version=0.5.0` and `require_published=false` while the submitted
      draft is in review, then `require_published=true` only after confirmed
      publication. Use
      [`docs/chrome-web-store/dashboard-closeout.md`](chrome-web-store/dashboard-closeout.md)
      for the dashboard and read-only status-monitor closeout checklist.

## Suggested Store Copy

Canonical dashboard copy and current asset inventory are maintained in
[`docs/chrome-web-store/listing.md`](chrome-web-store/listing.md).

Copy exact fields from that brief; do not maintain a second, potentially stale
version here.

## Not Yet Stable Or Broad-Claim Ready Until

The current Store publication is the `v0.5.0` pre-1.0 beta, which is published
and live; the past `v0.4.0` package was uploaded but never published, and
`v0.3.2` is superseded. The source-build full-year workflow has maintainer evidence
for automatic local downloads after user initiation. Pack must not claim stable
Chrome Web Store maturity,
store-facing full-year availability, durable restart-safe full-year support,
legal approval, live manifest/index/exception output, or broad GST coverage
until legal review, live public policy URL confirmation, exact-ZIP manual QA,
privacy declarations, live per-target result/manifest wiring, and store
assets/sign-offs are recorded for the exact release. For `v0.3.2`, GitHub
release assets, package submission, and Chrome Web Store publication email
evidence are recorded; read-only status API evidence and dashboard-held field
snapshots remain optional evidence-hardening items.
