# Code reduction plan

Written 2026-07-30 from a static audit of `549857d` (tag `pack-verified-2026-07-30`), the point at
which all six filed-return paths were live-verified. Every number below is measured, not estimated.

Baseline: `src` 31,199 lines / 161 files. `tests` 35,895 lines / 92 files. 89 of the 161 src files
carry the `filed-returns-*` prefix.

## 1. Dead code — delete, zero risk

Four modules have no production importer. Verified by import-graph scan plus manual grep; the
apparent hits on `filed-returns-download` were prefix collisions with `-download-trigger` and
`-download-diagnostic-state`.

| Lines | Module                                                                | Referenced by     |
| ----- | --------------------------------------------------------------------- | ----------------- |
| 215   | `src/connectors/gst/filed-returns-download.ts`                        | 2 test files only |
| 177   | `src/background/filed-returns-single-artifact-download-completion.ts` | nothing           |
| 90    | `src/connectors/gst/request-shape-observer.ts`                        | 1 test file only  |
| 15    | `src/background/async-timeout.ts`                                     | nothing           |

**497 src lines** plus their test files. `src/extension/manifest-policy.ts` also reports zero src
importers but is consumed by `wxt.config.ts`; it is alive.

### Measured outcome, 2026-07-31 — and what the scan could not see

All four were deleted in `de7551a`. Re-running the scan at head found **two modules that the audit
could not have reported, because that deletion created them**:

| Lines | Module                                                  | Its only src importer at audit time                         |
| ----- | ------------------------------------------------------- | ----------------------------------------------------------- |
| 101   | `src/background/filed-returns-download-result.ts`       | `filed-returns-single-artifact-download-completion.ts` (§1) |
| 68    | `src/connectors/gst/filed-returns-detail-page-guard.ts` | `filed-returns-download.ts` (§1)                            |

Each was reachable only through a module that was itself dead, so deleting §1 orphaned both. Both
now have exactly one importer: their own test file, which still passes. Reachability is a property
of the import graph, not of a file, so a single-pass scan is invalidated by its own remediation.
**Run this scan to a fixed point** — delete, re-scan, repeat until a pass finds nothing.

Before deleting either, note the distinction that makes this safe:
`filed-returns-detail-page-guard.ts` classified pages from body text and was superseded by the
route-based classification now live in `filed-returns-observer-signals.ts`. It is genuinely
redundant. Had no replacement existed, the identical evidence would instead have meant a
target-binding guard that is tested but never called — a live defect, not dead code. Confirm the
replacement exists before treating an orphaned guard as removable.

## 2. Thirteen clickable-selector definitions — the highest-value fix

`src/connectors/gst` contains thirteen separate definitions of "which elements are clickable", each
hand-maintained, several returning different element sets:

- `filed-returns-dom.ts` — 7 selectors, includes `input[type=button]`, `input[type=submit]`
- `filed-returns-navigation-dom.ts` — 8 selectors, adds `[ng-mouseenter]`,
  `[data-ng-mouseenter]`, `[data-dismiss='modal']`, drops both `input` variants
- `filed-returns-download-candidates.ts` — 5
- `artifact-source.ts` — 3 (`a, button, [role='button']`)
- plus `filed-returns-result-rows.ts`, `-search-state.ts`, `-detail-identity.ts`,
  `-portal-availability.ts`, `-dialogs.ts`, `-custom-dropdown.ts`, `-summary-overlay.ts`,
  `gstr2b-dashboard-search.ts`, `main-world-filed-returns-filter-selection.ts`

`filed-returns-dom.ts` and `filed-returns-navigation-dom.ts` additionally export four identically
named functions — `getClickableElements`, `activateElement`, `isVisible`, and (with
`filed-returns-flow-runner-utils.ts`) `delay` — with differing implementations, while
`navigation-dom.ts` imports from `dom.ts`, so the split is deliberate rather than accidental.

Correction to an earlier draft of this section: the GSTR-1 control-resolution defect of 2026-07-30
was **not** caused by selector narrowness. Finding 18 records that every captured control is
reachable by `a, button, [role='button']`, and the live enumeration reported
`reachableByNarrowSelector: true` for all of them. That defect was caused by exact-equality label
matching against a button whose `textContent` concatenates two responsive labels.

The divergence is still worth removing on its own merits — thirteen definitions that disagree about
which elements are clickable is a standing hazard, and two of them export identically named
functions with different behaviour — but it is a latent risk being retired, not the diagnosed cause
of a shipped defect.

This fix reduces defects more than lines. Some sites are legitimately different —
`filed-returns-portal-availability.ts` tests page structure, not clickability — so consolidate to
one canonical clickable set plus a small number of _named, justified_ variants, and make every
call site name which one it wants.

`reserveSinglePeriodBundleLedger` is also exported from two modules
(`filed-returns-single-period-bundle-ledger.ts:140` and `filed-returns-artifact-progress.ts:44`).

## 3. Full-fiscal-year cluster — 3,694 lines, 11 modules, never run

| Lines | Module                                  |
| ----- | --------------------------------------- |
| 914   | `filed-returns-full-fiscal-year-zip.ts` |
| 465   | `filed-returns-full-fiscal-year.ts`     |
| 413   | `-ledger.ts`                            |
| 396   | `-validation.ts`                        |
| 388   | `-recovery.ts`                          |
| 311   | `-cleanup.ts`                           |
| 275   | `-summary.ts`                           |
| 244   | `-run-state.ts`                         |
| 102   | `-plan.ts`                              |
| 94    | `-artifacts.ts`                         |
| 92    | `-zip-phase.ts`                         |

11.8% of all src for a feature that has never executed against the portal. Full-year is next on the
roadmap, so this is **consolidation, not deletion**.

**Measured outcome, 2026-07-31.** The six modules with no importer outside the cluster
(`-validation`, `-cleanup`, `-summary`, `-plan`, `-artifacts`, `-zip-phase`; 1,270 lines) were
consolidated into three. Only **27 lines — 2% — proved redundant**; the remainder was distinct
logic that had merely been split across files. Module count fell 11 → 8 and the cluster fell
3,694 → 3,662 lines.

**Re-measured 2026-07-31 at head.** The cluster is now 8 modules / 3,026 lines. The further 636-line
fall is entirely relocation, not reduction: `-zip.ts` went 914 → 278 when the shared ZIP export was
split out into `filed-returns-staged-zip.ts` (454 lines) and
`filed-returns-single-period-zip.ts` (200 lines). That extracted module is used by the _verified_
single-period path as well as by full-year, which is the useful part — the largest single piece of
the unexecuted cluster is now shared with code that is known to work.

This falsifies the expectation that the cluster was the largest available lever for line
reduction. It is not bloated with duplication; it is simply a large amount of real code for a
feature that has never run. The same caveat should be assumed for §4 below: expect relocation, not
reduction. The remaining question about this cluster is a product one — whether 3,026 lines of
unexecuted machinery should exist before the feature is proven — not a refactoring one.

The risk is concrete rather than theoretical: `-zip.ts` also serves the single-period ZIP export
that _is_ verified, and `-validation.ts` (396 lines) has no direct test importer. Every change here
must be followed by a live re-run of the six verified paths, not a suite run alone.

## 4. Single-consumer modules — consolidation candidates

Modules over 80 lines with exactly one src importer and no direct test importer are internal
helpers that were split into files: `-full-fiscal-year-validation.ts` (396),
`gstr2b-dashboard-selectors.ts` (317), `-full-fiscal-year-cleanup.ts` (311),
`download-observer-results.ts` (273), `gstr2b-flow.ts` (263),
`use-pack-popup-controller.ts` (261), `filed-returns-api-search.ts` (255). Fold each into its
consumer unless it has an independent reason to exist.

## 5. Test structure

`tests/connectors/filed-returns-flow.test.ts` is 8,287 lines — 23% of all test code — in **one
`describe` block with 204 cases**. It exercises the 390-line orchestrator, so it is integration
coverage rather than ballast and must not be deleted; it needs splitting by concern so failures are
navigable.

`filed-returns-full-fiscal-year-zip.ts` (914 lines) has no test file of its own — the largest module
without direct coverage.

## Sequence

1. Delete the dead code (§1). Independent, zero risk.
2. Consolidate the clickable-selector definitions (§2). Highest defect-prevention value; touches
   verified paths, so live re-verification required.
3. Split the integration test file (§5). No production change.
4. Consolidate the full-year cluster (§3) and single-consumer helpers (§4). Largest line reduction,
   highest risk, last.

## Gate for every step

The full suite plus a live authenticated re-run of all six verified paths: GSTR-3B PDF; GSTR-2B
Summary PDF; GSTR-2B all formats; GSTR-1 Summary PDF; GSTR-1 all formats; GSTR-1 wrong-period
recovery. A green suite has repeatedly coexisted with a broken product, so the suite alone does not
qualify a reduction step as safe. Nothing in the protected list in `AGENTS.md` may be removed.
