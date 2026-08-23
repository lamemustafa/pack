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
  send request-shape telemetry, or probe/replay authenticated GST download
  endpoints. Reviewed same-origin filed-return search, role-status, and navigation
  requests remain allowed only inside the explicit user-started flow.
- Confirm live download observation remains bounded to a user-initiated run and
  does not persist or transmit raw download URLs, referrers, absolute local
  paths, filenames, portal HTML, or taxpayer identifiers.
- Confirm transient artifact-byte handling is used only for an explicit
  user-started, target-bound local download or ZIP export and its saved
  recovery/cleanup lifecycle. Generated ZIP bytes must remain transiently in
  memory. Captured PDF, XLS and portal-data JSON bytes may also use temporary
  local OPFS staging;
  interrupted exports or cleanup failures may retain that staging across
  recovery attempts until confirmed cleanup or a successful explicit discard.
  Artifact bytes must not be written to extension storage, IndexedDB, Cache
  Storage, diagnostics, logs, telemetry, support bundles, or ComplyEaze systems.
- Confirm each GSTR-3B full-year ZIP assembly with eligible files attempts to add
  `full-year-workbook.xlsx` and `full-year-summary.csv`, both derived locally
  from staged portal JSON already in that run. A GSTR-1 assembly must add the
  tidy CSV only and emit the fixed `full-fiscal-year-workbook-not-applicable`
  outcome.
- Confirm a GSTR-2B assembly with invoice-level records adds its own
  `full-year-workbook.xlsx` **and no tidy CSV**, with an `ITC summary` sheet
  first and one sheet per present section. On every sheet, confirm the owner
  GSTIN appears in the header block and in **no** invoice row. Owner legal and
  trade name are checked the same way **when the source carries them**: a
  captured GSTR-2B response has neither, and the workbook omits a header row
  rather than printing a labelled blank, so their absence is correct rather than
  a finding.
- Confirm counterparty GSTIN and trade name appear in the invoice rows of the
  sections that carry a counterparty -- B2B, B2BA and CDNR. IMPG has none by
  design, since an import is declared on a bill of entry, so their absence there
  is also correct. Withholding a counterparty where one exists would empty the
  column the statement exists to report.
- Confirm the `ITC summary` sheet carries only the portal's own figures from
  `data.itcsumm`, and that a category or section name it does not recognise is
  either rendered as plain text or withheld and counted, never printed when the
  name itself could carry an identity.
- Confirm a GSTR-2B assembly with no invoice-level record emits
  `full-fiscal-year-workbook-no-records`, and that one refused for its **shape or
  for a value that cannot be written to a spreadsheet unchanged** emits
  `full-fiscal-year-workbook-unavailable`; both must keep the tidy CSV.
- Confirm the opposite for the other two refusals: a **privacy or identity**
  rejection must fail the whole derived-summary path with no CSV and no
  workbook. Those say something about the source document, not about the
  workbook, and must stay fail-closed. Do not read the line above as covering
  them.
- No assembly may emit a GSTR-3B workbook for another return type. The
  standalone context CSV must be absent.
  The data CSV must keep
  the fixed tidy columns `period`, `return_type`, `artifact`, `outcome`,
  `field_label`, `field_path`, `value_text`, and `value_number`; keep canonical
  JSON Pointer paths. Confirm only the configured GSTR-3B summary arrays with
  at most 64 elements may expand, using the first shared discriminator in the
  ordered candidate list `ty`, `pos`, and only when every discriminator is
  non-empty and unique. Expanded paths must use the discriminator value, omit
  the discriminator field, and emit no count row. Empty arrays must emit one
  count row with `array-count-empty`. Every other array, including every
  non-empty GSTR-1 and GSTR-2B array, must emit one count row whose `outcome`
  names why it was not expanded. Confirm the whole-document pre-scan retains
  only paths selected by the canonical identity predicate and rejects a
  forbidden credential/session path before retaining its value. Identity must
  be classified before the canonical artifact-validation envelope is removed
  for data flattening (`/data/r3b` for
  GSTR-3B and `/data` for GSTR-1 and GSTR-2B), `field_path` is relative to that
  envelope, and a missing or non-object envelope emits a
  `json-envelope-missing` outcome row. Expand JSON
  numbers without rounding into plain decimal `value_number` text; preserve strings
  and identifiers as text except for the existing apostrophe guard on
  formula-like text; and use fixed outcome rows where no parseable JSON exists.
  Labels must come only from the return-type map with recorded provenance that
  distinguishes two-period portal-PDF value cross-checks, portal-PDF row-text
  transcriptions that do not claim a JSON value match, and the pre-existing
  offline-utility mappings. For existing Table 4 path associations, the
  row-text tier verifies only the caption and tax-component text; it does not
  upgrade the path association to value-matched evidence. JSON vocabulary or
  row order alone is not caption evidence. A future path mapping requires the
  portal PDF row text plus independent evidence for its JSON path or
  discriminator, or it must stay unmapped. The workbook must
  contain exactly one sheet, `GSTR-3B Consolidated`. Its header must contain
  the recognized GSTIN and legal name once plus the financial year above twelve
  typed date columns. Every parseable GSTR-3B period must carry the same
  non-empty string GSTIN and legal name; a missing or non-string required
  identity must fail the derived summary, while optional recognized identity
  may be absent or non-string in some periods but must remain consistent when
  present as a string. When no period is parseable, both identity cells remain
  blank. Those header rows, the
  `Description` row and the first
  column must remain frozen while scrolling. The statement body must retain
  numeric figure cells and totals summed exactly from source decimal text, a
  `Precision limit` marker for a present month that cannot be represented as a
  spreadsheet numeric cell, an explanatory text total carrying the exact sum
  when it fits in an Excel cell and a fixed precision-limit explanation
  otherwise, blank cells for missing or
  unparseable periods, only mapped Table 3.1 and Table 4 rows, the portal-dash
  applicability set for Table 3.1 and all four Table 4 tax columns. After the
  final spacer, the footer must contain `Source` and `Coverage` rows, plus a
  `Caption evidence` row only when shared Table 4 captions are withheld for
  mixed rendered periods. `Source` must name filed GSTR-3B returns from the GST portal and use the
  existing generation clock as a human-readable date; `Coverage` must state
  Tables 3.1 and 4 are included and Tables 3.1.1, 3.2, 5, 5.1 and 6.1 are not.
  Column B must remain wide enough to show either footer value without relying
  on text spill. The GSTR-9 disclaimer and format token must be absent. GSTIN and
  legal name must appear nowhere else in the workbook and no owner or filing
  identity may appear in the data CSV. A trade name may appear only with positive
  evidence that it belongs to a counterparty record; every unproven trade-name
  location is withheld. Other recognized owner identity plus per-period ARN and ARN date may exist only in transient
  summary context and must not be written to either generated file. The tidy
  CSV must retain unmapped paths and outcomes. The seven format rules, sourced
  GSTR-9 mapping and disclaimer must live under the producing Pack version in
  the README, not in generated rule rows or a second sheet. The workbook and
  CSV have no in-file format marker; a machine consumer of a separated CSV must
  be given the producing Pack version because it cannot infer that version from
  the CSV alone.
  Both derived files must remain
  output-only ZIP entries: their bytes
  may be transient in extension-controlled memory before browser handoff and
  persist in the user's downloaded ZIP, but never write separately to OPFS,
  extension storage, diagnostics, logs, telemetry, support bundles, popup
  content, or ComplyEaze systems. If summary or workbook generation fails,
  identity is inconsistent, or the combined output exceeds its local size
  limit, confirm the artifact ZIP still exports and the popup shows only a
  fixed categorical reason that distinguishes workbook generation failure from
  no parseable data.
- Confirm the source-build `target-bound-portal-click-blob` path is enabled only
  for a single-period GSTR-3B PDF after the exact target action and one matching
  browser download candidate. It must remain disabled for GSTR-1, GSTR-2B,
  selected-file ZIP/OPFS staging and every full-year flow. Shareable evidence
  must reject this class outside that exact scope.
- Confirm `pack:active-filed-returns-run`, when present, contains only the
  selected financial year, period, return type, artifact type, run ID,
  revision, the bounded `running` status for new writes, and lease timestamp
  needed to prevent overlapping local runs.
- Confirm `pack:filed-returns-target-review`, when present, contains only the
  canonical target identifier/scope, unresolved status, safe signals/messages,
  revision and timestamps needed to block implicit retry. Recovery may
  additionally retain the attempt kind/phase, request and bounded
  candidate-window timestamps, an opaque `actionId`, an opaque staging-ledger
  or selected-file checkpoint identifier/revision, the exact numeric browser
  `downloadId`, and, while finalizing a proven artifact completion, a
  per-artifact set of artifact type, exact numeric browser download ID and
  opaque request ID, plus sanitized endpoint/path, MIME, byte-count, status and
  error classes. It must never retain a raw filename, local path, URL/referrer,
  GSTIN/PAN, taxpayer name, portal HTML, credential, cookie, token or artifact
  bytes. Shareable evidence must replace the runtime action id with a neutral
  `ACTION-*` alias and omit the browser download id.
  Neither record may retain a raw filename,
  local path, URL/referrer, GSTIN/PAN, taxpayer name, portal HTML, credential,
  cookie, token, or artifact bytes.
- Confirm each session-only `pack.artifact-acquisition.v2.*` checkpoint contains
  only its requested target scope, opaque request ID, state, exact numeric
  browser download ID after creation, and the `armedAt` timestamp used only to
  correlate a candidate created after the direct artifact action. It must never
  retain a raw filename, local path, URL/referrer, GSTIN/PAN, taxpayer name,
  portal HTML, credential, cookie, token, or artifact bytes.
- Confirm `pack:full-fiscal-year-ledger`, when present, satisfies the two runtime
  validators that own its shape, rather than a field list restated here:
  - `isFullFiscalYearLedger` in
    `src/background/filed-returns-full-fiscal-year-validation.ts`, which admits
    exactly `LEDGER_KEYS` and `TARGET_KEYS` through `hasOnlyKeys` and so rejects
    any field the code does not write; and
  - `isValidFiledReturnsDownloadDiagnosticState` in
    `src/background/filed-returns-download-diagnostic-state.ts` for any
    diagnostics present, which is what actually enforces a canonical action ID
    and an allow-listed error category. The `FiledReturnsDownloadDiagnostic`
    interface alone does **not**: it types `actionId` and `errorCategory` as
    unrestricted strings, so a raw value can satisfy the type and still be
    unsafe.

  Independently confirm the ledger contains no raw URLs/referrers, local paths,
  filenames, GSTIN/PAN, taxpayer names, ARNs, portal HTML, cookies, credentials,
  OTP, or CAPTCHA data.

  Three earlier revisions of this item were hand-maintained field lists and each
  drifted from the code in a different direction — one omitted the ZIP
  correlation fields, one omitted the diagnostic identity fields, one omitted
  `targetId` and `currentTargetId` — so QA following any of them would have
  rejected a valid ledger. Do not replace the validator references with a list
  again; a list here cannot be checked by anything, while these two functions are
  exercised by the suite on every run.

- Confirm "Clear local Pack data" is only exposed from Pack Options, blocks
  while filed-return recovery remains unresolved, clears recoverable temporary
  OPFS staging before deleting its ledger identifiers, and then removes the
  active run marker, target-review marker, full fiscal year ledger, install/demo
  manifest metadata, and session observations.
- Confirm the privacy policy, store declarations, and reviewer instructions
  still match actual runtime behavior.
- Confirm Chrome Web Store data-usage declarations include personally
  identifiable information, financial and payment information, and website
  content. A selected filed return can contain taxpayer identifiers and tax or
  transaction values, and Chrome requires disclosure even when Pack only
  handles them locally. Do not select authentication information, web history,
  or user activity unless the runtime begins requesting or retaining those
  categories.
- Confirm the `offscreen` justification describes only the bundled extension
  document's temporary Blob URL, local OPFS staging/cleanup, and ZIP assembly
  work. It must not imply remote content, background browsing, or persistent
  extension-storage of artifact bytes.

Any server communication, new portal host, credential handling, analytics,
cloud upload, or account requirement is a material privacy change and needs a
fresh product, legal, security, and store-review pass.
