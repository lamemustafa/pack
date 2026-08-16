# Portal integration findings

This log records live diagnostic findings that constrain Pack's local, target-bound acquisition.

1. Synthetic clicks work. Neither `isTrusted`, user activation, nor `chrome.debugger` is needed.
2. The portal generates artifacts client-side, then saves through `createObjectURL` and an anchor
   `dispatchEvent`. This was confirmed across seven GSTR-3B, GSTR-1, and GSTR-2B artifacts. The
   bounded non-suppressing shim captures the one expected blob; the former suppressing hook layer
   broke the flow it observed.
3. Request context caused authenticated-path rejections: background requests lack the portal-page
   request context, while a same-origin content-script fetch succeeds.
4. Constructed portal navigation is rejected and can end a session. Click the portal's own anchor.
5. `chrome.downloads.download({ saveAs: false })` does not override a browser profile configured
   to ask where to save files; Pack reports this limitation rather than claiming suppression.
6. `data:` versus `blob:` delivery was not the filename-loss cause. A competing extension changed
   filenames through `onDeterminingFilename`; Pack reasserts only its own download IDs.
7. Artifact identity must come from a live trace before binding a control. The apparent GSTR-1
   Excel control is an e-invoice export, not a GSTR-1 artifact. GSTR-2B has two Excel exports;
   Pack deliberately binds the summary-page details export and does not claim equivalence with the
   offline-page variant.
8. Returns Dashboard tile labels are ambiguous. Bind the GSTR-2B control by containing card, not
   by label text, document order, or index.
9. Preflight verifies the portal period before action: GSTR-3B uses `data.r3b.ret_period`, while
   GSTR-2B uses `data.rtnprd`. These values are compared only in memory and never logged.
10. XLSX container bytes and size do not establish document identity because ZIP entry timestamps
    vary. Compare workbook content before asserting two exports are the same document.
11. GSTR-2B JSON carries a root `chksum` that appears consistent with a digest. Its hashing and
    serialisation are unverified, so Pack does not use it yet.
12. A GSTR-3B JSON response may be saved verbatim; composing a PDF from it is forbidden because a
    Pack-produced document is not the portal artifact.
13. GSTR-2B JSON preflight requires the requested return period as a query parameter. Without it,
    the response omits `data.rtnprd` entirely. Diagnostic probes that log only URL pathnames hide
    required query parameters; that omission caused an earlier integration-spec error.
14. Pack saves the minified raw GSTR-2B JSON API response. A period's raw response was about 129 KB
    while the portal-initiated download was about 408 KB because it was pretty-printed; Pack must
    keep the raw response and must not reformat it to imitate that download.
15. Portal-generated artifacts are not byte-stable across downloads. Three copies of the same PDF
    and two copies of the same XLSX produced different SHA-256 values because of PDF generation and
    XLSX ZIP entry timestamps, so neither a file hash nor byte size is valid document-identity evidence.
16. Return-period parameters and response fields vary by endpoint:

    | Return    | Query parameter | Verified response field   |
    | --------- | --------------- | ------------------------- |
    | GSTR-3B   | `rtn_prd`       | `data.r3b.ret_period`     |
    | GSTR-2B   | `rtnprd`        | `data.rtnprd`             |
    | GSTR-1    | `rtn_prd`       | `data.ret_period`         |
    | E-invoice | `rtn_prd`       | uses the GSTR-1 preflight |

    Omitting the required parameter can yield HTML or a body without a period field, so preflight
    fails closed on missing or mismatched periods. GSTR-1 validates `data.ret_period` alone; it
    does not gate on the unverified root-level status value. Diagnostic probes must record
    parameter names, not only URL pathnames.

17. GSTR-1 exposes three artifacts: a period-scoped Summary PDF, a period-scoped E-invoice details
    (Excel) workbook from a separate subsystem, and asynchronous offline-download JSON. Pack
    supports the first two portal-produced artifacts only; the asynchronous JSON remains unsupported.

18. Captured leaf download controls, enumerated live with the full clickable selector set. Every
    control below is reachable by `a, button, [role='button']`, so selector breadth is not the
    constraint; label shape is.

    | Page                           | Control `textContent`                      | `ng-click` |
    | ------------------------------ | ------------------------------------------ | ---------- |
    | `/returns/auth/gstr1/gstr1sum` | `DOWNLOAD SUMMARY (PDF) DOWNLOAD (PDF)`    | yes        |
    | `/returns/auth/gstr1`          | `DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)` | yes        |
    | `/gstr2b/auth/gstr2b/summary`  | `DOWNLOAD GSTR-2B SUMMARY (PDF)`           | no         |
    | `/gstr2b/auth/gstr2b/summary`  | `DOWNLOAD GSTR-2B DETAILS (EXCEL)`         | no         |
    | `/returns/auth/gstr3b`         | `Download Filed GSTR-3B`                   | yes        |

    The GSTR-1 summary PDF control is a single `<button>` carrying two responsive labels, only one
    of which is visible at a time, so its `textContent` is their concatenation. Exact-equality
    matching against a control label therefore cannot bind it, while it happens to work on GSTR-2B
    because those buttons carry one label each. Match by containment plus a uniqueness check, never
    by equality. The same enumeration on a second period returned an identical control set, so these
    labels do not drift by period.

19. Six defects in one engagement shared a single shape: a hand-maintained duplicate of a fact that
    already had a canonical source in this repository. The return-period parameter spelling, the
    artifact-request return-type allowlist in `messages.ts`, a signal-uniqueness assumption in the
    background response guard, the detail-identity label strings, the identity-region text scoping,
    and the control-label match were each a second copy that drifted from the first. When a portal
    integration fails, check for a duplicated contract before writing new code, and prefer deriving
    from the canonical predicate over restating it.

20. Observed in authorised manual QA: `/services/auth/quicklinks/returns` is the Returns Quick
    Links hub — a waypoint on a third origin, distinct from the filed-list and detail routes, and
    not the View Filed Returns destination. Recording the route pattern is consistent with finding
    18 and with `detect.ts`, which already holds it; no full URL, query string, or session material
    is recorded anywhere.

    Its labels `Returns Dashboard` and `View Filed Returns` each appear **twice**, once in
    navigation and once in the body, alongside `Track Return Status` and `ITC Forms`. Any rule
    requiring exactly one text match fails here; the scored navigator tolerates duplicates.

    Pack stalled on this page three times because the observer classified it from body text — the
    phrase "View Filed Returns" appears as a link label — rather than from the route, so the flow
    believed it had already arrived and stopped navigating. Page classification derives from the
    route only. Treat these labels as navigation candidates, never as evidence of arrival.

21. Observed in authorised manual QA: a Services Dashboard page exposed two portal-owned anchors
    that resolved to the same Returns Dashboard destination. Exactly one was visibly actionable;
    the other was hidden. Exact-target navigation must filter hidden controls before applying its
    uniqueness guard: click exactly one visible candidate, and fail closed for zero or multiple
    visible candidates. The observation and implementation record only structural counts; no portal
    markup, control text, full URL, query string, or session material is retained.

22. The canonical post-login landing can expose one exact portal-owned Returns Dashboard target
    without a rendered box, while its visible navigation surface exposes no equivalent candidate.
    Preserve that unique target-bound portal click only on the canonical landing route and only
    when the anchor has no semantic disabled state. All other pages, and every duplicate-target
    case, require exactly one rendered and enabled target; a click still requires the subsequent
    origin transition before Pack starts any acquisition work.

23. A filed-return summary can render the current scope identity outside the download action's
    ancestor chain. The final-click guard must therefore bind the already armed, unique portal
    control to the exact route and a unique pair of rendered scope labels—not to broad page text,
    inline portal state, or a layout-specific control ancestor. Missing, duplicate, hidden,
    inert, transparent, collapsed, or zero-area label evidence fails closed before the click.

24. Observed in authorised manual QA: a full-fiscal-year run can stall when the GST Portal tab or
    its browser window is backgrounded, then continue only after the portal is visible again and
    the saved target is explicitly retried. Pack preserves the target-bound recovery state but
    does not infer that a newly focused GST tab belongs to the same taxpayer or replay a portal
    action from a focus event. The full-year action therefore tells the operator to keep GST
    Portal visible in the foreground while Pack moves between periods.
