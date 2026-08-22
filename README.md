# ComplyEaze Pack

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/lamemustafa/pack/actions/workflows/ci.yml/badge.svg)](https://github.com/lamemustafa/pack/actions/workflows/ci.yml)

ComplyEaze Pack is a local-first Chrome MV3 browser extension for collecting
compliance portal documents from an authorised browser session. V0 starts with
filed GSTR-3B PDFs, filed GSTR-1 summary PDFs, and optional GSTR-1 e-invoice
details Excel downloads from the GST Portal where the portal provides them. The
published package also downloads the GSTR-2B summary PDF through the GST
Portal's GSTR-2B page. Its details Excel ships in the same binary but is not
Store-advertised: that format's live evidence is not recorded yet.

V0 is intentionally narrow:

- no ComplyEaze, Axal, or Pack login;
- no GST Portal credential, OTP, CAPTCHA, cookie, or session-token capture;
- no GST document upload in the local-download workflow;
- no extension analytics or telemetry;
- exact GST host permissions only;
- live local downloads for selected filed GSTR-3B and GSTR-1 periods, with
  GSTR-1 Excel available only when the GST Portal provides the selected
  e-invoice details file;
- GSTR-2B statements, in stated scope, with the live gate recorded as not fully closed; see
  Chrome/Brave evidence before any broader release claim.

ComplyEaze Pack is an independent third-party tool. It is not affiliated with,
endorsed by, or operated by GSTN, CBIC, or the Government of India.

## Status

This public repository and the Chrome Web Store listing are open-source
pre-1.0 surfaces. The Store-published package is the `v0.5.0` beta, which
supersedes `v0.3.2`. It has live local download support for filed GSTR-3B PDFs,
filed GSTR-1 summary PDFs, optional GSTR-1 e-invoice details Excel files, and
GSTR-2B auto-drafted statements where the GST Portal provides them.

The previously published `v0.3.2` remains recorded below because its evidence
chain is complete and `v0.5.0`'s is not: publication is recorded on the
maintainer's observation of the Store dashboard, without a workflow run,
dashboard snapshot, or publication email captured in this repository. Treat the
version as current and the evidence as thinner than `v0.3.2`'s.

The Chrome Web Store package update for this GSTR-1 source release was
submitted through the protected workflow on 2026-07-04. Run `28704776806`
uploaded `v0.3.2` with upload state `SUCCEEDED`, publish state
`PENDING_REVIEW`, and no warnings. A maintainer-provided Chrome Web Store
publication email on 2026-07-06 records item ID
`nfnbhekccajjfgkppolomflaeledoccb`, item name
`ComplyEaze Pack: GSTR-1/GSTR-3B Downloader`, version `0.3.2`, and visibility
`Public`. The repository source is now the `v0.5.1` pre-1.0 beta release. <!-- x-release-please-version -->
That superseded release's evidence chain is the fully recorded one. The current
`v0.5.0` publication is maintainer-observed; see
`docs/PUBLICATION_READINESS.md` for exactly which evidence fields remain
unrecorded.
Live manifest/index/exception-file generation is outside the current release.
Future store updates require the release gates in
[docs/PUBLICATION_READINESS.md](docs/PUBLICATION_READINESS.md) and
[docs/RELEASE.md](docs/RELEASE.md).
Release PR titles use Conventional Commits so Release Please can decide the
next Pack version from each merge.

The beta's synthetic regression coverage exercises the supported target,
artifact, and recovery combinations. It is not a claim that every GST Portal
period or format has authorised live evidence; those broader claims remain
gated by the recorded publication evidence.

Full fiscal year download ships in the published package -- there is one binary --
as a local per-period ledger. It expands the selected financial year into eligible
GSTR-3B, GSTR-1, or GSTR-2B periods and runs them one at a time through the
single-period path. GSTR-2B full-year support uses the signed-in tab's
portal-loaded source data when available and exports the selected summary
PDF/details Excel files through Pack's local ZIP path. It is not Store-advertised,
and remains outside store-facing claims until exact-ZIP clean-profile evidence,
restart/resume evidence, and privacy-review evidence are recorded for the
release.

During each GSTR-3B full-year ZIP assembly with eligible files, Pack attempts to add two
files derived from the staged portal JSON already in that run:
`full-year-workbook.xlsx` and `full-year-summary.csv`. The workbook is the primary
GSTR-3B working-paper output. GSTR-1 and GSTR-2B runs add only the tidy CSV and report
that a consolidated workbook is not available for that return type; they never emit a
blank or mislabelled GSTR-3B workbook. The workbook contains exactly one sheet,
`GSTR-3B Consolidated`; the former standalone context CSV is not emitted. The data CSV has the
fixed columns `period`, `return_type`, `artifact`, `outcome`, `field_label`,
`field_path`, `value_text`, and `value_number`, with one row per period and
flattened field. Periods and artifacts without parseable JSON receive fixed
outcome rows instead of fabricated zeroes. The exact shaping rules are recorded
below for the producing Pack version.

The workbook's consolidated statement includes only mapped GSTR-3B Table 3.1
and Table 4 lines. A header block shows the GSTIN and legal name plus the
financial year above the typed financial-year month columns. Every parseable
GSTR-3B period must contain the same non-empty GSTIN and legal name; a missing
required identity fails the derived summary instead of borrowing one from
another period. When no period has parseable JSON, both identity cells remain
blank. The identity block, month header and first column stay frozen while
scrolling. The statement body keeps
the portal-dash applicability set for Table 3.1 and all four Table 4 tax columns.
Totals use scaled decimal arithmetic on the original JSON number text. If an
exact total cannot be emitted as a spreadsheet numeric cell, the Total cell
shows the exact sum as text when it fits in an Excel cell, otherwise a fixed
precision-limit explanation instead of a rounded figure.
After the final statement spacer, the normal two-row footer records the GST
portal as the source with a human-readable generation date, then included and
excluded Form coverage. When a shared Table 4 caption is withheld because the
rendered periods resolve to different versions, a third `Caption evidence` row
names the affected tables. Column B is width 58 so footer values are readable
without depending on text spill.
Recognized identity is absent from the data CSV; the required GSTIN and legal
name are written to the GSTR-3B workbook header. Other recognized taxpayer identity and
per-period filing identity, including ARN and ARN date, are separated into
transient summary context and are not written to either generated file. If no
period has parseable JSON, the identity value cells and statement figures are
blank. The tidy CSV remains the
machine-readable trace from a statement figure to its source path, including
unmapped paths and outcome rows. Both derived files persist only inside the
user-requested downloaded ZIP. If summary or workbook generation fails,
identity is inconsistent, or the combined derived output exceeds its local size
limit, Pack still exports the artifact ZIP and reports a fixed categorical
reason.

### Full-year summary rules for unreleased source builds

These rules apply to the GSTR-3B `full-year-workbook.xlsx` and the
`full-year-summary.csv` produced by source builds containing this feature. They
are not assigned to any released Pack version because no release contains this
format yet. The producing Pack version is available in the installed extension
manifest. Neither file carries an in-file format marker, so a machine consumer
cannot identify the CSV format from the CSV alone and must be given the
producing Pack version.

- **Envelope rule:** Pack classifies identity against the whole JSON document,
  then removes the artifact validator's documented return envelope before
  flattening data (`/data/r3b` for GSTR-3B and `/data` for GSTR-1 and GSTR-2B).
  `field_path` is relative to that envelope; a missing or non-object envelope
  emits `json-envelope-missing`.
- **Array rule:** configured GSTR-3B summary arrays with at most 64 elements
  expand only when every element has a unique, non-empty discriminator selected
  in order from `ty`, then `pos`. Expanded paths use that value, omit the
  discriminator field and emit no count row. Empty arrays emit
  `array-count-empty`; every other array emits one count row naming why it was
  not expanded. Non-empty GSTR-1 and GSTR-2B arrays remain count-only.
- **Number rule:** JSON number tokens expand without rounding into plain decimal
  `value_number` text; spreadsheet software may apply its own numeric precision
  limits.
- **Text rule:** JSON strings, booleans and null use `value_text`; an empty JSON
  string is a quoted empty CSV cell, while formula-like text is
  apostrophe-prefixed for spreadsheet safety.
- **Label rule:** `field_label` is populated only by the return-type label map
  with recorded official-source provenance. Portal-PDF row-text evidence does
  not claim that the JSON value was matched: for the existing Table 4 path
  associations, it verifies only the caption and tax-component text and does
  not upgrade the path association to value-matched evidence. JSON vocabulary
  or row order alone is not enough for a future path mapping, which also needs
  independent evidence for its JSON path or discriminator. Otherwise the label
  is empty and `field_path` remains canonical.
- **Identity rule:** recognized identity fields are classified from every
  RFC6901-decoded path segment across the whole document and removed from the
  data CSV. Every parseable GSTR-3B period must provide the same non-empty string
  GSTIN and legal name before either derived file is emitted; those values are
  written once in the workbook header. Optional recognized identity may be absent
  or non-string in some periods, but conflicting string values are still rejected.
  Other recognized taxpayer identity and per-period ARN/ARN date remain only in
  transient summary context and are not written to the workbook. Conflicting
  non-empty invariant identity fails summary generation.
- **Workbook number rule:** statement cells are numeric only when a portal
  decimal can be represented without changing its value and within spreadsheet
  precision; otherwise a present month carries a `Precision limit` marker. A
  missing or unparseable period stays blank. Totals use scaled exact arithmetic
  on the original decimal strings and are numeric only when the exact result can
  be emitted unchanged; otherwise the Total cell shows the exact sum as text and
  explains the precision limit instead of writing a rounded figure.

GSTR-9 is not the sum of twelve GSTR-3B returns. Its Table 4 requires outward
supplies split by counterparty type, which GSTR-3B does not contain, and it
further requires amendments, ITC claimed in a later financial year, and
reversals. This mapping shows where sourced 3B figures feed. It does not produce
GSTR-9 values.

| GSTR-3B line item        | GSTR-9 table it feeds | Basis                                                                                                                       | Verified financial year |
| ------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Table 4(A) ITC available | Table 6               | Official GST Portal Manual, GSTR-9 section 14.3: Table 6 reports ITC availed and Table 6A is auto-filled from Form GSTR-3B. | 2024-25                 |

The current source build correlates a download to its target through one
fail-closed evidence rule set, and that rule set is shared rather than
return-type gated: the single-period GSTR-3B, GSTR-1 and GSTR-2B flows use it,
as do the selected-file and full-year ZIP paths. It can accept completion only
on an exact browser-download ID match that is complete, non-empty, and
classified safe by the browser; interrupted, zero-byte, unknown-size,
still-scanning, browser-rejected and unconfirmed downloads settle as unobserved
and route to target review rather than to a retry.

A separate and much narrower class covers a _portal-created_ Blob download.
`target-bound-portal-click-blob` is limited to a single-period GSTR-3B PDF with
an exact action and browser-download match, and is disabled for GSTR-1, GSTR-2B,
selected-file ZIP/OPFS staging and every full-year flow — those flows correlate
their own extension-created downloads by exact ID instead. Neither path is live
or store-facing evidence.

## Install

### Chrome Web Store

The existing V0 listing is available on the Chrome Web Store:

https://chromewebstore.google.com/detail/complyeaze-pack-gst-gstr/nfnbhekccajjfgkppolomflaeledoccb

The `v0.3.2` GitHub release has the verified GSTR-1 source package. The package
update was submitted to Chrome Web Store review through workflow run
`28704776806` and published publicly as version `0.3.2` on 2026-07-06 based on
the maintainer-provided Chrome Web Store publication email.

Review the source, release notes, permissions, and privacy boundaries before
using Pack for GST records. The public Pack site is:

https://pack.complyeaze.com/gst

### From Source

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm exec wxt prepare
pnpm exec wxt build
```

Load the unpacked Chrome build from:

```text
.output/chrome-mv3
```

Use a separate Chrome profile for development or manual QA.

## Development

```sh
pnpm install --frozen-lockfile
node scripts/run-dependency-audit.mjs
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
```

The full release gate is:

```sh
pnpm install --frozen-lockfile
node scripts/run-dependency-audit.mjs
pnpm exec wxt prepare
pnpm exec prettier --check .
pnpm exec eslint . --max-warnings 0
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec wxt build
node scripts/verify-extension-package.mjs .output/chrome-mv3
pnpm verify:clean
pnpm exec wxt zip
node scripts/verify-extension-zip.mjs
git diff --check
```

Package scripts are also available:

```sh
pnpm verify
pnpm verify:release
```

Direct commands are preferred in constrained agent terminals if chained package
scripts hang or hide failure details.
`node scripts/run-dependency-audit.mjs` runs `pnpm audit --audit-level high`
with a timeout so local release verification fails clearly instead of hanging
indefinitely when the registry is unavailable.

## Architecture

ComplyEaze Pack uses WXT, Vite, React, and TypeScript.

- `src/entrypoints/background.ts`: service worker, local demo downloads, and
  bounded filed-return download flow orchestration.
- `src/entrypoints/content.ts`: passive GST context detection.
- `src/entrypoints/popup`: React popup.
- `src/entrypoints/options`: React options page.
- `src/core`: portal-neutral contracts, manifest, naming, and CSV.
- `src/connectors/gst`: GST-specific contracts and messages, detection,
  filed-return navigation, download triggering, and local demo data.
- `src/extension/manifest-policy.ts`: canonical extension metadata, permissions,
  host allow-list, CSP, homepage, and icons.
- `scripts/verify-extension-package.mjs`: built-package policy verification.

The reusable UCP-facing surface is the Pack plan/result/archive-manifest
contract, not shared credential or session handling. In the current release, that
contract is exercised by the local demo; the live GST path downloads PDFs without
persisting per-target `DownloadResult` records or a live manifest.

## Extension Storage

Pack uses Chrome extension storage only inside the current browser profile.

`chrome.storage.local`:

- `pack:install`: install/update metadata with product version, install
  timestamp, and `localOnly: true`;
- `pack:active-filed-returns-run`: a local run lease used to prevent overlapping
  filed-return downloads in the same browser profile. New writes use the bounded
  `running` status and store no added evidence or portal data;
- `pack:full-fiscal-year-ledger`: local-only full fiscal year run status with
  ledger, schema, plan, connector and extension-version identifiers; financial
  year, period, return type and artifact type; target status, safe
  messages/signals, attempts, revisions, ZIP phase and timestamps. During a
  final ZIP handoff, it also records the ZIP request timestamp and, after
  browser creation, the exact numeric browser download ID. Per-target
  diagnostics may include an opaque action ID, the exact numeric browser
  download ID, endpoint and download-path classes, MIME and byte-count classes,
  and status and error classes;
- `pack:single-period-staging`: a short-lived local recovery ledger for a
  selected-file ZIP. It stores an opaque ledger identifier, canonical scope
  (financial year, period, return type and selected artifacts), per-artifact
  safe status/diagnostics, the exact browser download ID during ZIP handoff,
  revisions and timestamps. It does not store filenames, raw URLs, local paths,
  portal HTML or taxpayer identifiers;
- `pack:filed-returns-target-review`: local-only single-period unresolved
  download review state with a canonical target identifier and scope, safe
  messages/signals, revisions and timestamps;
  The base target-review record may also store the attempt kind/phase, request
  and bounded candidate-window
  timestamps, an opaque `actionId`, the exact numeric browser `downloadId`,
  and, while a proven artifact completion is being finalized, a per-artifact
  set of artifact type, exact numeric browser download ID and opaque request
  ID,
  opaque staging-ledger or selected-file checkpoint identifiers/revisions, and
  a bounded opaque reference for one malformed session-only artifact checkpoint,
  sanitized endpoint/path,
  MIME, byte-count, status and error classes. It never stores the raw filename,
  local path, URL/referrer, GSTIN/PAN, taxpayer name, portal HTML, credentials,
  cookies, tokens or artifact bytes;
- `pack:last-manifest`: the last local demo archive manifest summary. The live
  GST download path does not write a live manifest in this release.

`chrome.storage.session`:

- `pack:last-context`: the latest safe GST page support context;
- `pack:last-filed-returns-observation`: the latest safe filed-returns page
  observation;
- `pack:last-filed-returns-flow-summary`: the latest temporary filed-return flow
  status. It may repeat the same opaque per-artifact request-identity set and
  exact numeric browser `downloadId` for the current UI result;
- `pack:last-gst-tab-id`: the browser tab ID of the most recent supported GST
  Portal tab, so a run can find its tab again without scanning every tab. A tab
  ID is a per-session integer assigned by the browser and carries no page, URL
  or taxpayer information.
- `pack.artifact-acquisition.v2.*`: a per-target, session-only recovery
  checkpoint for a direct artifact action. It contains the requested financial
  year, period, return/artifact type, opaque request ID, checkpoint state, and
  an `armedAt` timestamp used only to correlate a browser download created
  after that direct action. After browser creation it also contains the exact
  numeric download ID. It contains no raw
  filename, local path, URL/referrer, portal response, taxpayer identifier,
  credential, cookie, token or artifact bytes.
- `pack.artifact-acquisition-review.v1.*`: a short-lived, session-only mapping
  from an opaque review reference to a fixed-format digest of one malformed
  artifact-checkpoint key. It lets explicit cancellation remove only that
  exact checkpoint without copying its raw key into a new stored value; the
  mapping is never copied into the durable target review and is cleared with
  session storage.

The Options page "Clear local Pack data" control removes the local keys above
and clears Pack session storage. Pack does not store GST Portal credentials,
OTPs, CAPTCHA values, cookies, GSTIN/PAN, taxpayer names, portal HTML, raw
URLs/referrers, local download paths, filenames, or raw network captures.
Generated ZIP bytes and the derived full-year workbook and tidy CSV exist only
transiently in extension-controlled memory before browser handoff. The derived files
then persist only as entries in the user-requested downloaded ZIP; they are not
separately written to extension storage or OPFS. Source PDF, spreadsheet and
acquired portal-data JSON bytes may be written to the temporary local OPFS staging described below;
interrupted exports or cleanup failures may retain that staging locally across
saved-run recovery attempts. Pack removes artifact staging only after confirmed cleanup
or an explicit discard that successfully clears the retained staging.

The Options page also includes a foreground File System Access probe for
Chromium browsers. It runs only after a user click, writes and reads back a
synthetic probe file in a user-chosen folder, removes the probe file, and stores
no file or directory handle. It is not used for unattended GST artifact
downloads in this release.

During a user-initiated live download, Pack temporarily observes browser download
metadata such as download ID, origin, MIME type, filename, start time, state, and
byte counts to decide whether the browser reported a non-empty GST Portal file
for the selected artifact. This observation is bounded to the active run. Pack
does not transmit this metadata, and the current live path does not persist raw
URLs, referrers, absolute local paths, or filenames.

Where the source build uses the reviewed capture path, Pack may hold GST
artifact bytes transiently in memory or temporary local OPFS staging only for
an explicit user-started, target-bound local download or ZIP export and its
saved recovery/cleanup lifecycle. Pack clears that staging after confirmed
handoff and successful cleanup. Those bytes must not be written to extension
storage, IndexedDB, Cache Storage, diagnostics, logs, telemetry, support
bundles, or ComplyEaze systems.

## Privacy Invariants

ComplyEaze Pack V0 must not:

- collect credentials, OTPs, CAPTCHA responses, cookies, or session tokens;
- upload GST files or document contents in the local-download workflow;
- access unrelated websites;
- use GST data for advertising, lending, creditworthiness, or profiling;
- load remote executable code.

Public issues, pull requests, screenshots, and support messages must not contain
real GSTIN, PAN, Aadhaar, taxpayer/client names, credentials, portal HTML, raw
network captures, or downloaded GST files.

## Release Notes And Reviewer Docs

- [Publication readiness](docs/PUBLICATION_READINESS.md)
- [Release runbook](docs/RELEASE.md)
- [Chrome Web Store listing and assets](docs/chrome-web-store/listing.md)
- [Privacy QA](docs/PRIVACY_QA.md)
- [Chrome reviewer test instructions](docs/CHROME_REVIEWER_TEST.md)
- [Live filed returns spike notes](docs/LIVE_FILED_RETURNS_SPIKE.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[TRADEMARKS.md](TRADEMARKS.md) before opening issues or pull requests.

## License

Source code and documentation are licensed under the Apache License, Version 2.0.
See [LICENSE](LICENSE) and [NOTICE](NOTICE). ComplyEaze names, marks, logos,
icons, and official store identity are governed by [TRADEMARKS.md](TRADEMARKS.md).
