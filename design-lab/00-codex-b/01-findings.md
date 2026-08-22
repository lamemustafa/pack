# UX-B findings

## Executive finding

Pack is not "undesigned rather than slop." It has deliberate privacy, evidence, density, and
recovery decisions. Its primary UX defect is architectural: a configuration-first, potentially
long-running workflow is compressed into an action popup that closes on outside focus and already
scrolls before a run starts. A stale preview then duplicates that UI inaccurately, while the active
single-target scope makes breadth requests look like control-design problems.

This audit used only synthetic states. It built the extension, rendered all nine preview states,
mounted the built React popup with a synthetic browser-API stub, inspected the 16/32/128 px icons,
and measured computed layout and type in Chrome DevTools.

## Measurements and falsification

| Hypothesis                                                                       | Result                                                    | Direct measurement or trace                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle popup is 420 x 560 with 674 px content and 114 px clipped                   | **Reproduced for the mounted default React state.**       | `main` measured 420 x 560; `scrollHeight` 674; overflow 114. Full-year GSTR-2B measured 743 px, or 183 px overflow. Width and height originate in `src/styles/global.css`; scrolling originates in `src/styles/popup.css`. Chromium source currently caps action popups at 800 x 600, but that is a platform limit, not a Pack measurement. |
| Idle has 11 controls to express one file                                         | **Wording is wrong.**                                     | There are 11 interactive sites total, but one is the Privacy link. Ten belong to the task: five return/range radios, two selects, two format radios, and one start button. The full-year GSTR-2B state has 12 total / 11 task controls.                                                                                                     |
| 36 weight declarations, all at least 650, with the stated distribution           | **Reproduced exactly in source.**                         | `src/styles/**`: 650 x 1, 700 x 7, 750 x 5, 800 x 10, 850 x 11, 900 x 2. This source count does not mean regular text never renders: inherited browser text renders at 400.                                                                                                                                                                 |
| Rendered weights are 400, 700, 750, 800, 850                                     | **Incomplete across states.**                             | Those five render on ready. The real stylesheet also renders 900 in status states, so the nine-state matrix has six weights.                                                                                                                                                                                                                |
| Seven sizes render, including a 13.33 px unstyled select                         | **Refuted.**                                              | The mounted ready state rendered six sizes: 11, 12, 13, 14, 16, and 18 px. The preview status matrix adds 14.4 px. No measured select or other node rendered at 13.33 px.                                                                                                                                                                   |
| No font face or font file ships although Inter is first in the stack             | **Reproduced.**                                           | Build-package inspection found no font file and the runtime stylesheet had no `@font-face`; `document.fonts.size` was zero.                                                                                                                                                                                                                 |
| Missing Inter falls back and 750/850 are faux-bolded                             | **Half true, decisive subclaim refuted on this machine.** | A hidden-span width probe showed the actual stack matched `system-ui`, not Inter. Canvas pixel fingerprints for 400/650/700/750/800/850/900 were all distinct; widths rose from 425.14 to 466.91 px. The browser did not map 750 or 850 to an identical static face. Cross-platform rendering can still differ because no font is packaged. |
| Recovery has 10 buttons driven by 10 signal checks in collapsed details          | **Two parts wrong.**                                      | `src/entrypoints/popup/recovery-actions.tsx` has 10 button sites, 11 `signals.has(...)` call sites (nine unique signal strings), and `<details ... open>`. "Saved run options" is expanded.                                                                                                                                                 |
| Complete local clear exists only in options; popup never links there             | **Reproduced, with a nuance.**                            | `src/entrypoints/options/main.tsx` sends `PACK_CLEAR_LOCAL_DATA`; `src/entrypoints/popup/**` neither sends it nor opens options. The popup does offer narrower reset/cancel recovery actions for some saved-run states. `tests/extension/brand-surfaces.test.ts` deliberately enforces the separation.                                      |
| Active scope is one period, return, and artifact; full year is a period sentinel | **Reproduced.**                                           | `FiledReturnsDownloadScope` in `src/connectors/gst/filed-returns-contracts.ts` is singular on all three axes (plus optional completed periods). `FULL_FISCAL_YEAR_PERIOD` occupies `period` in `src/connectors/gst/filed-returns-scope.ts`.                                                                                                 |
| One PDF has three hand-authored labels                                           | **Reproduced.**                                           | `src/entrypoints/popup/scope-form-model.ts` emits "Filed return (PDF)", "Summary PDF", and "Summary (PDF)".                                                                                                                                                                                                                                 |

## Evidence quality: the preview is not canonical

`dev/popup-preview.html` is useful for visual state coverage, but it has drifted from the mounted
React tree. It hard-codes one return and full-year state, omits the real radio inputs, renders a
collapsed "More options" disclosure, and carries footer copy that differs from the popup. The
current `components.tsx` renders real radio groups and always-visible format choices. Measurements
above therefore use the mounted build for the current ready state and use the preview only for its
status-state stylesheet coverage.

This duplicate is itself a UX-quality defect: a clean screenshot of it can validate a screen users
never receive.

## Fifteen complaints sorted by root cause

### A. The interaction surface is wrong for the job

- **3 and 13 are duplicates.** Both report configuration and layout friction. The measured overflow
  and Chrome's close-on-outside-focus behavior make the action popup the root cause.
- **8 is partly true.** Recovery is present and expanded, but it exposes implementation states and
  multiple decisions. A complete clear is stranded in options with no route from the popup.
- **11 is true.** The UI asks for return, range, year, period, and format before it states the result.
- **12 is true.** Every user sees the same dense form; there is no progressive path from a common
  result recipe to a target plan.

### B. A singleton execution scope is being mistaken for a batch plan

- **4 is true at the language layer.** Three names describe a PDF; capability descriptions and
  action labels branch by return type.
- **5 is materially wrong as stated.** At this base, GSTR-3B full-year PDF and portal-data runs can
  already be selected independently. No consolidated GSTR-3B statement exists here, so it cannot
  be entangled with an "all formats" statement run. The valid unmet need is a separate, explicitly
  derived reconciliation result.
- **6 and 7 are the same missing abstraction.** The active scope is singular, even though the older
  portal-neutral `DownloadScope` and `DownloadPlan` in `src/core/contracts.ts` already model arrays
  and per-target expansion.

### C. Breadth requests are product-strategy symptoms, not control defects

- **9 and 10 overlap.** Both ask for coverage. Adding portal names or return checkboxes to the current
  popup would multiply configuration and live-qualification cost without improving the result
  model.
- **11 also belongs here.** "Give me a result" requires a result recipe and connector capability
  model, not merely more supported labels.

### D. Identity and type are under-specified at runtime

- **1 and 15 overlap.** The 128 px mark is legible, but its document layers, zipper, and check become
  indistinct at 16 px. The toolbar problem is detail density, not just physical size.
- **2 is true.** The parent identity needs an endorsement role, not equal visual billing.
- **14 is partly true, with the proposed diagnosis wrong.** No font is shipped, so rendering is
  platform-dependent and six weights create hierarchy noise. The observed 750/850 output was not
  faux-bold on this Chrome/macOS run.

## Root causes, in priority order

1. **Action popup versus persistent workflow:** measurable clipping, loss of context on outside
   focus, and a long-running task sharing one disposable surface.
2. **No result recipe -> target-plan boundary:** selection and execution both use a singular GST
   scope, despite a portal-neutral multi-target plan contract existing elsewhere.
3. **Recovery mirrors internal state:** safe signals are correctly fail-closed, but the user is asked
   to interpret several recovery actions instead of answering one target-specific question.
4. **Duplicated presentation facts:** preview structure and PDF labels drift because neither is
   derived from the active component/capability owner.
5. **No explicit type/mark runtime system:** the CSS has many strong weights while the named primary
   face is absent; the icon encodes too many details for 16 px.

## What is deliberately preserved

- Every batch selection expands to explicit targets before execution.
- A target completes only after correlated, completed, non-empty browser-download evidence.
- Uncertain, unrelated, interrupted, and empty downloads remain unresolved for review.
- Navigation uses visible portal controls from the current page; the UI must disclose when the
  required next control is unavailable.
- The product remains local-only, without accounts, telemetry, or remote configuration.
