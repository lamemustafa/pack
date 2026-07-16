# Chrome Web Store Dashboard Closeout

This runbook closes dashboard-held parts of Chrome Web Store releases. It does
not replace the protected package submit workflow. It records the manual Chrome
Web Store Developer Dashboard steps that cannot be proved from source control
alone.

The public item remains on `v0.3.2`. The exact `v0.4.0` package upload
succeeded in workflow run `29507382500`, but publication is blocked by
incomplete dashboard requirements. The 2026-07-16 dashboard snapshots show a
blank required `offscreen` justification, stale GSTR-3B-only text, stale
promotional assets, and data-usage selections that do not disclose local
handling.

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
2. Confirm the dashboard package under review is version `0.4.0`, source commit
   `eb21404d274917876fcba20abce09216ce6348f4`, and release asset SHA-256
   `6ee4be24cafbe15db69275cac4da6b212f3de49b0f747eb9909eed7d293347c6`.
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
workflow. Configure the GitHub environment named `chrome-web-store-status` with:

- variable `CWS_PUBLISHER_ID`;
- read-only service-account secret `CWS_SERVICE_ACCOUNT_JSON`.

Do not copy the publish workflow's OAuth client secret or refresh token into the
status environment.

After the environment is configured, dispatch `Chrome Web Store Status` with:

```text
expected_version=0.4.0
require_published=false
```

This proves the submitted package is visible to the Chrome Web Store API without
requiring final publication. After Chrome publishes the item, dispatch the same
workflow with:

```text
expected_version=0.4.0
require_published=true
```

Record the run IDs and final state in
[`../PUBLICATION_READINESS.md`](../PUBLICATION_READINESS.md). Do not treat the
successful package upload or a saved dashboard draft as publication evidence.

## Evidence To Record

Before considering the `v0.4.0` Store closeout done, record:

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
