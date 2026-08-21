# Chrome Web Store Listing

This file is the source-controlled listing and privacy-practices brief for the
Chrome Web Store dashboard. Package upload and publish are automated
separately; dashboard text, assets, declarations, and reviewer instructions
remain dashboard-held evidence.

Use [`dashboard-closeout.md`](dashboard-closeout.md) for the action sequence.

## Current Store State

- Published package: `v0.3.2`.
- Submitted package: `v0.5.0`, source commit
  `985e9aa91d30e2955c996cd483496ebe92cfeef6`.
- GitHub pre-release: <https://github.com/lamemustafa/pack/releases/tag/v0.5.0>.
- Release ZIP SHA-256:
  `1ecea75998ce69ae79caf8e6d27134516320a527d298ef164543cf87f6c07e62`.
- Chrome Web Store state: submitted and in review as a draft. It is not
  approved, published, or live; `v0.3.2` remains the last confirmed Store
  publication and the basis for Store-published public claims.
- Historical `v0.4.0` workflow run `29507382500` built, tested, verified, and
  uploaded that release's exact ZIP with Store upload state `SUCCEEDED`, but
  publish returned HTTP 400 because dashboard requirements were incomplete.
  It was not published.
- The dashboard screenshots supplied on 2026-07-16 are historical `v0.4.0`
  evidence. They showed stale GSTR-3B-only copy/assets and a blank required
  `offscreen` permission justification; they do not prove the current draft's
  dashboard fields.

This section is the canonical source-controlled record for the current Store
version and review state. Release-readiness and dashboard-closeout documents
must not claim a newer state than this record.

The Store-supported beta claims are GSTR-1, GSTR-3B and GSTR-2B single-period
downloads. The full-fiscal-year workflow remains a source-build capability and
must not be advertised as a Store-supported feature until the four evidence
gates in `PUBLICATION_READINESS.md` are recorded for the release.

## Store Listing Fields

Title from package:

```text
ComplyEaze Pack: GST Return Downloader
```

Summary from package:

```text
Beta: locally download your filed GSTR-1, GSTR-3B and GSTR-2B returns from your own GST Portal session.
```

Description:

```text
Download filed GST returns locally from your active GST Portal session.

ComplyEaze Pack helps authorised users download their own filed GST returns using GST Portal pages already open in Chrome. The Store-supported beta scope is:

• GSTR-3B: filed-return summary PDF, or the portal's own JSON
• GSTR-1: summary PDF and, when the portal provides it, e-invoice details Excel
• GSTR-2B: summary PDF, or the portal's own JSON

Files are saved by Chrome to the user's device. Pack does not require a Pack or ComplyEaze account. It does not ask for or store GST Portal credentials, OTPs, CAPTCHA responses, cookies, or session tokens, and it does not upload GST documents or return contents to ComplyEaze.

The package also contains a full-fiscal-year workflow that saves a whole year of eligible periods as one ZIP. It is available in source builds and is not a Store-supported claim for this beta release.

Pack's content script runs only on the four declared GST Portal hosts. When a supported page loads, it reads page context locally so Pack can identify eligible workflows; artifact capture and downloads start only after an explicit user action. Pack keeps limited redacted recovery state locally so interrupted work does not retry blindly. Temporary artifact bytes may be staged in browser-local OPFS for explicit capture or ZIP operations. Pack normally removes those bytes after confirmed export or explicit discard; if local cleanup fails, it retains them with a cleanup-pending status until a later cleanup attempt succeeds.

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
Used only after an explicit user action to save a target-bound GST Portal artifact or Pack-created ZIP locally, verify that Chrome reports a completed non-empty download, or create bounded synthetic reviewer-demo and download-prompt diagnostic files from Pack's Options page.
```

### `offscreen`

```text
Used only for a bundled extension-owned offscreen document to create and revoke temporary Blob URLs, stage user-selected PDF, Excel or portal-data JSON bytes in browser-local OPFS for interrupted ZIP recovery, and assemble a requested ZIP. It loads no remote content and closes after the bounded operation.
```

### `scripting`

```text
Used only on the four declared GST Portal hosts to detect supported filed-return pages; verify the selected return, financial year, period, and artifact identity; activate user-requested portal download controls and, for those action-bound capture paths, intercept the resulting fetch, XHR, or Blob response in the page's main world so the selected PDF or Excel bytes can be saved locally or staged in OPFS; and, when portal data (JSON) is the requested artifact, issue one authenticated same-origin request from the page's own context to the portal's JSON endpoint for the verified period so those bytes can be saved locally or staged in OPFS.
```

### `storage`

```text
Used for local-only install metadata, the allow-listed GST origin, selected scope and run lease, redacted recovery status, and synthetic demo summaries including synthetic filenames and relative paths. It does not store credentials, cookies, OTPs, CAPTCHA responses, taxpayer identifiers, portal HTML, raw GST Portal URLs, real GST filenames or local paths, or tax values. Temporary artifact bytes are isolated in browser-local OPFS, not chrome.storage. Pack normally removes those bytes after confirmed export or explicit discard; if cleanup fails, it retains them locally with a cleanup-pending status until a later cleanup attempt succeeds.
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
      taxpayer identifiers or names; Pack does not extract them into extension
      metadata or transmit them. Selected artifact bytes can be staged temporarily
      in browser-local OPFS and retained locally if cleanup fails.
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
[`assets/exports/`](assets/exports/). They are generated from the source SVGs,
contain synthetic UI only, and exclude GST Portal screenshots, taxpayer data,
real GST filenames, local paths, and downloaded content. The committed manifest
binds every generated PNG to the exact source SVG bytes. Regeneration on a host
with different installed fonts can produce different pixels, so upload only the
committed hash-matched exports after a maintainer has visually reviewed them for
the exact submission. The regenerated `v0.5.0` exports have not yet received
that visual review.

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

The asset filenames, dimensions, source files, source SVG SHA-256 values, and
generated PNG SHA-256 values are recorded in
`assets/exports/asset-hashes.json`.

## Dashboard Evidence Boundary

Saving the draft, submitting for review, and final publication are external
dashboard actions. Record the exact dashboard review state after each action;
source-controlled text and exports alone do not prove the dashboard accepted
them.
