# Chrome Web Store Listing

This file is the source-controlled listing and privacy-practices brief for the
Chrome Web Store dashboard. Package upload and publish are automated
separately; dashboard text, assets, declarations, and reviewer instructions
remain dashboard-held evidence.

Use [`dashboard-closeout.md`](dashboard-closeout.md) for the action sequence.

## Current Store State

- Published package: `v0.5.0` (pre-1.0 beta), source commit
  `985e9aa91d30e2955c996cd483496ebe92cfeef6`. Publication is recorded on the
  maintainer's observation of the Store dashboard; the observation fields are
  not captured in this repository.
- Superseded package: `v0.3.2`, whose publication evidence chain is complete.
- GitHub pre-release: <https://github.com/lamemustafa/pack/releases/tag/v0.5.0>.
- Release ZIP SHA-256:
  `1ecea75998ce69ae79caf8e6d27134516320a527d298ef164543cf87f6c07e62`.
- Chrome Web Store state: `v0.5.0` is published and live, and is the basis for
  Store-published public claims. `v0.3.2` is superseded.
- The submitted ZIP's bytes are immutable and carry that commit's manifest
  description. Later corrections to the description in this repository do not
  change the published package; they reach users only at the next submission.
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

The Store-supported beta claims are GSTR-1 and GSTR-3B filed returns and GSTR-2B
auto-drafted statements, single-period. The full-fiscal-year workflow ships in the
same binary -- there is only one -- but is not Store-advertised, and must not be
advertised until the four evidence gates in `PUBLICATION_READINESS.md` are
recorded for the release.

## Store Listing Fields

Title from package:

```text
ComplyEaze Pack: GST Return Downloader
```

> **The summary is package metadata; the description is dashboard-held.** They reach the Store by
> different routes and must not be treated alike.
>
> The **summary** below comes from the packaged manifest, so it reaches users only when a package
> built from this commit or later is submitted. The bytes of any previously submitted ZIP are
> immutable and still carry the older wording; updating HEAD cannot change them. Confirm the package
> being submitted was built from a commit that contains this text before using it in a closeout.
>
> The **description** is entered in the dashboard, as the introduction to this file states, so it can
> be corrected on the live listing without a new package — and should be, since the currently
> published listing carries superseded wording.

Summary from package:

```text
Beta: Save filed GSTR-1 and GSTR-3B returns and auto-drafted GSTR-2B statements locally. No account or stored portal credentials.
```

Description:

```text
ComplyEaze Pack helps an authorised user, already signed in to the GST Portal in Chrome, download their own filed GSTR-3B and GSTR-1 artifacts and their own auto-drafted GSTR-2B statements to their device.

There is no Pack or ComplyEaze account. Pack never asks for or stores GST Portal credentials, OTPs, CAPTCHA answers, cookies, or tokens. The extension does not upload GST documents or return contents to ComplyEaze. Its content script runs only on the four declared gst.gov.in hosts. Artifact capture starts only after an explicit user action. Before treating a selected GST artifact as downloaded, Pack verifies it as complete and non-empty, and retains local, redacted recovery status if an interrupted run needs review. Selected artifact bytes may be staged temporarily in browser-local OPFS during capture or ZIP assembly; Pack removes them after a confirmed export or an explicit discard, and retains them with a cleanup-pending status if that cleanup fails.

The Pack website's privacy notice separately discloses its Sentry error diagnostics. The browser extension has no analytics or telemetry and does not send extension data to Sentry.

Supported scope: one return period at a time. Available formats depend on the selected GST Portal page; Pack saves a PDF or Excel workbook only when that page provides the selected artifact.

• GSTR-3B: filed-return summary PDF
• GSTR-1: filed-return summary PDF and, when the GST Portal provides it, e-invoice details Excel
• GSTR-2B: auto-drafted statement summary PDF

What Pack does not do: file returns, act on behalf of a taxpayer, or provide full-year bundles.

The package contains further capability that this listing does not claim, because the release evidence for those claims is not yet recorded.

ComplyEaze Pack is open source under the Apache-2.0 license: https://github.com/lamemustafa/pack

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
ComplyEaze Pack lets an authorised user, already signed in to the GST Portal, locally download their own selected filed GSTR-1 and GSTR-3B artifacts and auto-drafted GSTR-2B statements. It does not file returns, request credentials, or transmit GST documents to ComplyEaze.
```

Permission justifications:

### `downloads`

```text
Used after an explicit user action to save a target-bound GST Portal artifact or Pack-created ZIP locally and verify that Chrome reports the download completed and non-empty. The Options page also creates user-started synthetic reviewer-demo and download-prompt test files.
```

### `offscreen`

```text
Used only by a bundled extension-owned offscreen document to create and revoke temporary Blob URLs, stage user-selected PDF, Excel, or portal-data JSON bytes in browser-local OPFS for interrupted ZIP recovery, and assemble a requested ZIP. It loads no remote content and closes after the bounded operation.
```

### `scripting`

```text
Used only on the four declared GST Portal hosts to detect supported pages, verify the selected return, financial year, period, and artifact, and activate a user-requested portal download control. For that action-bound capture, it can intercept the resulting PDF or Excel response in the page's main world for local saving or OPFS staging; when portal data (JSON) is selected, it can make one authenticated same-origin request from the page context for the verified period. It does not run on other sites.
```

### `sidePanel`

```text
Used only to provide Pack's user-facing control panel while the authorised user works in their GST Portal tab. It keeps the user-initiated workflow visible without requiring access to unrelated tabs or websites.
```

### `storage`

```text
Used for local-only install metadata, the allow-listed GST origin, selected scope and run lease, redacted recovery status, and synthetic-demo summaries with synthetic filenames and relative paths. It does not store credentials, cookies, OTPs, CAPTCHA responses, taxpayer identifiers, portal HTML, raw GST Portal URLs, real GST filenames or local paths, or tax values. Temporary artifact bytes are isolated in browser-local OPFS, not chrome.storage, and normally removed after confirmed export or explicit discard; a cleanup failure leaves a local cleanup-pending status until a later cleanup attempt succeeds.
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

The privacy policy separately discloses Sentry error diagnostics for the Pack website. They are not
extension analytics or telemetry: the extension does not send extension data to Sentry.

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
