# Chrome Web Store Dashboard Closeout

This runbook closes dashboard-held parts of Chrome Web Store releases. It does
not replace the protected package submit workflow. It records the manual Chrome
Web Store Developer Dashboard steps that cannot be proved from source control
alone.

For `v0.3.2`, a maintainer-provided Chrome Web Store publication email on
2026-07-06 records item ID `nfnbhekccajjfgkppolomflaeledoccb`, item name
`ComplyEaze Pack: GSTR-1/GSTR-3B Downloader`, version `0.3.2`, and visibility
`Public`.

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
2. Confirm the dashboard package under review or published package matches the
   exact release upload. For `v0.3.2`, this is the upload submitted by GitHub
   Actions run `28704776806`.
3. Copy the title, short description, opening description, and government
   non-affiliation disclaimer from [`listing.md`](listing.md).
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
6. Fill the privacy-practices fields from the actual runtime behavior checked in
   [`../PRIVACY_QA.md`](../PRIVACY_QA.md). Do not answer a privacy question as
   "no data" only because the data remains local; Chrome's policy still treats
   locally handled user information as needing truthful disclosure.
7. Fill reviewer/test instructions from
   [`../CHROME_REVIEWER_TEST.md`](../CHROME_REVIEWER_TEST.md). Do not provide
   real GST Portal credentials or taxpayer data.
8. Submit the dashboard update and record the dashboard image/listing review
   state in [`listing.md`](listing.md) and
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
expected_version=0.3.2
require_published=false
```

This proves the submitted package is visible to the Chrome Web Store API without
requiring final publication. After Chrome publishes the item, dispatch the same
workflow with:

```text
expected_version=0.3.2
require_published=true
```

Record the run IDs and final state in
[`../PUBLICATION_READINESS.md`](../PUBLICATION_READINESS.md). For `v0.3.2`, the
publication email is already recorded; the `require_published=true` status run
is evidence hardening after read-only status credentials are available.

## Evidence To Record

Before considering the GSTR-1 Store closeout done, record:

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
