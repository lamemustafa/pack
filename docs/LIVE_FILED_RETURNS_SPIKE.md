# Private Filed Returns Spike

This is the first live GST scope for Pack V0. It is private engineering work,
not a public launch path.

## Scope

- Portal area: `Services > Returns > View Filed Returns`.
- Documents: filed `GSTR-3B`, filed `GSTR-1`, and private `GSTR-2B`.
- Formats: filed GSTR-3B PDF, filed GSTR-1 summary PDF, and optional filed
  GSTR-1 e-invoice details Excel where the GST Portal provides the file.
  GSTR-2B support covers summary PDF and details Excel from the GST Portal's
  GSTR-2B summary page.
- Mode: user-authenticated local browser session.

## Non-negotiables

- Pack does not collect credentials, OTPs, CAPTCHA responses, cookies, tokens or
  session material.
- Pack does not upload GST files, filenames, GSTINs, ARNs or tax metadata to
  ComplyEaze.
- Pack does not add analytics, crash reporting, remote selector configs or
  remote executable code.
- Pack does not claim GSTN, CBIC or Government of India affiliation.

## Current implementation

- Filed-return page detection: `gst-filed-returns`.
- Post-login GST shell detection: `services/auth/fowelcome` is treated as
  `gst-auth-landing`, not as an unsupported page.
- Private spike plan: filed `GSTR-3B` PDF, filed `GSTR-1` PDF/Excel and
  `GSTR-2B` PDF/Excel source-build support. Store-facing claims remain gated by
  the release checklist.
- Safe observation harness: content script classifies readiness from the active
  page and sends only allow-listed labels to the background worker.
- Initial filed-returns form handling: Pack reports `filters-required` when the
  FY/period/return-type search form is visible, so the dropdown's `GSTR-3B`
  option is not mistaken for a filed return result.
- Filed-return results handling: Pack reports `filed-return-results-visible`
  when the portal shows the GSTR-3B results table with `View` actions, making
  the next step explicit before final PDF/download detection.
- Filed GSTR-3B detail handling: Pack treats `/returns/auth/gstr3b` as part of
  the filed-returns scope. If the system-generated summary modal is open, Pack
  reports `detail-summary-modal-open`; once it is closed and the final controls
  are visible, Pack reports `ready`.
- Authenticated filed-return route handling: Pack treats both
  `/pages/returns/efiledreturns.html` and `/returns/auth/efiledReturns` as
  filed-return scope routes. Sparse filter forms are classified as
  `filters-required` even when collapsed GST dropdowns do not expose `GSTR-3B`
  in the visible page text yet.
- Guided filed-return flow: the popup now exposes one primary `Start download`
  action for `GSTR-3B`, financial year and period. The background worker finds
  an existing GST tab or opens the GST login page, then runs bounded portal
  steps until login/user action is required or the final download control is
  triggered.
- Known summary-modal handling: the guided flow attempts to dismiss only the
  recognised `System generated summary for GSTR-3B` informational modal through
  an explicit close control, then refresh the safe observation. Pack does not
  click file, submit, proceed or continue actions.
- Filed PDF trigger: when the safe observation is `ready`, the guided flow
  targets only the explicit portal-rendered `DOWNLOAD FILED GSTR-3B` control
  and rejects system-generated PDF links, save/submit/proceed/continue controls
  and generic navigation actions.
- Browser download evidence: Pack now arms a local `chrome.downloads` observer
  before the final filed-GSTR-3B click. A run is considered completed only when
  the browser reports a completed non-empty download; a mere portal-button click
  is reported as unconfirmed and asks the user to allow downloads/retry.
- GSTR-2B handling: Pack routes `GSTR-2B` to the GST Portal's separate
  `gstr2b.gst.gov.in` summary page and targets only the explicit
  `DOWNLOAD GSTR-2B SUMMARY (PDF)` and `DOWNLOAD GSTR-2B DETAILS (EXCEL)`
  controls. Unlike the reviewed GSTR-3B direct PDF endpoint, the public GSTR-2B
  bundle generates PDF/Excel as page-side blob downloads from authenticated API
  data. Pack therefore does not synthesize a direct URL for GSTR-2B. If the
  browser does not report a completed download after the blob download click,
  Pack records the artifact as unconfirmed and warns that Brave/Chrome's
  ask-where-to-save dialog may still be open.
- Extension-reload recovery: if Brave/Chrome reloads the extension while a GST
  tab is already open, the popup can inject Pack's packaged content script back
  into that active GST tab and refresh the safe observation without reloading the
  portal page. This is limited to the exact GST origins and does not run remote
  code or arbitrary selectors.
- Private DOM navigation helper: the guided flow attempts to dismiss only known
  safe post-login modal actions, click the portal-rendered `Return Dashboard`
  entry when starting from `fowelcome`, then reveal the GST Portal
  Services/Returns menu and click only the fixed, allow-listed filed-returns
  candidate. It does not accept selectors, read form values, collect credentials
  or capture raw HTML.
- No production request-shape sampling or authenticated filing-snapshot probe:
  V0 relies on visible page state and the browser download event only.
- Popup: shows the primary guided download scope first, with only local reviewer
  demo and local-data controls kept behind a disclosure.
- Keyboard command: disabled for V0. Start live downloads from the popup so the
  selected FY and period remain visible before any portal action.
- Fiscal scope: Pack offers filed-return financial years from the current Indian
  financial year back to `2017-18`. For FY `2017-18`, month-level selection
  starts at July because the relevant CGST return provisions took effect on
  1 July 2017.
- GST tab selection: when more than one GST Portal tab exists, Pack now prefers
  authenticated returns-domain tabs, then authenticated services-domain tabs,
  before stale login or unrelated GST tabs.
- Filter executor: Pack can select the filed-return FY/period/return-type
  filters through native selects or scoped custom dropdown controls. Custom
  dropdown interaction is constrained to the filed-returns filter form rooted
  around the visible `Search` action and the expected field labels.
- Dependent filed-return filters: the executor scopes native select controls to
  the visible field label containers and waits briefly after each selection so
  GST's dependent period/return-type options can populate before clicking
  `Search`.
- Scheduled downtime handling: Pack treats GST's plain scheduled-downtime page
  as a blocked portal-availability state with a retry-later action. It must not
  continue navigation, API search, dropdown selection or final download attempts
  while that page is visible.

## Live navigation finding

A direct browser route jump to the authenticated returns-domain filed-returns
route was rejected by the GST Portal even after an authenticated returns-domain
page had been opened. Treat direct protected route jumps as unsupported for Pack
V0. This was reconfirmed on 2026-07-02 by navigating from the returns dashboard
path to the filed-returns path, which landed on the GST access-denied page
instead of the filed-returns UI.

Live test update: starting from the authenticated services-domain welcome page,
Pack successfully clicked through to the portal-rendered `View Filed Returns`
page. The first page state after navigation is the FY/period/return-type filter
form; Pack now reports that as `filters-required` instead of mistaking the
`GSTR-3B` dropdown option for a filed return result.

Second live test update: after selecting the monthly filed GSTR-3B report scope
for the prior year, the portal shows a paginated filed-return results table with
row-level `View` actions. Pack now reports this as
`filed-return-results-visible` so the executor does not treat the result list as
the final PDF/download state.

Third live test update: opening a result row navigates to
`/returns/auth/gstr3b`. The portal may display an informational system-generated
summary modal before the download controls can be used. Pack now reports this as
`detail-summary-modal-open`; closing the modal should expose the final
`DOWNLOAD FILED GSTR-3B` control and move the state to `ready`.

Fourth live test update: after reloading Pack, the previously authenticated GST
tab was no longer on the filed-return detail page and the remaining GST Portal
tab showed a logged-out state. Pack's same-tab recovery path still injected the
packaged content script into the exact GST-origin tab and returned
`login-required` plus sanitized request shapes only. A fresh authenticated run is
needed to re-confirm the `ready` state on `/returns/auth/gstr3b`.

Fifth live test update: starting Pack from the popup page while both stale and
authenticated GST tabs were open initially selected the stale login tab. Pack now
orders candidate tabs by authenticated route priority so an active
`/returns/auth/*` tab wins over a login page.

Sixth live test update: the filed-returns filter page exposed portal dropdowns
that did not behave as simple native selects in the live browser. Pack now has a
scoped custom-dropdown fallback and regression tests proving it can select the
requested filters without clicking unrelated page controls.

Safety finding: one live run after the filter-page spike landed on the GST
logout page. Treat that run as a stop condition rather than proof of a complete
download. The executor was tightened to scope custom dropdown interaction to the
filed-returns filter form and to refuse broad page-level controls. Do not run
another live attempt until a fresh user login is available.

Save-dialog Phase 0 finding on 2026-07-07: the real Brave profile loaded from
the local unpacked MV3 build showed native macOS
Save panels for the local synthetic reviewer demo even though
`src/background/synthetic-demo.ts` calls `chrome.downloads.download` with
`saveAs: false`. The queued synthetic prompts included filed-return-like
GSTR-1, GSTR-3B and GSTR-2B filenames. Treat this as evidence that
`saveAs:false` does not suppress the profile's ask-where-to-save behavior for
extension-owned data URL downloads. It is not proof for GST direct HTTPS or
offscreen Blob URL downloads, but it raises the bar for live Phase 0: each live
run must record both the path taken and whether the browser profile has
ask-where-to-save enabled before claiming dialog-free behavior.
Follow-up profile check found `download.prompt_for_download: true` in the local
preferences for that Brave test profile.

Continuation evidence on 2026-07-07: the rebuilt source package was copied back
to the local unpacked MV3 build directory, the unpacked Brave
extension details page showed version `0.3.3` with the expected GST host access,
and the stale queued synthetic Save panels were cancelled rather than saved. The
Pack Options page then rendered the source-build controls, including the
foreground File System Access probe. The only GST tab visible in Brave was a
recognized GST logout page, so real portal artifact testing
could not continue in that session without a fresh GST login.

Resumed-login evidence on 2026-07-07: after a fresh user login in the same real
Brave profile, Pack started from the full-tab popup with `GSTR-3B`, PDF,
FY `2026-27`, and period `June`. Pack reached the portal-rendered
`View Filed Returns` filter form, selected the requested scope and stopped with
the portal's no-record outcome; no native Save panel appeared because no filed
row or download control was available. Retrying the adjacent single-period
`May` scope reached the filed GSTR-3B detail page and clicked the portal
`DOWNLOAD FILED GSTR-3B` control, but Brave opened a native macOS Save panel
from `return.gst.gov.in` instead of reporting a completed dialog-free download.
The panel was cancelled and no artifact was saved. Treat this as confirmed
path-taken evidence for the portal-click fallback in the real profile, not as a
successful `saveAs:false`/captured-byte result.

OPFS ZIP retry evidence on 2026-07-07: after rebuilding and reloading the same
real Brave profile, Pack ran filed `GSTR-3B` PDF for FY `2025-26` with
`Full fiscal year` selected. The run processed all 12 filed periods and the
popup reported `FY 2025-26 GSTR-3B complete. 12 of 12 periods reconciled.`
No native Save panel appeared for individual months. After the final period,
Brave opened one native macOS Save panel for the generated full-year ZIP; saving
that ZIP completed in the browser download shelf. This confirms the current
floor for the real prompt-for-download Brave profile is one user-mediated
full-year ZIP save, not one prompt per period, when the OPFS staging path is
used.

Current-year May retry evidence on 2026-07-07: in the same logged-in session,
Pack ran filed `GSTR-3B` PDF for FY `2026-27`, period `May`. After dismissing
the known system-generated summary modal, Brave reported a completed May PDF in
the download shelf and no native Save panel was observed for that single-period
run. Treat this as real-profile May evidence only; do not generalize it to all
periods, return types or browsers without the corresponding path-taken signals.

Prompt-source follow-up on 2026-07-07: the same real Brave profile still had
the browser's prompt-for-download preference enabled. The rebuilt source-build
Options page ran two synthetic local-only probes with `saveAs:false`: a
`data:` URL probe and an offscreen-created `blob:` URL probe. Both opened the
native macOS Save panel. This resolves the May inconsistency against the
offscreen-Blob hypothesis: the silent May result was not proof that
extension-owned offscreen Blob downloads bypass the browser prompt in this
profile. Treat May as a separate path-taken question; current evidence supports
the full-year OPFS ZIP floor of one user-mediated ZIP save in this prompting
profile, while per-period silent behavior still requires recorded path-taken
diagnostics before it can be claimed.

Seventh live test update: the filed-returns filter form could still fail to
select the intended period or return type because the GST page renders labels as
normal form text and populates return-type options after the period selection
settles. Pack now resolves native selects by the visible field label container
and retries the field briefly when a dependent option is not populated yet.

Pack should reach filed returns through one of these paths:

- from the normal post-login landing: `fowelcome` > portal-rendered
  `Return Dashboard` > `View Filed Returns`;
- user-driven portal navigation: `Services > Returns > View Filed Returns`;
- extension-driven DOM navigation that clicks the portal-rendered menu item
  after the user is already authenticated;
- future synthetic API replay only after the required request shape is observed
  from a legitimate portal page/action.

## Private live observation steps

1. Load or reload Pack from `.output/chrome-mv3` in Brave.
2. Open Pack, keep filing as `GSTR-3B`, choose the financial year and period,
   then click `Start download`.
3. If no GST tab is available, Pack opens the GST login page. Sign in yourself;
   do not share credentials, OTPs, CAPTCHA responses, cookies or session data.
4. After login, click `Start download` again. Pack should reuse the highest
   priority authenticated GST tab, reach `View Filed Returns`, select the chosen
   FY/period/GSTR-3B filters when native or recognised custom dropdown controls
   are available, open the matching result row, close the known informational
   modal if present and trigger the final `DOWNLOAD FILED GSTR-3B` control.
5. Review only the safe popup state when debugging. Do not copy raw DevTools
   cURL, cookies, request headers, query strings or response bodies.

The current observer samples for a short window after the filed-returns page is
loaded. If no relevant request shape appears, reload the filed-returns page with
Pack enabled, repeat the portal action, then click `Start download`.

If the extension is reloaded while the GST tab is already on a detail page, do
not reload the portal page if the browser shows a form-resubmission warning.
Return to a normal authenticated GST page, open Pack and click `Start download`;
the popup should refresh through the same-tab content-script recovery path.

## 2026-06-26 live filed-returns finding

Private Brave testing confirmed the filed-returns route can render the filter
form while the Month field remains at `Select` and Return Type population is
slow. Treat this as the main live stuck point before the detail page: Pack should
not wait on the dependent dropdown path when a same-origin filed-return search
API is available from `/returns/auth/efiledReturns`.

The redacted request shape observed for the filed-return search is:

```json
{
  "fy": "YYYY-YY",
  "rfp": "Monthly",
  "qtr": null,
  "mth": "MonthName",
  "rtntp": "GSTR3B"
}
```

The response shape has appeared as either a bare array or a `data`-wrapped
array, and GST field names can vary across related endpoints. Pack therefore
normalises filed-return API rows through a small alias list before matching the
requested financial year, period and return type. The handoff still happens
inside the active portal page with `fetch(..., { credentials: "same-origin" })`
and portal storage/form navigation; Pack must not copy, store, log or transmit
GST cookies, session tokens, raw headers or taxpayer-specific response bodies.

Synthetic direct-download replay remains an engineering experiment only. It may
be tried locally from an authenticated portal page after a legitimate user action
reveals the final request shape, but it is not a v0 production path unless it can
preserve the same privacy boundary and avoid durable credential/session capture.

The redacted final filed GSTR-3B detail-page request family observed after the
portal-rendered download action is:

```text
GET /returns/auth/api/gstr3b/getgenpdf?rtn_prd=MMYYYY
GET /returns/auth/api/gstr3b/taxpayble?rtn_prd=MMYYYY
```

`MMYYYY` is derived from the user-selected return period and financial year.
Pack must not document, log or store the raw protected URL from a taxpayer
session. Any direct-download experiment must construct the path from the local
target, run only on the authenticated returns-domain GSTR-3B detail route,
verify that the visible detail page matches the target financial year and
period, and bind the request to Pack's local action id before attempting
anything networked.

The safe replay boundary is header-level and URL-only: browser-managed
credentials only, no copied cookies or headers, no raw response body reads, no
filenames or local paths in logs, and success only through Pack's existing
correlated `chrome.downloads` completed/non-empty evidence. Live Brave testing
showed that the reviewed protected URL can expose an HTML response instead of
the filed PDF. The current direct path therefore probes the response metadata
inside the authenticated GST page context and only hands the reviewed GST URL to
the browser download manager when the endpoint does not contradict a PDF
download. Pack must not store, log, upload, or document PDF bytes, copied
cookies, headers, raw protected URLs, local filenames, or local paths.

Live experiment result: constructing the final PDF endpoint and handing it to
`chrome.downloads.download` from the extension is not currently a safe default.
In Brave, the extension-owned download request reached the browser download
pipeline but produced an access-denied save prompt rather than the filed PDF.
This suggests the GST endpoint is sensitive to request initiator/context beyond
the session cookies available to the browser profile. Keep the production path
as portal-owned navigation plus the portal-rendered `DOWNLOAD FILED GSTR-3B`
click, with the direct endpoint helpers retained only as private research
scaffolding.

2026-06-30 update: Pack now tries the reviewed direct browser-download path
before the portal-owned click because the portal click path can block single
period and full-fiscal-year runs behind a native Save dialog. This does not
promote direct-download compatibility to a release claim. Keep the Chrome/Brave
live QA gate open until an authorised clean-profile run proves that the
target-bound direct path completes the same filed GSTR-3B PDF without
persisting cookies, headers, PDF bytes, raw URLs, local filenames, or paths. If
that live gate fails, treat it as a runtime blocker and keep the portal-click
fallback constrained to the existing target-bound observer/review path.

2026-07-01 live Brave result: after reloading the unpacked extension into an
already-authenticated Brave profile, Pack completed the selected single-month
GSTR-3B download without a native Save dialog. The same profile then completed
the local full-year flow for the two periods selected by Pack in that run
without the native Save dialog. Sanitized filesystem evidence showed recent
non-empty PDF downloads, and the Pack popup reported the full-year run as
complete with two of two periods reconciled. This is valid evidence for the
save-dialog runtime blocker in the authorised profile. It is not a store-ready
clean-profile gate: run the exact ZIP in clean Chrome and Brave profiles with
"Ask where to save each file" both enabled and disabled before making a broader
release claim. The live artifact location also did not prove Pack-managed
folder placement, so manifest/folder reconciliation remains a release-hardening
follow-up rather than part of the save-dialog fix.

## 2026-07-02 private GSTR-3B observation

Private Brave testing against `SUBJECT-A` recorded two GSTR-3B outcomes for
FY `2025-26` using an existing user Brave profile and an existing unpacked Pack
build:

- Full-year scope completed with `12` of `12` targets reconciled. The run used
  Pack's built-in retry/recovery at the final saved period, then reported
  completion.
- Single-period May scope completed with `1` of `1` target reconciled and no
  manual recovery.

The local redacted JSON summary is stored under the ignored generated evidence
area and is intentionally classified as private local observation evidence, not
release-grade or publishable evidence. The result is useful engineering proof
for the GSTR-3B flow, but it does not close the live evidence gate because it
did not use a clean profile, did not load the isolated current worktree build,
did not cryptographically bind the loaded extension to the source under review,
and did not check service-worker or browser-restart resume behavior. No live
portal screenshots, recordings, downloaded files, filenames, local paths,
GSTIN/PAN, taxpayer names, raw portal HTML, cookies, headers, tokens, OTPs, or
CAPTCHA data were retained.

## Phase 0 save-dialog diagnostics

Future native Save dialog evidence must record the path Pack actually ran, not
just whether a browser download event appeared. Pack records this through a
sanitized `filed-return-download-path` diagnostic attached to the filed-return
flow step. The diagnostic is limited to:

- local action id;
- return type, financial year, period and artifact type;
- reviewed endpoint class;
- path class: extension direct, portal click, or portal click after direct
  fallback, combined with a redacted URL-scheme class such as `https`, `blob`,
  `data` or `unknown`;
- browser download id, MIME class, byte-count class and error category when the
  browser exposes those as safe metadata.

The diagnostic must not include raw URLs, query strings, headers, cookies,
tokens, filenames, local paths, GSTIN/PAN, taxpayer names, portal HTML, response
bodies or PDF/XLS bytes. Phase 0 acceptance requires clean Chrome, clean Brave
and the real profile where the native Save dialog appeared, with "Ask where to
save each file" tested on and off. If GSTR-3B direct downloads pass this matrix,
the next decision is whether a GSTR-3B-only V0 cut is acceptable or whether Pack
must continue into GSTR-1 PDF/Excel endpoint discovery before claiming
full-year dialog-free support.

## Transient artifact-byte boundary

Pack may handle filed-return PDF/XLS bytes only as transient in-memory data for
an explicit user-started, target-bound local download. The service worker owns
the byte path: it injects a one-shot `chrome.scripting.executeScript` function
into the active GST tab's main world, clicks only the previously marked target
control, receives the generated blob as the script result, validates MIME, size
and file magic, creates a bundled offscreen document for a temporary extension
Blob URL, starts `chrome.downloads.download({ saveAs: false })`, waits for the
terminal browser-download state, revokes the Blob URL, closes the offscreen
document, and then drops the bytes.

Raw artifact bytes must not be sent through page-observable `postMessage`,
runtime messages from content scripts, extension storage, IndexedDB, Cache
Storage, logs, diagnostics, evidence files, support bundles, telemetry, or any
ComplyEaze system. Package verification rejects raw `dataUrl` handoff through
page or runtime message APIs except the bounded service-worker to bundled
offscreen-document message used to mint the temporary Blob URL.

## File System Access foreground probe

The File System Access spike lives only in the Options page. It requires a user
click, asks the browser for a directory picker, writes a synthetic Pack probe
file, reads it back for byte-count and hash evidence, and removes the probe file.
It does not store file or directory handles in IndexedDB or extension storage,
does not process GST artifact bytes, and is not an unattended background-save
path. Brave support remains live-evidence-gated.

## 2026-07-02 private GSTR-1 observation

Private Brave testing continued with the rebuilt local unpacked Pack build for
GSTR-1. Brave's extension page showed the expected Pack `0.2.2` title that
mentions GSTR-1 before the live retry.

For FY `2025-26` and May, Pack reached the GST filed-returns filter form and
selected the visible GSTR-1 search filters:

- financial year `2025-26`;
- return filing period `Monthly`;
- month `May`;
- return type `GSTR-1/IFF/GSTR-1A`.

The first GSTR-1 live run stopped before clicking the portal `Search` action and
reported a safe blocked state while waiting for the GST portal filter form to
settle. The implementation was tightened so GSTR-1 explicitly selects
`Monthly`, then the target month, and falls back to the document-level `Search`
button when the live portal keeps that control outside the detected form root.
Focused regression coverage now proves both the fresh-selection and
already-populated GSTR-1 filter forms click `Search`.

After rebuilding and reloading the local unpacked extension in a fresh
authenticated Brave session, Pack progressed beyond the filter form. The live
safe-result inspection found one GSTR-1/IFF result row for May and no
`No records found` state. Pack then opened the row and reached
`/returns/auth/gstr1`, with safe signals for the GSTR-1 detail route, GSTR-1
heading and filed status.

The live PDF path is different from GSTR-3B: the filed GSTR-1 detail page does
not expose the final summary PDF download directly. It exposes a portal
`View Summary` action whose live merged label appeared as
`VIEW SUMMARY PROCEED TO FILE/SUMMARY VIEW SUMMARY`; that action opens a
separate summary page with the PDF download control near the bottom.

Implementation changes from this evidence:

- GSTR-1 PDF and combined PDF+Excel runs click `View Summary` from the filed
  GSTR-1 detail page before attempting the PDF artifact.
- GSTR-1 Excel-only runs stay on the filed GSTR-1 detail page; if a previous
  PDF step leaves the browser on the summary page, Pack uses browser history to
  return to the detail page before triggering Excel.
- Combined PDF+Excel runs sequence PDF first, then return to the detail page
  and trigger the Excel artifact.
- After opening a GSTR-1 result row, the runner waits for the page to settle and
  for the content step to report the correct PDF/Excel page readiness instead
  of immediately trying the final download trigger.

Excel-only initially reached the e-invoice download path and clicked an
Excel-related control, but the browser did not report a completed download. The
run was therefore recorded as `download-unconfirmed`, not downloaded. A safe
control scan also observed an e-invoice download-history area with no files
available for download during this session.

Second-account follow-up: after the user switched to another authorised GST
account in the same Brave profile, running Excel-only for the same FY `2025-26`
May target completed: the browser reported a completed non-empty download for
the e-invoice details Excel artifact. This is valid private engineering evidence
for the Excel-only path in the active Brave profile, but it does not prove
GSTR-1 summary PDF or combined PDF+Excel completion.

After the View Summary implementation change, another live retry on the same
second account found only one GST tab, opened the May GSTR-1 result row, and
reported the safe signals `filed-return-result-view-clicked`,
`result-row-gstr1`, and `filed-return-result-period:May`. A subsequent retry
from the GST authenticated welcome route returned Pack's portal availability
guard instead: `blocked` with `portal-scheduled-downtime`. Treat this as a
portal-side blocker for the current session, not as PDF completion evidence.

2026-07-03 follow-up: after the user logged back into the same Brave profile,
the first rebuilt run reached `/returns/auth/gstr1` but exposed two live gaps:
Pack did not classify the GSTR-1 detail route as a filed-return detail context,
and target identity review could treat the correct GSTR-1 detail page as a
mismatch when the scoped download panel exposed FY/period but not an explicit
return-type label. The implementation now treats `/returns/auth/gstr1` as a
GSTR-1 detail route and uses the authenticated detail route as return-type
evidence while still enforcing FY/period checks.

After rebuilding and reloading the unpacked extension with those fixes, the
GSTR-1 PDF-only run for FY `2025-26` May completed in Brave. The redacted helper
reported `downloaded` with safe signals including `gstr1-detail-route`,
`gstr1-detail-heading`, `status-filed`, and `download-pdf-gstr1-visible`. This
is private engineering evidence for the GSTR-1 summary PDF path in the active
Brave profile. It is not clean-profile release evidence and did not retain
portal screenshots, downloaded files, filenames, local paths, GSTIN/PAN,
taxpayer names, raw portal HTML, cookies, headers, tokens, OTPs or CAPTCHA data.

The same live session then ran combined PDF+Excel. Pack reached the GSTR-1
detail context and clicked a filed-return download control, but the browser did
not report a completed download for the Excel leg, so the combined run ended as
`download-unconfirmed`. A following Excel-only retry was blocked by Pack's local
target-review guard with `filed-returns-target-review-required`. Treat this as
PDF passed, Excel previously passed in this account, and combined PDF+Excel
still not live-proven.

After the user cleared the GST page state and Pack extension state and returned
to the GST dashboard, another combined PDF+Excel retry again navigated from the
dashboard and ended as `download-unconfirmed` on the Excel leg. A follow-up
Excel-only retry hit the expected Excel-specific target-review guard. This
confirms the remaining combined-flow gap is not stale extension state; it is the
Excel browser-download observation path after the portal click. Pack now marks
that condition with `filed-return-artifact-unconfirmed:EXCEL` and an
Excel-specific message that distinguishes browser multiple-download blocking
from the portal having no generated e-invoice file available yet.

The implementation was tightened again from this evidence: Chromium duplicate
`innerText`/`textContent` surfaces are de-duplicated for the live `Search` and
row `View` controls, GSTR-1 detail identity accepts GST's `Tax Period` label,
GSTR-1 detail routes are recognised as detail contexts, route evidence can
confirm the return type when a scoped panel omits the label, and filed GSTR-1
detail pages that show no download files are classified as the correct page
with a missing/unconfirmed download artifact rather than as a wrong-page
condition. Excel unconfirmed states are now artifact-specific instead of a
generic filed-return warning. This is both an Excel-only live pass and a GSTR-1
summary PDF live pass in the active Brave profile, but it is not a combined
PDF+Excel pass. Combined PDF+Excel completion still requires a run where both
the PDF and Excel legs report completed browser downloads in one Pack flow. No live portal
screenshots, recordings, downloaded files, filenames, local paths, GSTIN/PAN,
taxpayer names, raw portal HTML, cookies, headers, tokens, OTPs or CAPTCHA data
were retained.

Final 2026-07-03 live retry: after rebuilding, reloading the unpacked extension
and refreshing the authenticated GST return tab, the Excel-only helper for
FY `2025-26` May returned `blocked` with
`filed-gstr1-excel-no-details-available`. The live portal displayed an
information dialog saying no e-invoice details were available for download for
that filed GSTR-1 period. Pack now preserves that portal evidence instead of
waiting for the browser-download observer and rewriting the result as
`download-unconfirmed`. This is the expected outcome for a filed GSTR-1 period
where the PDF path is available but the optional e-invoice Excel artifact is not
generated for the account/period. The UI can still offer PDF, Excel, or
PDF+Excel, but Excel completion is only provable when the portal actually
provides the e-invoice details file. No portal screenshots, recordings,
downloaded files, filenames, local paths, GSTIN/PAN, taxpayer names, raw portal
HTML, cookies, headers, tokens, OTPs or CAPTCHA data were retained.

Different-account 2026-07-03 live validation: after the user logged into a
different authorised GST account in the same Brave profile, Pack was rebuilt,
the unpacked extension was reloaded, and the GST tab was refreshed before live
testing. FY `2026-27` April GSTR-1 PDF completed with browser download evidence.
FY `2026-27` May GSTR-1 PDF+Excel completed in one combined Pack flow with the
safe `downloaded` selected-artifacts result. FY `2026-27` June GSTR-1 PDF was
used as the negative-control period; Pack did not enter filing/submission
actions and returned a terminal `blocked` summary. The first June run exposed a
message-quality gap because the terminal summary reused the intermediate
`clicked Search` safe message. The runner now rewrites step-limit exits to
`user-action-required` with `flow-step-limit-reached`, preserving the prior safe
signals while explaining that the portal did not show a filed GSTR-1 row or
download control before Pack's retry limit. A rebuilt/reloaded Brave retest
confirmed the improved blocked state. No portal screenshots, recordings,
downloaded files, filenames, local paths, GSTIN/PAN, taxpayer names, raw portal
HTML, cookies, headers, tokens, OTPs or CAPTCHA data were retained.

Final 2026-07-03 full-year live validation: after the user logged into an
authorised GST account in the same Brave profile, Pack was rebuilt, the
unpacked extension was reloaded from `.output/chrome-mv3`, Pack local state was
cleared, and the active GST session was reused. A single-period FY `2025-26`
May GSTR-1 `PDF_AND_EXCEL` run completed with the selected-artifacts success
message. A subsequent FY `2025-26` GSTR-1 `PDF_AND_EXCEL` full fiscal year run
completed in the same unpacked source build. The redacted Pack helper summary
reported scope `{ returnType: "GSTR-1", period: "FULL_FISCAL_YEAR",
financialYear: "2025-26", artifactType: "PDF_AND_EXCEL" }`, status
`complete`, total periods `12`, and completed periods April through March, with
the safe signal `full-fiscal-year-complete`. This is active-profile Brave
source-build evidence that the GSTR-1 full-year PDF+Excel ledger can run
smoothly after user initiation. It is not exact-ZIP clean-profile evidence, and
it does not prove service-worker restart, browser-restart, release-package, or
legal/store-review acceptance. No portal screenshots, recordings, downloaded
files, filenames, local paths, GSTIN/PAN, taxpayer names, raw portal HTML,
cookies, headers, tokens, OTPs or CAPTCHA data were retained.

## 2026-07-05 private GSTR-2B source-build status

Pack now has source-build GSTR-2B PDF and Excel support for the separate
`gstr2b.gst.gov.in` summary page. The implementation keeps the GSTR-2B path
behind explicit portal-rendered controls, captures only the page-generated
Blob download for the active Pack action, validates the generated file type in
the background worker, and saves through the browser downloads API rather than
through a synthetic GST endpoint URL.

Local verification passed for the focused GSTR-2B connector/background tests,
the full Vitest suite, TypeScript, ESLint, Prettier, WXT build, package policy
verification, and exact ZIP verification. Do not treat GSTR-2B as
store-facing or public-release-ready until an authorised user session proves
single-period PDF and Excel behavior, the ask-where-to-save browser setting
behavior, and the relevant full-fiscal-year ledger behavior without retaining
portal screenshots, downloaded files, filenames, local paths, GSTIN/PAN,
taxpayer names, raw portal HTML, cookies, headers, tokens, OTPs, or CAPTCHA
data.

Follow-up live retry: after the user restored an authenticated Brave session,
Pack started a FY `2026-27` May GSTR-2B summary PDF run from the services-domain
welcome/dashboard context. The run attempted the protected GSTR-2B summary app
URL directly and the GST Portal returned an access-denied or expired-session
page. Treat that as live evidence that GSTR-2B must be opened through a
portal-rendered navigation path first. The implementation now routes wrong-page
GSTR-2B starts through the portal Return Dashboard entry and then the
dashboard's explicit GSTR-2B `View` control when present, instead of
synthesizing the protected summary URL from the services page. No live portal
screenshots, recordings, downloaded files, filenames, local paths, GSTIN/PAN,
taxpayer names, raw portal HTML, cookies, headers, tokens, OTPs, or CAPTCHA data
were retained.

Second follow-up live retry: after the rebuilt extension was reloaded and the
user restored an authenticated Brave session again, Pack drove the flow from the
extension popup: GSTR-2B, FY `2026-27`, May, Summary PDF. Pack navigated from
the authenticated GST welcome page to Return Dashboard, selected the requested
dashboard filters, clicked Search, opened the portal-rendered GSTR-2B `View`
control, reached the GSTR-2B summary page for May, and triggered the summary PDF
download. Brave then opened the native save panel because the browser-level
ask-where-to-save setting was enabled. Treat this as live proof for the
extension-driven GSTR-2B navigation and period-selection workflow, not as proof
that Pack can bypass Brave's native save dialog. No live portal screenshots,
recordings, downloaded files, filenames, local paths, GSTIN/PAN, taxpayer names,
raw portal HTML, cookies, headers, tokens, OTPs, or CAPTCHA data were retained.

## Remaining public-release gaps

- Capture follow-up live Brave GSTR-2B evidence for Details Excel and
  full-fiscal-year recovery using an authorised GST session and the rebuilt
  unpacked source build. User login and any OTP/CAPTCHA handling must remain
  manual. Save-dialog automation remains a separate design lane because the
  browser-level ask-where-to-save setting can still open the native save panel.
- Re-run a clean-profile exact ZIP smoke test after every package rebuild. The
  2026-07-03 local ZIP had SHA-256
  `38b7759d2f205febba18f1428db714bf0b4f6527a29b345b1599fa29e3c8dcd8` and
  passed package-policy verification after extraction. The exact-ZIP verifier
  now emits package-policy and checksum evidence before the browser-host step,
  but the browser-host verifier remains blocked before Pack loads by the local
  macOS Chromium Crashpad sandbox permission boundary.
- Run `node scripts/run-dependency-audit.mjs` from CI or an approved
  network-capable shell; the local sandboxed audit hung without output and the
  escalated network rerun was rejected by policy. The wrapper now fails with a
  timeout instead of hanging indefinitely.
- Capture real Chrome/Brave service-worker restart and browser-restart evidence
  for full-year runs. Unit tests cover explicit resume without repeating a
  downloaded period and stale running-ledger restart handling, but release
  claims still need browser-host proof.
- Reconcile live downloaded PDFs into the local Pack manifest and exception
  report before broad public launch.
- Complete counsel review of the live GST Portal terms, product copy and store
  distribution model.
- Keep synthetic endpoint replay out of v0 until the exact portal request shape
  is captured from a legitimate user action and can be replayed without reading
  credentials, cookies or raw tax response bodies.

## 2026-06-20 in-app browser finding

The Codex in-app browser reached the final `/returns/auth/gstr3b` detail page
and exposed the portal-rendered `DOWNLOAD FILED GSTR-3B` button with
`data-ng-click="downloadPrePdf()"`. Coordinate inspection confirmed the click
target was the button, but the embedded browser produced no download event, URL
change or portal modal after the click. Treat this as insufficient evidence for
Pack download behavior: the final completion check must run in a real
Chrome/Brave extension host where `chrome.downloads` is available.

The next live run should start from a new login and use `Start download` or
manual portal navigation only. Do not paste or replay direct protected URLs.

## 2026-06-27 scheduled downtime finding

The GST Portal returned a bare scheduled-downtime page during the live retry
window. Pack now treats that as `portal-scheduled-downtime`: the run stops with a
retry-later action, and no login, selector, API-search or final-download step is
attempted until the user returns after services are available.

## 2026-07-07 May-only Brave retry finding

After rebuilding and reloading the local Brave unpacked extension from the local
unpacked MV3 build directory, Pack was retried only
for GSTR-3B PDF, FY `2026-27`, period May. The real Brave profile had
ask-where-to-save enabled. The extension package verifier and browser-host
verifier passed before this live retry.

The first retest after adding GSTR-3B portal-blob capture still opened the
native Save panel through the portal click path. Treat that as ambiguous because
the already-open GST detail tab could still have been running the previous
content-script protocol version. The implementation now bumps the content-script
protocol version so already-open GST tabs fail the ping and receive the rebuilt
packaged content script before the next filed-return message.

The second May-only retest after the protocol bump did not reach the download
control. The GST Portal redirected to the login page, and Pack surfaced a
blocked state instructing the user to sign in and retry. Treat this as
auth-expired evidence only; it does not prove or disprove dialog suppression for
the new GSTR-3B captured-blob path. No live portal screenshots, recordings,
downloaded files, filenames, local paths, GSTIN/PAN, taxpayer names, raw portal
HTML, cookies, headers, tokens, OTPs, CAPTCHA data, or downloaded PDF bytes were
retained.

Third May-only retry after the user restored an authenticated Brave session:
Pack was run only for GSTR-3B PDF, FY `2026-27`, period May. Pack navigated from
the authenticated GST welcome context to the filed GSTR-3B detail route and the
browser opened the native Save panel for a May GSTR-3B PDF. The Save panel was
cancelled without saving. Pack then reported the run as blocked at May with the
portal-click/no-completed-download message. Treat this as live evidence that
the May GSTR-3B flow still reaches a user-mediated native Save panel in the real
Brave profile with ask-where-to-save enabled; it is not evidence of a completed
dialog-free extension-owned captured-blob download. No live portal screenshots,
recordings, downloaded files, filenames, local paths, GSTIN/PAN, taxpayer names,
raw portal HTML, cookies, headers, tokens, OTPs, CAPTCHA data, or downloaded PDF
bytes were retained.

Login-free download-manager control after adding the one-file Options probe:
the same unpacked Brave profile opened the native Save panel immediately for a
synthetic extension-owned text download started through
`chrome.downloads.download({ saveAs: false })`. The panel was cancelled without
saving. Options retained only the safe diagnostic result: `status: started`,
`download-prompt-probe-started`, `download-prompt-probe-save-as-false`, a
download id, synthetic filename class, tiny synthetic byte-count class, and
`localOnly: true`. Treat this as clean evidence that this Brave profile's
ask-where-to-save preference can override extension-owned `saveAs:false`; a
captured-blob implementation that still hands bytes to `chrome.downloads` will
not be dialog-free in this profile.
