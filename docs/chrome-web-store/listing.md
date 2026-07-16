# Chrome Web Store Listing

This file is the source-controlled listing and privacy-practices brief for the
Chrome Web Store dashboard. Package upload and publish are automated
separately; dashboard text, assets, declarations, and reviewer instructions
remain dashboard-held evidence.

Use [`dashboard-closeout.md`](dashboard-closeout.md) for the action sequence.

## Current Store State

- Published package: `v0.3.2`.
- Pending package: `v0.4.0`, source commit
  `eb21404d274917876fcba20abce09216ce6348f4`.
- Release asset: `complyeazepack-0.4.0-chrome.zip`.
- Release asset SHA-256:
  `6ee4be24cafbe15db69275cac4da6b212f3de49b0f747eb9909eed7d293347c6`.
- GitHub release: <https://github.com/lamemustafa/pack/releases/tag/v0.4.0>.
- Workflow run `29507382500` built, tested, verified, zipped, published the
  prerelease assets, and uploaded the exact ZIP to Chrome Web Store. The Store
  upload state was `SUCCEEDED`; publish returned HTTP 400 because dashboard
  requirements were incomplete.
- The dashboard screenshots supplied on 2026-07-16 show stale GSTR-3B-only
  copy/assets and a blank required `offscreen` permission justification.

The Store-supported alpha claims remain GSTR-1 and GSTR-3B single-period
downloads. Private GSTR-2B and full-fiscal-year workflows are source-build
experiments and must not be advertised as Store-supported features.

## Store Listing Fields

Title from package:

```text
ComplyEaze Pack: GST Return Downloader
```

Summary from package:

```text
Alpha: locally download GSTR-1/GSTR-3B files; private GSTR-2B downloads are source-build experimental.
```

Description:

```text
Download filed GST returns locally from your active GST Portal session.

ComplyEaze Pack helps authorised users download their own filed GST returns using GST Portal pages already open in Chrome. The Store-supported alpha scope is:

• GSTR-3B: filed-return summary PDF
• GSTR-1: summary PDF and, when the portal provides it, e-invoice details Excel

Files are saved by Chrome to the user's device. Pack does not require a Pack or ComplyEaze account. It does not ask for or store GST Portal credentials, OTPs, CAPTCHA responses, cookies, or session tokens, and it does not upload GST documents or return contents to ComplyEaze.

The package also contains private source-build experiments for GSTR-2B and full-fiscal-year ZIP workflows. These are not Store-supported claims for this alpha release.

Pack operates only on the declared GST Portal hosts after a user starts a download. It keeps limited redacted recovery state locally so interrupted work does not retry blindly. Temporary artifact bytes may be staged in browser-local storage only for an explicit ZIP operation and are cleared after confirmed export or explicit discard.

ComplyEaze Pack is an independent third-party tool. It is not affiliated with, endorsed by, or operated by GSTN, CBIC, or the Government of India.
```

Other fields:

| Field          | Value                                 |
| -------------- | ------------------------------------- |
| Category       | `Tools`                               |
| Official URL   | `complyeaze.com`                      |
| Homepage URL   | `https://pack.complyeaze.com/gst`     |
| Support URL    | `https://pack.complyeaze.com/support` |
| Mature content | Off                                   |
| Payments       | Free of charge                        |
| Visibility     | Public                                |

## Privacy Practices Fields

Single purpose:

```text
ComplyEaze Pack lets authorised GST Portal users locally download their own selected filed-return artifacts from an active browser session. It does not file returns, request credentials, or transmit GST documents to ComplyEaze.
```

Permission justifications:

### `downloads`

```text
Used only after an explicit user action to save a target-bound GST Portal artifact or Pack-created ZIP locally and to verify that Chrome reports a completed, non-empty download.
```

### `offscreen`

```text
Used only for a bundled extension-owned offscreen document to create and revoke temporary Blob URLs, stage user-selected PDF or Excel bytes in browser-local OPFS for interrupted ZIP recovery, and assemble a requested ZIP. It loads no remote content and closes after the bounded operation.
```

### `scripting`

```text
Used only on the four declared GST Portal hosts to detect supported filed-return pages, verify the selected return, financial year, period, and artifact identity, and activate user-requested portal download controls.
```

### `storage`

```text
Used for local-only install metadata, selected scope and run lease, redacted recovery status, and synthetic demo summaries. It does not store credentials, cookies, OTPs, CAPTCHA responses, taxpayer identifiers, portal HTML, URLs, filenames, paths, or tax values. Temporary artifact bytes are isolated in browser-local OPFS, not chrome.storage, and are cleared after confirmed export or explicit discard.
```

### Host permissions

```text
Required only for four exact GST Portal hosts to detect supported filed-return pages, validate the selected return, financial year, period, and artifact, and execute user-initiated local downloads. Pack does not use broad host access, read credentials or cookies, or send portal data to ComplyEaze.
```

Remote code:

```text
No, I am not using remote code.
```

### Data usage selections

Chrome defines handling to include local processing and storage. Select the
categories Pack necessarily handles while moving a user's chosen filed return:

- [x] Personally identifiable information — a selected GST document can contain
      taxpayer identifiers or names; Pack does not parse, persist in extension
      state, or transmit them.
- [x] Financial and payment information — a selected GST return can contain tax
      and transaction values; Pack handles the artifact bytes locally only for the
      requested download/ZIP.
- [x] Website content — Pack reads supported GST Portal page state and controls
      locally to identify and download the selected artifact.
- [ ] Health information.
- [ ] Authentication information — Pack does not request, read, store, or
      transmit credentials, cookies, OTPs, CAPTCHA responses, or session tokens.
- [ ] Personal communications.
- [ ] Location.
- [ ] Web history — Pack does not collect or retain a list of visited pages.
- [ ] User activity — Pack does not log clicks, keystrokes, mouse movement, or
      browsing activity.

Certify all three Limited Use statements. Privacy policy URL:
`https://pack.complyeaze.com/privacy`.

Chrome's official FAQ explicitly states that local processing or storage still
requires disclosure:
<https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>.

## Asset Inventory

Use the seven generated PNGs under
[`assets/exports/`](assets/exports/). They are deterministic exports from the
source SVGs, contain synthetic UI only, and exclude GST Portal screenshots,
taxpayer data, filenames, paths, and downloaded content.

| Dashboard slot     | Export                                                      |
| ------------------ | ----------------------------------------------------------- |
| Store icon         | `public/icons/icon-128.png`                                 |
| Small promo tile   | `assets/exports/small-promo-440x280.png`                    |
| Marquee promo tile | `assets/exports/marquee-promo-1400x560.png`                 |
| Screenshot 1       | `assets/exports/screenshot-gstr3b-summary-pdf-1280x800.png` |
| Screenshot 2       | `assets/exports/screenshot-local-downloads-1280x800.png`    |
| Screenshot 3       | `assets/exports/screenshot-local-review-state-1280x800.png` |
| Screenshot 4       | `assets/exports/screenshot-options-clear-data-1280x800.png` |
| Screenshot 5       | `assets/exports/screenshot-reviewer-demo-1280x800.png`      |

The asset filenames, dimensions, source files, and current SHA-256 values are
recorded in `assets/exports/asset-hashes.json`.

## Dashboard Evidence Boundary

Saving the draft, submitting for review, and final publication are external
dashboard actions. Record the exact dashboard review state after each action;
source-controlled text and exports alone do not prove the dashboard accepted
them.
