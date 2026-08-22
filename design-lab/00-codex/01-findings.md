# Pack UI/UX Findings

## Evidence Boundary

This is an independent first pass. I read the brief, `AGENTS.md`, the popup and options source,
the filed-return contracts, the current brand assets, `PRODUCT.md`,
`docs/PORTAL_INTEGRATION_FINDINGS.md`, `docs/PUBLICATION_READINESS.md`, and the PR template. I
also consulted the private hub entries named in the brief, but no private-hub content is quoted or
relied on here as public evidence.

I did not run a live authenticated GST Portal session. The brief explicitly excludes it, and the
UI critique does not need taxpayer data.

Commands and measurements:

- `pnpm install --frozen-lockfile`: passed; lockfile already up to date.
- `pnpm exec wxt build`: passed; WXT 0.20.27 built `.output/chrome-mv3` in 1.150 s, total package
  size 900.98 kB.
- `dev/popup-preview.html` contains nine preview states: ready, ready-single, blocked,
  downloading, partial, complete, unsupported, session-expired, unexpected-error.
- The action popup is fixed at 420 px wide with a 560 px max height
  (`src/styles/global.css:1-7`, `src/styles/popup.css:1-17`).
- Static preview ready state exposes seven pre-primary interactive controls inside the popup shell
  before the start action. The production source can expose more: return type radios, range radios,
  financial-year select, period select when single-period, artifact radios when multiple artifacts
  are available, plus the start action (`src/entrypoints/popup/components.tsx:55-153`).
- Rendered CSS tokens include 10 px, 11 px, 12 px, 12.5 px, 13 px, 14 px, 16 px, 18 px, and
  rem-based values from 0.6875 rem through 1.125 rem.
- Computed contrast samples from current CSS: fineprint `#526477` on popup background `#eef3f8` is
  5.46:1; portal context `#5e6b80` on `#eef3f8` is 4.83:1; pack-summary meta `#64768a` on
  `#f8fbfe` is 4.49:1, just under the normal-text AA threshold.
- Current 16 px icon is 605 bytes with 92 colors. Its dominant deep navy (`rgb(13,42,102)`) has
  12.94:1 contrast on a light toolbar but only 1.18:1 against a dark Chrome-like toolbar
  (`rgb(32,33,36)`).
- `pnpm dlx impeccable detect --json src/entrypoints/popup src/styles dev/popup-preview.html`
  returned three warnings. See `05-tooling-log.md`.
- Browser automation was attempted through Chrome DevTools MCP and Playwright-core with system
  Chrome/Brave. DevTools script evaluation was cancelled by the tool, and both browsers aborted
  under Playwright before opening a page. I treat this as a tooling gap, not as evidence about Pack.

## Current Product Shape

Pack is currently an action popup around one `FiledReturnsDownloadScope`: one financial year, one
period or `FULL_FISCAL_YEAR`, one return type, and one artifact selection
(`src/connectors/gst/filed-returns-contracts.ts:9-15`). The current return types are exactly
GSTR-3B, GSTR-1, and GSTR-2B (`src/connectors/gst/filed-returns-return-types.ts:1-13`). Artifact
support differs by return type: GSTR-3B supports PDF/JSON, GSTR-1 supports PDF/Excel/all formats,
and GSTR-2B supports PDF/JSON/Excel/all formats
(`src/connectors/gst/filed-returns-artifacts.ts:27-62`).

The safety model is stronger than the surface suggests. A target is not complete until it has
safe, correlated evidence, and the UI receives per-run/per-target `safeMessage` and `safeSignals`
through `FiledReturnsFlowSummary` (`src/connectors/gst/filed-returns-contracts.ts:262-299`).
The source also keeps several explicit recovery paths: reconcile browser download, retry local
cleanup, discard saved state and start selected download, manual observation, and cancel/reset
(`src/entrypoints/popup/recovery-actions.tsx:76-132`).

The problem is therefore not that Pack lacks safety or recovery. The problem is that users have to
understand the safety machinery while trying to express an outcome.

## Root Causes

### 1. The UI Is Configuration-First, Not Result-First

Complaints covered: 3, 5, 6, 7, 11, 12, 13.

The current flow starts with selectors for return, range, FY, period, and artifact. A user who wants
"last three years of ITRs" or "GSTR-3B reconciliation workbook" cannot express that result. Even
within GST, the UI asks for implementation dimensions before it shows the work queue.

This is not just a layout issue. The underlying scope contract is a single target family, not an
arbitrary multi-return/multi-period job. Supporting a richer picker means introducing a target
plan/ledger above the existing per-target guard, not just changing the radios into checkboxes.

The tempting simple answer is "make everything multi-select." That would be wrong if it makes the
batch look complete before each target has its own binding and browser-download evidence. The
contracts and publication readiness matrix show this must remain per target.

### 2. Recovery Is Accurate But Asks Too Many Questions At Once

Complaints covered: 8, partly 12.

The recovery UI is safe, but it presents a stack of controls when a target needs attention:
reconcile/retry, discard and start selected, record manual observation, cancel and reset, and
diagnostics. Those are legitimate actions, but they are not one answerable question.

The popup already distinguishes blocked, partial, unavailable, complete, cancelled, and error
states (`src/entrypoints/popup/presentation-state.ts:5-15`). The redesign should keep those states
but collapse each paused target to one primary question derived from its current `safeSignals`.

### 3. Brand Identity Splits Across Two Marks

Complaints covered: 1, 2, 15.

The current icon/favicons use a detailed folder, stacked documents, zipper, and check badge. The
large logo uses a different document/download mark and text-rendered "Pack by ComplyEaze." The
header logo is neither simple nor editable text: it contains 28 path elements plus the mark. At
16 px, the dominant navy blends into dark toolbar chrome, while the detailed check/zipper competes
for the few pixels left.

The right direction is not to make ComplyEaze bigger. It is to let Pack own the small mark and use
ComplyEaze as a quiet endorsement line or lockup, not as a second brand competing for the same
first-glance space.

### 4. "More Filings" And "More Portals" Are Strategy, Not Popup Polish

Complaints covered: 9, 10.

"Only GST" is accurate today, but it is not a defect against the current stated product purpose.
Pack is currently named and described as a GST return downloader in the manifest
(`src/extension/manifest-policy.ts:17-22`), and the reviewed host set is exactly four GST hosts
(`src/extension/manifest-policy.ts:10-15`).

More portals or more filings require new portal contracts, new host permissions, new live evidence,
and public-copy changes. They should be designed, but every such item is ask-first and cannot be
silently folded into this UX pass.

### 5. Typography Is Dense, Borderline In One Place, And Visually Flat

Complaints covered: 13, 14, 15.

The popup uses a small, dense scale because the surface is constrained. That matches `PRODUCT.md`,
which asks for operational density. The issue is not "small text exists"; it is that too many
labels, descriptions, and statuses sit between 10 px and 13 px, and one sampled meta contrast ratio
is 4.49:1.

The palette is also mostly white, blue-gray, and navy, with success/warning used only by state. That
is safe, but it makes the product identity recede into generic extension UI. The redesign needs a
small, non-decorative identity move: a stronger mark, clearer target queue, and fewer competing
micro-labels.

## Complaint Sorting

| Complaint                                                        | Sorting                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Logo/favicon weak                                             | Real. The small mark is too detailed and the dark toolbar contrast is poor for the dominant color.                                                            |
| 2. ComplyEaze lost                                               | Real, but the fix is endorsement hierarchy, not equal brand weight.                                                                                           |
| 3. Too many clicks/configurations                                | Real. Current flow is selector-first.                                                                                                                         |
| 4. No consistency across filing types                            | Mostly real. It comes from different artifact contracts per return type, but the UI exposes that as uneven controls instead of explaining it through targets. |
| 5. Cannot run reconciliation independently                       | Real as a product gap. It is an advanced result, not a current downloader setting.                                                                            |
| 6. Cannot trigger multiple filing types                          | Real. The scope model is single-return.                                                                                                                       |
| 7. Multiple formats/months not easy                              | Real. Full-year is available, but arbitrary period sets and cross-return formats are not.                                                                     |
| 8. Errors/retries complex                                        | Real. Recovery exists, but the action set is not shaped as one decision.                                                                                      |
| 9. Only GST supported                                            | Correct fact, not a current-product defect. Expansion is ask-first because host permissions and portal contracts change.                                      |
| 10. Only three GST filings supported                             | Correct fact and a roadmap pressure, but not something UI polish can truthfully claim.                                                                        |
| 11. Not result-driven                                            | Real and the main IA problem.                                                                                                                                 |
| 12. Too simple for power users, not simple for lightweight users | Real. The same selector stack serves both audiences.                                                                                                          |
| 13. Size/layout/clicks                                           | Real. 420 x 560 is tight for the current control count.                                                                                                       |
| 14. Text rendering bad                                           | Partly real. Contrast is mostly passable, but small type and dense labels make the rendered hierarchy fragile.                                                |
| 15. Not appealing/unique                                         | Real. Current visual language is competent but generic.                                                                                                       |

## What This Means

The first redesign move should be a target-plan surface: the user chooses a result, Pack expands it
into explicit targets, and every target keeps its own binding, evidence, and recovery state. This
addresses the largest group of complaints without weakening the safety model that makes Pack worth
trusting.
