# Private Filed Returns Spike

This is the first live GST scope for Pack V0. It is private engineering work,
not a public launch path.

## Scope

- Portal area: `Services > Returns > View Filed Returns`.
- Document: filed `GSTR-3B`.
- Format: final PDF where available.
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
- Private spike plan: filed `GSTR-3B` PDF only.
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

A direct browser route jump to `https://return.gst.gov.in/returns/auth/efiledreturns`
was rejected by the GST Portal even after an authenticated returns-domain page
had been opened. Treat direct protected route jumps as unsupported for Pack V0.

Live test update: starting from `https://services.gst.gov.in/services/auth/fowelcome`,
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
target, run only on `https://return.gst.gov.in/returns/auth/gstr3b`, verify that
the visible detail page matches the target financial year and period, and bind
the request to Pack's local action id before attempting anything networked.

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

## Remaining public-release gaps

- Re-run a clean-profile exact ZIP smoke test after every package rebuild.
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
