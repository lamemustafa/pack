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
  `downloadId`, and sanitized endpoint/path, MIME, byte-count, status and error
  classes. It must never retain a raw filename, local path, URL/referrer,
  GSTIN/PAN, taxpayer name, portal HTML, credential, cookie, token or artifact
  bytes. Shareable evidence must replace the runtime action id with a neutral
  `ACTION-*` alias and omit the browser download id.
- Confirm an artifact-reconciled target review may retain an ordered set of
  opaque per-artifact request identifiers, each paired with the exact numeric
  browser download ID it was reconciled from, only while it binds its completed
  summary to pending review removal. The download ID is carried here because the
  session checkpoints holding it do not survive a browser restart or extension
  update, while this review does. The matching session flow summary may retain
  the same set for that one completion marker. Neither record may retain a raw
  filename, local path, URL/referrer, GSTIN/PAN, taxpayer name, portal HTML,
  credential, cookie, token, or artifact bytes.
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
