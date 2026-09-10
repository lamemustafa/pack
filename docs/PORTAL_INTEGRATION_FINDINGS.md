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

25. A maintainer captured every monthly filed GSTR-3B PDF from April 2022 through May 2026 (50
    periods) and read the row captions directly. No amounts or identity were retained. Two
    independently downloaded copies of FY 2024-25 and FY 2025-26 produced identical caption sets,
    confirming deterministic extraction.

    | Effective from | Captured transition                                                                        | Pack effect                                                |
    | -------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
    | July 2022      | Table 3.1.1 appeared; Table 3.1 and 3.2 headings were reworded to reference it.            | Pack does not emit Table 3.1.1 or 3.2.                     |
    | August 2022    | Table 4(B)(1), the 4(D) heading, 4(D)(1), and 4(D)(2) changed.                             | Version 4(B)(1), 4(D)(1), and 4(D)(2).                     |
    | September 2024 | Table 6.1(B) changed from `Reverse charge` to `Reverse charge and supplies made u/s 9(5)`. | Record for planned Table 6.1 work; Pack does not emit 6.1. |

    Every other caption Pack emits was byte-identical across the captured range. Apparent variation
    in Table 3.1(a) was a `pdftotext` line-wrap artifact, not a form change. The captured Table 4
    old text applies from April through July 2022; its current text applies from August 2022 onward.
    Periods before April 2022 emit only the table reference. The current side has no runtime upper
    bound: a future portal form change is a residual re-verification risk, not a reason to relabel
    fixed history without evidence.

26. The GST Portal public common validation bundle, asset `directives2.0.js`, defines GSTIN
    validation as a 15-character GSTIN format plus a base-36 check character calculated from its
    first 14 characters. The implementation source is the official public GST Portal
    common-client asset `directives2.0.js`, captured 2026-08-20 with SHA-256
    `aa5385b105ff3ccb13f641be81f000b334b2626e0f67633c9e8eb2db1927100e`; this records an
    independently verifiable source locator without recording a portal URL or taxpayer data here.
    Pack applies that validation only before placing a GSTR-3B taxpayer identity in a derived
    summary workbook.
    An invalid identity rejects the derived summary as fixed `identity-rejected`; a required
    identity absent from the canonical response path rejects it as fixed `identity-unverified`;
    two sources that disagree about the same taxpayer identity reject it as fixed
    `identity-conflict`; a forbidden credential or session field rejects it as fixed
    `privacy-rejected`. The claim
    that Pack neither retains nor renders the rejected value is true of the **derived** outputs
    only: on rejection no summary CSV and no workbook are written, and the fixed reason carries
    no portal value. The original staged return artifact is deliberately unchanged. ZIP assembly
    copies every staged portal file verbatim, so a value a derived-output guard rejected is
    still present in the user's own requested portal JSON inside the downloaded ZIP, and in OPFS
    until the ledger is cleared. That is the file the user asked Pack to save, and Pack does not
    edit portal bytes; the guard scopes what Pack derives, not what the portal produced.

27. GSTR-2B `data.docdata` invoice records are **flat**. A captured live period carried
    `b2b[].inv[]` objects holding `txval`, `igst`, `cgst`, `sgst` and `cess` directly on the
    invoice, with **no nested `items` array and no `diffprcnt`**; `cdnr[].nt[]` has the same
    shape plus `ntnum` and `suptyp`. A review finding asserted a nested rate-wise `items`
    breakdown; this capture falsifies it for GSTR-2B. Do not port the GSTR-1 `itms`/`itm_det`
    shape onto GSTR-2B without a capture that shows it.

28. Three GSTR-2B invoice fields are **optional**: `irn`, `irngendate` and `srctyp` are present
    on some invoice records and absent from others within a single period. Every fixture written
    before that was observed supplied all three on every invoice, so the absent case was untested.
    Treat them as optional in any schema or fixture.

    **Record structure only.** Entries here may state what fields exist, whether they are
    optional, and how they nest. They must not state any measurement taken from a real return --
    not a count, a prevalence, a magnitude, a size, or a bound. Three consecutive review rounds
    removed one such metric and introduced another in the same edit; the rule is the fix, an
    example is not.

29. `data.docdata` has siblings the workbook does not read: `cpsumm` (counterparty
    summary), `itcsumm` (ITC availability totals), `gendt`, `version`, plus a root `chksum`.
    A derived-output builder must ignore them rather than treat them as unknown sections, and a
    fixture that omits them is not representative of a real response.

30. A captured GSTR-2B response carries `data.gstin` but **no `data.lglnm` and no `data.trdnm`**.
    The owner's legal and trade name are therefore not available to a GSTR-2B derived output, and
    a builder must neither print a labelled blank for them nor refuse the document for their
    absence -- refusing would reject every real GSTR-2B period. It also means those two values
    cannot be added to a value-redaction set for this return type, because Pack never learns them.

31. GSTR-2B JSON writes numbers in **scientific notation**: some values under `data.itcsumm`
    arrive as a fractional mantissa with an exponent suffix rather than as a plain decimal. A guard
    that accepts only plain decimal tokens therefore refuses such a document, for values the
    workbook never renders. Use `jsonNumberTokenToPlainDecimal` to normalise a JSON number token
    before judging it; do not write a second number grammar.

    Neither a magnitude nor an incidence is stated above, deliberately. One draft of this entry
    gave an example value and said a captured period "carried" it; the value was invented, but a
    reader cannot tell that from the sentence, and an entry that reads as a quoted observation is
    the same disclosure whether or not it is one. The next draft removed the value and still said
    the guard had refused the whole captured run -- a prevalence, which the rule under 28 names
    alongside magnitudes. Quoting the retired wording here would republish it, so it is described
    rather than shown.

    Both drafts survived because the figure looked harmless. That is the argument the rule exists
    to refuse: a rule that admits exceptions for figures someone judges harmless cannot be checked
    by anyone but its author.

32. `data.itcsumm` nests availability, then a category, then **either** a tax head or a
    per-section object: a category carries its own rollup heads beside its section children.
    A reader that treats every child of a category as a section refuses the document. Captured
    availabilities were `itcavl` and `itcunavl`; captured categories included `nonrevsup`,
    `revsup`, `othersup` and `imports`. Walk the structure rather than encoding this list --
    the shape is the durable fact, the key names are not.

33. Only `b2b`, `b2ba`, `cdnr` and `impg` appear under `docdata` across a captured corpus spanning
    several financial years -- so the narrow section coverage is this taxpayer's shape rather than
    one year's sampling. The GST
    portal's own user manual lists **fifteen** GSTR-2B tables: B2B, B2BA, B2B CDNR, B2B CDNRA,
    ISD, ISDA, IMPG, IMPG (Amendments), IMPGSEZ, IMPGSEZ (Amendments), ECO, ECOA, ITC REVERSED
    (rule 37A), B2B DNR and B2B DNRA. **None of the eleven we do not render has been captured
    here**, so no builder should encode their shape from that list alone. A taxpayer who has them
    sees them named as unrendered in the workbook footer rather than dropped silently, which is
    the correct behaviour until a capture exists.

    The rule 37A reversal table is the one worth capturing first: it identifies credit that must
    be reversed because the supplier has not paid, which is an obligation rather than an
    entitlement.

34. **FORM GSTR-2B itself prescribes the GSTR-3B mapping.** The form, made under rule 60(7),
    carries a `GSTR-3B table` column against every summary heading, so reproducing that reference
    is quoting the form rather than making a compliance claim. As prescribed:

    | GSTR-2B summary heading                                                                   | GSTR-3B table                                |
    | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
    | ITC Available — All other ITC, supplies from registered persons other than reverse charge | `4(A)(5)`                                    |
    | ITC Available — Inward supplies from ISD                                                  | `4(A)(4)`                                    |
    | ITC Available — Inward supplies liable for reverse charge                                 | `3.1(d)` and `4(A)(3)`                       |
    | ITC Available — Import of goods                                                           | `4(A)(1)`                                    |
    | ITC Available — Credit notes (Part B, net-off)                                            | `4(A)`, netted against `4A(3,4,5)`           |
    | ITC Not Available — all three headings                                                    | `4(D)(2)`, with reverse charge also `3.1(d)` |

35. The `data.itcsumm` keys were matched to those headings **empirically**, by comparing a
    captured period's JSON figures against the portal's own rendered summary for the same period.
    Confirmed by figure equality on integrated and central tax:

    | JSON key           | FORM GSTR-2B heading                            | GSTR-3B table                            |
    | ------------------ | ----------------------------------------------- | ---------------------------------------- |
    | `itcavl/nonrevsup` | I — All other ITC, other than reverse charge    | `4(A)(5)`                                |
    | `itcavl/revsup`    | III — Inward supplies liable for reverse charge | `3.1(d)`, `4(A)(3)`                      |
    | `itcavl/imports`   | IV — Import of goods                            | `4(A)(1)`                                |
    | `itcunavl/*`       | ITC Not Available                               | `4(D)(2)` (reverse charge also `3.1(d)`) |

    `itcavl/othersup` matched **no** Part A heading, and a wider search has since failed to
    explain it. Across a larger captured corpus it holds exactly one child, `cdnr`, in every file,
    which invites the reading that it is the Part B credit-note aggregate. Five ways of testing
    that were tried and **all failed in every file**:

    - `othersup` against the sum of CDNR note rows;
    - `nonrevsup/cdnr` against the same sum;
    - `othersup` plus `nonrevsup/cdnr` against it;
    - those two plus `revsup/cdnr`;
    - `othersup` against CDNR notes excluding IMS-rejected ones.

    So the plausible reading is not merely unproven, it is **unsupported by the data available**.
    Whatever `othersup` aggregates, it is not a straightforward roll-up of the credit-note rows in
    the same document. No GSTR-3B reference is printed against it, and none should be until a
    period is captured whose rendered Part B figure can be matched directly.

    `itcavl/isd` did not occur: this taxpayer has no ISD credit, and the portal rendered that
    heading as nil. Heading II therefore remains unmatched against a JSON key.

    Method note: imports carry IGST only, so the absent CGST head must be read as zero. Treating
    absent as "no match" made the one heading that is structurally IGST-only look unmapped.

## The GSTR-2B summary page does carry a Returns Dashboard link, collapsed

Captured 2026-08-24 from a signed-in `GST Portal` page, by
enumerating anchors with `clickReturnsDashboardAnchor`'s own predicate. Only navigation structure
was captured: route origin plus pathname with query stripped, link text, and actionability. No page
HTML, identity fields or amounts.

The page holds **139 anchors**, of which **exactly one** points at
`GST Portal`, labelled "Returns Dashboard". It reports as not
actionable: it sits inside the collapsed "Returns" quick-links menu, whose parent anchor
(`GST Portal`, label "Returns") _is_ actionable.

This corrects an assumption worth naming, because it was about to become a product constraint. The
run-time signal is `returns-dashboard-anchor-not-found`, and the reasonable reading of that name —
no such link exists on this page — is wrong. The link exists and the matcher finds it. What
rejects it is the visibility test, and then the single-match fallback declining because
`isGstAuthLandingRoute` requires the `GST Portal` origin. A signal named for the shape of
the failure invited a conclusion about the cause.

Observed in the 2026-08-24 source-build capture: after a GSTR-2B full-year run left the selected tab on its summary page, starting a GSTR-3B run returned the listed blocked signals. Earlier releases and other environments have not been assessed.

Two other portal-owned routes back appear on the same page and are **not yet characterised**:

- a visible `BACK TO DASHBOARD` button. It carries no `href`, so its destination — the Returns
  Dashboard or the services dashboard — cannot be read from the DOM and must be observed.
- the visible "Returns" quick-links parent anchor, which may expand the menu or may navigate to
  the quick-links page. Also unobserved.

What remains unknown for the collapsed anchor itself: whether it fails only the CSS visibility
test, or also `isSemanticallyEnabledPortalControl`. The capture conflated the two. Only the first
case is safe to act on, and it decides whether widening the existing single-match fallback is a
fix or a no-op.

## Filing-profile discovery — stage 1 research and probe, 2026-09-06

**Status: not established; do not implement a profile lookup from these notes.** This is a
de-fanged discovery ledger, not a portal contract. It records the questions that remain open and
the probes that would disprove each candidate mechanism. No page contents, identifiers, routes,
or downloads were retained.

### Evidence obtained and limits

- **Documented, limited:** the current planner's source comment records a 2026-09-04 consultation
  of the official Returns FAQs for monthly and quarterly filing/generation dates. That evidence
  supports the calendar threshold only. It does not document a signed-in filing profile, a
  per-return filing history, registration metadata, registration status, unsupported return types,
  or a terminal empty-result signal.
- **Research limitation:** an official-public-source search was attempted on 2026-09-06, but the
  available research service rejected the request. No secondary source was substituted for a
  portal claim.
- **Observed live, availability only:** an existing GST Portal tab was already unauthenticated.
  No navigation, form interaction, download action, or state-changing control was used. The claim
  that an authenticated session was available for this probe is therefore **falsified**.
- **Consequence:** questions 1--6 below are unanswerable from this stage's evidence. Inferred
  mechanisms are deliberately not an implementation basis.

### Candidate mechanisms, all unestablished

| Question                     | Falsifiable candidate claim                                                                                                                                                                        | Evidence class | What would confirm or falsify it in a future read-only authenticated probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Filing frequency          | The portal exposes a cadence value on a reader-visible signed-in surface, and the value can be bound to a specific return type and financial-year scope.                                           | Inferred       | Confirm only if the same rendered surface names the cadence **and the period range it is effective for**, verified across more than one period within the financial year; falsify if cadence is absent, unscoped, effective-range-less, or conflicts across return types, quarters or earlier financial years. A financial-year-level value is not sufficient: the portal's own cadence lookup is **period-scoped**, so cadence may differ between quarters inside one year, and a planner built on an FY-level reading would suppress periods governed by a different value. That invariant was read from Pack's own portal handoff at `11eb351`, before #304 removed it; the wire-level detail behind it is a durable protocol finding and is deliberately not recorded in this public repository. |
| 2. Filed periods             | After choosing a financial year and return type, the portal renders a result set that distinguishes filed, not-filed, not-applicable, and nil outcomes without opening each period.                | Inferred       | Confirm only with surrounding decoy controls plus a completed result set exposing those distinctions; falsify if the result set is filed-only, status-less, or requires one-period-at-a-time inspection. Retain a **synthetic marker shape or classification for each observed outcome** -- how filed, not-filed, not-applicable and nil are distinguished -- with taxpayer values excluded. Roles and nesting alone cannot produce a parser fixture for those statuses, so a later implementation would invent the markers instead of deriving them.                                                                                                                                                                                                                                                |
| 3. Registration date         | A signed-in registration/profile surface renders a registration-effective date that can be read without using identity values.                                                                     | Inferred       | Confirm by observing a labelled date and its rendered context, retaining a **synthetic format-preserving template** -- ordering and separators only, with the taxpayer's actual date and identity discarded; falsify if no such field is rendered or it is not safely scopeable. Without the shape, an implementation cannot know whether the portal emits a numeric or month-name date and would invent its parser and fixture instead of deriving them.                                                                                                                                                                                                                                                                                                                                            |
| 4. Registration status       | A signed-in surface renders a current registration state that distinguishes active, cancelled, suspended, and composition treatment.                                                               | Inferred       | Confirm only if the visible state and its category are unambiguous **and the effective interval for each state is established**; falsify if the surface supplies no state, collapses categories, does not identify composition separately, or gives no transition dates. A current reading does not govern historical periods -- the registration-effective date supplies none of the cancellation, suspension or composition transitions -- so absent intervals, limit the evidence to the current period rather than letting a planner suppress an earlier applicable target on a newer state.                                                                                                                                                                                                     |
| 5. Inapplicable return types | The filed-returns filter or a registration surface exposes the complete return-type set for this registration.                                                                                     | Inferred       | Confirm only by comparing the offered set **across the relevant periods and registration states**, not merely after the financial-year dependency settles -- a single settled subset would otherwise satisfy this criterion while the row lists period dependence as a falsifier. Comparison can reveal variation but never completeness -- the portal can omit an applicable return type in every scope inspected. So an absent return type stays **unresolved** both before and after the comparison. Suppression requires **positive evidence of inapplicability or non-entitlement** for that taxpayer and period; every other absence, however often repeated, remains unresolved. Repeated absence is not evidence of inapplicability.                                                         |
| 6. Empty-result signal       | A completed search has a mutually exclusive terminal state: either a scoped result row is rendered or a scoped empty-state indicator is rendered; while loading, neither terminal condition holds. | Inferred       | Confirm only with **both directional transitions**, each captured before-search, loading and settled, preserving surrounding decoys and proving the selected scope: a scope change from **row to empty**, which tests whether stale rows clear, and one from **empty to row**, which tests whether an old empty indicator clears. One search of each kind is not enough -- it can only occur in one order, and either order leaves half of mutual exclusion untested. Falsify if an old empty indicator survives a later scope that produces a row; falsify if an empty indicator can coexist with loading, stale rows remain, or no stable terminal marker exists.                                                                                                                                  |

The two earlier planner failures are not evidence for any candidate above. The calendar threshold
must remain a calendar guess until a candidate is confirmed live.

**Question 6 is not only future work.** `src/connectors/gst/filed-returns-not-filed-evidence.ts`
already converts a settled no-record surface into `filed-return-positively-not-filed`, which the
full-year flow treats as a terminal positive outcome and moves past. That detector is better
guarded than the label suggests -- it requires a visible no-record container, a settled search
flag, filter fields matching the requested scope, no matching result row, and an explicit
loading check -- but that loading check rests on exactly the portal behaviour question 6
records as unestablished. Until question 6 is confirmed live, the correctness of the shipped
not-filed path is unverified. The conditions under which it could reach a wrong terminal
outcome are a sensitive failure mechanic and are deliberately not written here.

Nothing here is evidence that the detector is wrong. It is evidence that its correctness rests on
an unconfirmed portal claim, which is a different statement from "a clean not-filed outcome is
separate from profile discovery" -- the wording this paragraph previously carried. Probe question 6
before widening, relaxing or newly relying on that path.

### Required next probe

Use a newly authenticated, reader-authorised session and click only the portal's own controls.

**The retention rule, stated once rather than per question.** A capture must retain enough to
derive a fixture for whatever its own confirmation criterion depends on. Concretely, for every
question retain:

- the structural facts -- surface role, visible-control multiplicity, loading-versus-terminal
  transition, and whether the claim was confirmed or falsified; **and**
- a **synthetic or redacted representation of every value the criterion turns on** -- shape,
  ordering, separators, and classification against any vocabulary the shipped code matches --
  with the taxpayer's actual values and identity discarded.

The second clause is the one that keeps being missed. It was added three times for one question
at a time -- the date template for question 3, the decoy record for questions 2 and 6, the decoy
text classification for question 6 -- while questions 1, 4 and 5 kept none of the cadence marker
and its effective-period binding, the state and interval markers, or the return-type and scope
matrix. A confirmation whose evidence was discarded is unauditable, and the next implementation
invents a parser instead of deriving one. State the rule generally so no question is left out by
enumeration.

Worked examples, because two of them are non-obvious:

- **Questions 2 and 6** need the surrounding decoy controls -- roles, nesting, multiplicity --
  because whether the shipped detector accepts an empty marker depends on neighbouring structure,
  not on the marker alone.
- **Question 6** additionally needs a per-decoy **classification**, because that decision also
  depends on decoy text. Classify each decoy against the predicates the shipped detector actually
  applies -- read them from `filed-returns-not-filed-evidence.ts` at probe time rather than from
  this ledger -- and record only the classification, never the raw label.
- **Question 2** needs a synthetic marker shape per outcome -- how filed, not-filed,
  not-applicable and nil are distinguished.
- **Question 3** needs the synthetic date-format template: ordering and separators only.

Do not retain or publish portal HTML, routes, identifiers, names, values, files, screenshots, or
network material. Structure and classification yes; content no.

Probe the empty-result transition before changing retry behaviour; a retry is not honest unless a
completed empty state can be distinguished from a search still in progress.

### Recommendation

**Do not build a filing-profile lookup now.** Its expected reader cost is at least an additional
portal read and dependency-sensitive wait before a run, with more portal navigation and another
state that could be stale, ambiguous, or unavailable. That cost is justified only after a
read-only live probe confirms a stable, scope-bound source for the necessary facts across filing
cadences and registration states. Until then, the evidence supports neither replacing the calendar
threshold nor suppressing a reader-selected period; record a bounded, user-visible not-filed or
unresolved outcome when the acquisition flow establishes one.

## Filed GSTR-1 detail route can be the download surface itself (2026-09-10)

Captured live, authenticated, source-surfaces build v0.6.0, on the GSTR-1 detail route
(`/returns/auth/gstr1`) for a monthly period whose header read `Status - Filed`.

**The page carried four controls and no navigation step:**

```
BACK   DOWNLOAD DETAILS FROM E-INVOICES (EXCEL)   RESET (disabled)   DOWNLOAD FILED (PDF)
```

There was no `VIEW SUMMARY` control anywhere on the page — confirmed against the full page, header
band through footer. The page body was the `File Nil GSTR-1` form with its four-condition note,
which is what the portal renders for this period even though the return is filed.

**What this falsifies.** Pack assumed a filed GSTR-1 PDF is always reached by clicking
`View Summary` to move from the detail route to the summary route, and that the PDF control is
labelled `DOWNLOAD FILED GSTR-1`. Neither held here. `clickFiledGstr1SummaryForPdf` searched for a
control that does not exist on this page and re-emitted `filed-gstr1-summary-view-pending` on every
step until the flow step limit, so the run reported `blocked` / `user-action-required` with no
action a user could take. Observed signals: `gstr-1-detail-route`,
`filed-gstr1-summary-view-pending`, `flow-step-limit-reached`.

**Why both layers missed the control.** The label is `DOWNLOAD FILED (PDF)` — no return type after
`FILED`. `explicitDownloadPattern` for GSTR-1 required `download filed gstr1`, and
`secondaryDownloadPattern` required `download` immediately before `pdf`, so the intervening `filed`
defeated it. The observer carried its own inline copy of that second pattern rather than reading
the descriptor, so the same fact had to be wrong in two places at once.

**Not yet established.** Whether this shape is specific to periods filed as NIL, or is how the
portal now renders every filed monthly GSTR-1. One period was captured. The fix keys off the
presence of the download control rather than off the NIL form, so it does not depend on that
answer, but the answer is still unrecorded.

## The portal declines to produce an artifact, in its own words (2026-09-10)

Two captures, live and authenticated, source-surfaces build. Neither is a failure to reach the
portal; both are the portal stating that the artifact does not exist for that period. One concerns
a filed return, GSTR-1; the other concerns the auto-drafted GSTR-2B statement, which the portal
drafts rather than the taxpayer filing it.

**Filed GSTR-1, e-invoice details workbook.** Clicking the Excel control raises a modal:

```
Information
No details available for download (This is relevant only if you have reported e-invoices).
                            [ OK ]
```

The taxpayer reports no e-invoices, so there is no workbook. The page's own advisory says as much:
the file "would be blank in case taxpayer is not e-invoicing".

**GSTR-2B summary.** The summary route renders an error panel:

```
Error!
GSTR-2B could not be generated by the System. ...
Attention: System will not generate GSTR 2B for the current return period in any one of the
following circumstances:
  i.   There are no records to generate GSTR 2B for the current return period
  ii.  GSTR 3B of last return period is not filed till GSTR 2B generation date of current return period
  iii. You are a QRMP taxpayer and current return period is not a quarter ending month
```

**Why both mattered.** Retrying cannot change either within a run, yet Pack offered retry as the
remedy and stopped the fiscal-year run. The GSTR-1 case had a recogniser and a ledger path for
recording the absence; nothing sent the message between them, so it never ran. The GSTR-2B case had
no recogniser at all.

**Matched on the statement, not the causes.** The GSTR-2B panel's numbered conditions are advisory
text and can be reworded independently of the outcome; the outcome sentence is what Pack keys on.

**Not yet established.** Whether the GSTR-1 modal text varies for a taxpayer who does report
e-invoices but has none in a period, and whether GSTR-2B uses this same panel for a QRMP taxpayer
mid-quarter or a different one. One capture of each.

### The refusal panel outlives the period it was loaded for (2026-09-10)

Captured live during a full-fiscal-year run. The GSTR-2B summary route does not change per period
(`/gstr2b/auth/gstr2b/summary`), and after the portal renders the "could not be generated" panel it
keeps rendering that panel -- and the header block naming the period it belongs to -- until a new
dashboard search settles. A run that read the panel without also reading the header therefore got a
confident answer for every later period without navigating to any of them: one taxpayer's run
reported twelve periods processed after a single navigation, while the page still read
`Return Period - April`.

The header is what makes the correct reading possible. Even with the download controls replaced by
the error panel, the portal still renders `GSTIN`, `Financial Year`, `Return Period` and
`Generation date` (the last one empty, which is itself the signal that nothing was drafted). So the
refusal is bindable to a period, and must be bound to one before it is recorded. An unreadable
header is "could not determine", not "matches" -- Pack navigates instead of answering.
