# Publication Readiness

This checklist tracks what remains while ComplyEaze Pack is a public V0 Chrome
Web Store alpha and source beta, and before it can make broader public,
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
- Repository source and the GitHub release are the pre-1.0 `v0.5.0` beta,
  published as a pre-release. The Chrome Web Store package for `v0.5.0` is
  submitted and in review as a draft; it is not approved, published, or live.
  `v0.3.2` remains the last confirmed Store publication and the only basis for
  current Store-published public claims.
- The `v0.5.0` beta does not expand Store-facing, durable full-year, or
  universal live-period/format claims. Synthetic regression coverage of target
  binding, artifact selection, and recovery is not a substitute for the
  authorised live-evidence gate below.
- V0 purpose: download filed GSTR-3B PDFs, GSTR-1 summary PDFs, and optional
  GSTR-1 e-invoice details Excel files locally from the user's active,
  manually authenticated GST Portal session when the GST Portal exposes those
  artifacts.
- Full fiscal year download exists as a source-build alpha local per-period
  ledger that runs eligible GSTR-3B or GSTR-1 periods through the
  single-period path after user initiation. Store-facing V0 must not advertise
  it until exact-ZIP clean-profile, real-browser restart/resume,
  reconciliation, and privacy-review evidence are recorded for the release.
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

### Done In Source

- [x] Manifest V3.
- [x] Exact GST host permission allow-list only.
- [x] No `<all_urls>`, cookies, history, webRequest, debugger/CDP,
      nativeMessaging, tabs, identity, or externally_connectable in any Pack build.
- [x] Restrictive extension CSP.
- [x] No remote executable code allowed by package verifier.
- [x] No extension analytics SDK.
- [x] Synthetic reviewer demo exists.
- [x] Reviewer instructions exist in `docs/CHROME_REVIEWER_TEST.md`.
- [x] Manifest icons are present in source and verified in the built package.
- [x] Manifest homepage URL points to `https://pack.complyeaze.com/gst`.
- [x] Protected Chrome Web Store workflow exists for future release updates.
- [x] Protected Chrome Web Store status monitor exists for post-submit
      review/publication checks without upload or publish side effects.

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
      every observation is dated, no cell remains `not-yet-run`, and every
      `fail-closed-as-expected` or `not-applicable` entry has a reason.

The selection rows are derived from the supported Cartesian product of
`FILED_RETURNS_RETURN_TYPES` and `FILED_RETURNS_ARTIFACT_TYPES`; a test keeps
this instrument aligned with those canonical constants. For each
acquisition-capable selection, record service-worker restart, browser restart,
interrupted download, cancellation/discard and its cleanup outcome, and a
retained checkpoint whose browser record is no longer available. A resumed
path must not repeat a completed target. An unproven path remains non-complete
until retry or cancellation. Manual observation is only an explicit
non-completing action and still requires retry before ZIP staging.

Use only `pass`, `fail`, `fail-closed-as-expected`, `not-applicable`, or
`not-yet-run`, followed by `date: YYYY-MM-DD`; use `date: not-recorded` only
with `not-yet-run`. A reason is required for `fail-closed-as-expected` and
`not-applicable`, using the final column when the selection cannot reach an
acquisition checkpoint. The value after `reason:` is not free text; use exactly
one of `selection-not-acquisition-capable`,
`recovery-scenario-not-applicable`, or `expected-fail-closed-boundary`. Use
`reason: not-recorded` only with `not-yet-run`. If these categories are
insufficient, add a category through review before recording the observation.
No other cell text is permitted, so raw portal URLs, filenames, download IDs,
page or DOM text, local paths, and taxpayer/session data are unrepresentable in
the matrix.

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
- [x] Initial Chrome Web Store V0 listing published.
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
- [x] Record the `v0.5.0` Chrome Web Store submission. The package is submitted
      and in review as a draft; approval, publication, and live availability
      are not claimed.
- [x] Add a read-only Chrome Web Store status monitor for submitted packages.
      Scheduled runs use the dedicated `chrome-web-store-status` environment so
      publication/rejection monitoring is not blocked by the protected publishing
      approval gate.
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

The last confirmed Store publication is `v0.3.2`; the past `v0.4.0` package was
uploaded but not published, and the `v0.5.0` package is submitted and in review
as a draft. The source-build alpha full-year workflow has maintainer evidence
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
