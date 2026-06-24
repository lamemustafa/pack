# Publication Readiness

This checklist tracks what remains before moving ComplyEaze Pack from
open-source alpha to a broader public release and v0 Chrome Web Store package.

## Current Decision

- Canonical product name: **ComplyEaze Pack**.
- First Chrome listing title: **ComplyEaze Pack: GST GSTR-3B Downloader**.
- V0 purpose: download filed GSTR-3B PDFs locally from the user's active,
  manually authenticated GST Portal session.
- Full fiscal year download exists as a source-build alpha local ledger, but
  store-facing V0 must not advertise it until durable resume, real-browser
  restart, and privacy-review tests are complete.
- V0 does not collect GST Portal credentials, OTPs, CAPTCHA responses, cookies,
  session tokens, or GST document contents.
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
      exact-ZIP verification, checksum generation, retained ZIP artifact, and
      checksum log evidence.
- [x] Package metadata for repository, homepage, bugs, author, and Apache-2.0.
- [x] Manifest metadata, homepage URL, and icon paths.
- [x] Built-package verifier checks exact permissions, hosts, CSP, metadata, and
      icons.

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

### Must Complete Before Store Submission

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
- [ ] Exact ZIP tested against the live GSTR-3B flow by an authorised user.
- [ ] Full fiscal year ledger resumes after service-worker restart without
      repeating a downloaded target.
- [ ] Full fiscal year ledger resumes after browser restart without retaining
      raw URLs, filenames, local paths, portal HTML, GSTIN/PAN, taxpayer names,
      cookies, credentials, OTP, or CAPTCHA data.
- [ ] Authorised live full fiscal year run reconciles every eligible target as
      downloaded, positively not filed, blocked, or failed in the local ledger.
- [ ] Network/storage audit confirms no unexpected destinations or sensitive
      persistence.
- [ ] SBOM, dependency vulnerability review, license scan, and secret scan are
      complete.
- [ ] Multiple-download prompt, session expiration, cancellation, failed
      download, zero-byte/corrupt-file, and service-worker restart paths are
      manually checked.
- [ ] Publisher account MFA, recovery, and team access are verified.
- [ ] Product, engineering, security, privacy/legal, open-source, and release
      manager sign-offs are recorded.

## Suggested Store Copy

Title:

```text
ComplyEaze Pack: GST GSTR-3B Downloader
```

Short description:

```text
Download filed GSTR-3B PDFs locally from your GST Portal session.
```

Opening description:

```text
ComplyEaze Pack helps you download your own filed GSTR-3B PDFs from the GST
Portal using your active browser session. It does not ask for or store GST Portal
credentials, OTPs, CAPTCHA responses, cookies, or session tokens.
```

Required disclaimer:

```text
ComplyEaze Pack is not affiliated with, endorsed by, or operated by GSTN, CBIC,
or the Government of India.
```

## Not Yet Launch-Ready Until

The codebase can be open-sourced after final scan, contact confirmation, and
repository hygiene review. Chrome Web Store submission should wait for legal
review, live public policy URLs, exact-ZIP manual QA, privacy declarations, live
per-target result/manifest wiring, and store assets/sign-offs.
