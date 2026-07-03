# Publication Readiness

This checklist tracks what remains while ComplyEaze Pack is a public V0 Chrome
Web Store alpha and before it can make broader public, durable full-year, or
stable-release claims.

## Current Decision

- Canonical product name: **ComplyEaze Pack**.
- First Chrome listing title: **ComplyEaze Pack: GSTR-1/GSTR-3B Downloader**.
- V0 Chrome Web Store listing:
  `https://chromewebstore.google.com/detail/complyeaze-pack-gst-gstr/nfnbhekccajjfgkppolomflaeledoccb`.
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
  or session tokens, and does not store, log, or upload GST document contents.
  The direct-download compatibility path is URL-only: it reviews GST endpoint
  metadata in the authenticated page context and hands only the reviewed GST URL
  to the browser download manager, without reading or retaining PDF bytes.
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
- [x] No `<all_urls>`, cookies, history, webRequest, tabs, identity, or
      externally_connectable.
- [x] Restrictive extension CSP.
- [x] No remote executable code allowed by package verifier.
- [x] No extension analytics SDK.
- [x] Synthetic reviewer demo exists.
- [x] Reviewer instructions exist in `docs/CHROME_REVIEWER_TEST.md`.
- [x] Manifest icons are present in source and verified in the built package.
- [x] Manifest homepage URL points to `https://pack.complyeaze.com/gst`.
- [x] Protected Chrome Web Store workflow exists for future release updates.

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
- [ ] Chrome privacy declarations match the exact final build. Do not answer
      "no data" merely because data stays local if the dashboard asks about
      local access or processing.
- [ ] Store screenshots and promotional images use only synthetic data.
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
- [ ] Direct browser-download default is tested in clean Chrome and Brave
      profiles with "Ask where to save each file" on and off, and the
      portal-click fallback is verified to stop on unconfirmed or ambiguous
      evidence without repeating completed full-year targets.
      Active-profile Brave testing on 2026-07-01 cleared the immediate native
      Save dialog blocker for one GSTR-3B single-month run and a two-period
      local flow run. Active-profile Brave testing on 2026-07-03 completed
      one GSTR-1 PDF+Excel single-month run and one FY 2025-26 GSTR-1
      PDF+Excel full-year run in the unpacked source build. No exact-ZIP
      clean-profile Chrome/Brave full-year evidence is recorded yet, so
      browser-profile and release-package acceptance remains open.
      Local packaging follow-up on 2026-07-03 rebuilt the Chrome MV3 package,
      produced `.output/complyeazepack-0.2.2-chrome.zip`, and updated the
      exact-ZIP verifier to emit package-policy and SHA-256 evidence before the
      browser-host step. The unpacked package, extracted ZIP package policy, and
      ZIP checksum were verified locally. The recorded SHA-256 is
      `58395617e5a5557f2b4c2091396937e82a5f7a857d94127702dff5881babe3e4`.
      The exact-ZIP verifier still stops at the browser-host step because
      Codex's macOS sandbox denies Chromium Crashpad application-support access
      before Pack loads. The verifier now reports that as a sanitized
      environmental blocker; no browser assertions ran in that attempt.
      Focused unit coverage confirms explicit full-year resume does not repeat
      a downloaded period and stale running ledgers do not auto-resume after a
      service-worker restart, but real Chrome/Brave service-worker and
      browser-restart evidence is still required before durable full-year
      claims.
- [ ] Network/storage audit confirms no unexpected destinations or sensitive
      persistence.
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

## Suggested Store Copy

Canonical dashboard copy and current asset inventory are maintained in
[`docs/chrome-web-store/listing.md`](chrome-web-store/listing.md).

Title:

```text
ComplyEaze Pack: GSTR-1/GSTR-3B Downloader
```

Short description:

```text
Alpha: locally download filed GSTR-1 and GSTR-3B documents from your active GST Portal session.
```

Opening description:

```text
ComplyEaze Pack helps you download your own filed GSTR-3B PDFs, GSTR-1 summary
PDFs, and optional GSTR-1 e-invoice details Excel files from the GST Portal
using your active browser session. It does not ask for or store GST Portal
credentials, OTPs, CAPTCHA responses, cookies, or session tokens.
```

Required disclaimer:

```text
ComplyEaze Pack is not affiliated with, endorsed by, or operated by GSTN, CBIC,
or the Government of India.
```

## Not Yet Stable Or Broad-Claim Ready Until

The V0 listing exists, and the source-build alpha full-year workflow has
maintainer evidence for automatic local downloads after user initiation. Pack
must not claim stable Chrome Web Store maturity, store-facing full-year
availability, durable restart-safe full-year support, legal approval, live
manifest/index/exception output, or broad GST coverage until legal review, live
public policy URL confirmation, exact-ZIP manual QA, privacy declarations, live
per-target result/manifest wiring, and store assets/sign-offs are recorded for
the exact release.
