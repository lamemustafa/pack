# Chrome Web Store Dashboard Closeout

This runbook closes dashboard-held parts of Chrome Web Store releases. It does
not replace the protected package submit workflow. It records the manual Chrome
Web Store Developer Dashboard steps that cannot be proved from source control
alone.

The public item remains on `v0.3.2`. The `v0.5.0` package is submitted and in
review as a draft; it is not approved, published, or live. The exact historical
`v0.4.0` package upload succeeded in workflow run `29507382500`, but that
release was not published. The 2026-07-16 dashboard snapshots are historical
`v0.4.0` evidence: they showed a blank required `offscreen` justification,
stale GSTR-3B-only text, stale promotional assets, and data-usage selections
that did not disclose local handling. They do not prove the current draft's
dashboard fields.

## Source Inputs

Use these reviewed source-controlled inputs for the dashboard update:

| Dashboard item        | Source                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| Listing copy          | [`listing.md`](listing.md)                                             |
| Screenshot PNGs       | [`assets/exports/`](assets/exports/)                                   |
| Asset manifest        | [`assets/exports/asset-hashes.json`](assets/exports/asset-hashes.json) |
| Privacy QA checklist  | [`../PRIVACY_QA.md`](../PRIVACY_QA.md)                                 |
| Reviewer instructions | [`../CHROME_REVIEWER_TEST.md`](../CHROME_REVIEWER_TEST.md)             |
| Release evidence      | [`../PUBLICATION_READINESS.md`](../PUBLICATION_READINESS.md)           |

Official Chrome references to re-check before editing the dashboard:

- <https://developer.chrome.com/docs/webstore/images>
- <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>
- <https://developer.chrome.com/docs/webstore/publish>

## Dashboard Update Checklist

1. Open the Chrome Web Store Developer Dashboard for the existing Pack item:
   `nfnbhekccajjfgkppolomflaeledoccb`.
2. Confirm the dashboard package under review is version `0.5.0`, source commit
   `985e9aa91d30e2955c996cd483496ebe92cfeef6`, and release ZIP SHA-256
   `1ecea75998ce69ae79caf8e6d27134516320a527d298ef164543cf87f6c07e62`.
3. Copy every Store listing and Privacy practices field from
   [`listing.md`](listing.md). Do not keep the previous GSTR-3B-only
   description or permission justifications.
4. Upload the generated PNG exports from [`assets/exports/`](assets/exports/):
   `small-promo-440x280.png`,
   `marquee-promo-1400x560.png`,
   `screenshot-local-downloads-1280x800.png`,
   `screenshot-gstr3b-summary-pdf-1280x800.png`,
   `screenshot-local-review-state-1280x800.png`,
   `screenshot-options-clear-data-1280x800.png`, and
   `screenshot-reviewer-demo-1280x800.png`.
5. Reconfirm every uploaded image is synthetic/redacted and contains no real GST
   Portal screenshot, taxpayer name, GSTIN/PAN, portal HTML, downloaded GST
   file, local path, cookie, header, OTP, or CAPTCHA content.
6. Fill the privacy-practices fields from the exact checklist in
   [`listing.md`](listing.md) and runtime behavior checked in
   [`../PRIVACY_QA.md`](../PRIVACY_QA.md). Select personally identifiable
   information, financial and payment information, and website content because
   Chrome treats local processing as handling. Leave authentication, web
   history, and user activity unchecked because Pack does not request or retain
   those classes.
7. Fill reviewer/test instructions from
   [`../CHROME_REVIEWER_TEST.md`](../CHROME_REVIEWER_TEST.md). Do not provide
   real GST Portal credentials or taxpayer data.
8. Save the dashboard draft and confirm no required-field warning remains.
9. Submit the dashboard update for review and record the image/listing/privacy
   review state in [`listing.md`](listing.md) and
   [`../PUBLICATION_READINESS.md`](../PUBLICATION_READINESS.md).

## Status Monitor Closeout

The read-only status workflow is separate from the protected upload/publish
workflow. Configure the GitHub environment named `chrome-web-store-status`
with `CWS_PUBLISHER_ID` and either accepted credential form:

- service-account secret `CWS_SERVICE_ACCOUNT_JSON`; or
- dedicated read-only OAuth secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and
  `CWS_REFRESH_TOKEN`.

The checker owns credential-form validation and performs only the read-only
`fetchStatus` call. Its service-account flow requests the read-only API scope;
an OAuth refresh token must have been provisioned with the read-only grant. Do
not copy broader publishing credentials into this environment. A non-strict
scheduled run without either form records an explicit skip. A manual dispatch,
including `require_published=true`, fails when it cannot authenticate.

After the environment is configured, dispatch `Chrome Web Store Status` with:

```text
expected_version=0.5.0
require_published=false
```

This proves the submitted package is visible to the Chrome Web Store API without
requiring final publication. After Chrome publishes the item, dispatch the same
workflow with:

```text
expected_version=0.5.0
require_published=true
```

Record the run IDs and final state in
[`../PUBLICATION_READINESS.md`](../PUBLICATION_READINESS.md). Do not treat the
successful package upload or a saved dashboard draft as publication evidence.

## Evidence To Record

Before considering the `v0.5.0` Store closeout done, record:

- dashboard listing text review state;
- dashboard screenshot and promotional image review state;
- privacy-practices declaration snapshot or reviewer/approver note;
- reviewer-instructions snapshot or reviewer/approver note;
- read-only status workflow run ID for `require_published=false`, when
  available;
- final Chrome Web Store state, rejection reason, or published-version evidence;
- issue links for any remaining dashboard or credential blockers.

Current tracking issues:

- <https://github.com/lamemustafa/pack/issues/59>
- <https://github.com/lamemustafa/pack/issues/62>
