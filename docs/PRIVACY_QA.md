# Pack Privacy QA

Pack V0 must stay local-first and no-signup.

## Automated checks

The package verifier fails the build when:

- forbidden permissions are present, including `cookies`, `history`,
  `webRequest`, `tabs`, `identity`, `alarms`, native messaging, clipboard access,
  or unlimited storage;
- host permissions broaden beyond GST Portal domains;
- `<all_urls>` appears;
- `externally_connectable` is declared;
- extension-page CSP does not restrict scripts and objects to `self`;
- CSP allows `unsafe-eval`;
- built JavaScript/HTML/CSS/JSON contain remote executable-code patterns;
- Pack source code contains sensitive credential markers.

## Manual checks

For each release candidate:

- Inspect `src/extension/manifest-policy.ts` and the built
  `.output/chrome-mv3/manifest.json`.
- Confirm no analytics, crash-reporting, ad, lender, or cloud-upload SDK is
  installed.
- Confirm all demo data is synthetic and visibly labelled as synthetic.
- Confirm no source file handles passwords, OTPs, CAPTCHA responses, cookies, or
  session tokens.
- Confirm the production content script does not sample resource timing entries,
  send request-shape telemetry, or probe authenticated GST endpoints.
- Confirm live download observation remains bounded to a user-initiated run and
  does not persist or transmit raw download URLs, referrers, absolute local
  paths, filenames, portal HTML, or taxpayer identifiers.
- Confirm `pack:active-filed-returns-run`, when present, contains only the
  selected financial year, period, return type, run ID, revision, status, and
  lease timestamp needed to prevent overlapping local runs.
- Confirm `pack:full-fiscal-year-ledger`, when present, contains only financial
  year, period, return type, target status, attempts, safe signals/messages, and
  timestamps. It must not contain raw URLs/referrers, local paths, filenames,
  GSTIN/PAN, taxpayer names, ARNs, portal HTML, cookies, credentials, OTP, or
  CAPTCHA data.
- Confirm "Clear local Pack data" removes the full fiscal year ledger along with
  install/demo manifest metadata and session observations.
- Confirm the privacy policy, store declarations, and reviewer instructions
  still match actual runtime behavior.

Any server communication, new portal host, credential handling, analytics,
cloud upload, or account requirement is a material privacy change and needs a
fresh product, legal, security, and store-review pass.
