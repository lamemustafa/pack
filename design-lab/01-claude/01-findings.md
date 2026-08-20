# Findings — Claude pass

## Evidence boundary

Second pass, written after the Codex pass was committed. I read it before writing this, so this is
not an independent replication — where I confirm one of its numbers I say by what method, and where
I add something I say that too.

The distinguishing feature of this pass is **rendered evidence**. The Codex pass could not launch a
browser: Chrome DevTools MCP cancelled its script evaluation and Playwright aborted on both system
Chrome and Brave. It correctly refused to treat that as evidence about Pack, so every number in
`00-codex/01-findings.md` is derived from source CSS and asset inspection. Everything below marked
RENDERED came from the built extension mounted in a real browser with a stubbed `chrome` global.

No live authenticated portal session was used. No taxpayer data, portal URL, filename or local path
appears in this lane.

## Rendered measurements

Built `.output/chrome-mv3`, mounted `popup.html` with a stubbed `chrome`/`browser` global so the
React tree renders, measured in-page.

| Property                                      | Measured                              | Method                      |
| --------------------------------------------- | ------------------------------------- | --------------------------- |
| Popup frame                                   | 420 × 560                             | RENDERED                    |
| Content height, idle ready state              | 674 px                                | RENDERED                    |
| Clipped behind scroll before any run starts   | **114 px**                            | RENDERED                    |
| Focusable controls, idle                      | 11 (10 task controls + Privacy link)  | RENDERED                    |
| Font weights rendered (all states)            | 400, 700, 750, 800, 850, 900          | RENDERED                    |
| Font sizes on the ready surface               | 11, 12, 13, 14, 16, 18 px             | RENDERED                    |
| `@font-face` rules loaded                     | **0**                                 | RENDERED (`document.fonts`) |
| `font-weight` declarations in `src/styles/**` | 36, all ≥ 650, zero regular           | source                      |
| Distinct hex literals in `src/styles/**`      | **102** across 157 occurrences        | source                      |
| `--pack-*` tokens defined                     | 19                                    | source                      |
| `var(--pack-*)` usages                        | **31**                                | source                      |
| Distinct `gap`/`padding` values               | 14 (1,2,3,4,5,6,7,8,9,10,12,14,16,32) | source                      |

Chrome clamps action popups to 800 × 600, so 560 px is 93% of the height ceiling and the surface is
already overflowing on its emptiest state.

## Four things this pass adds

### 1. The token system is 16% adopted

`global.css` defines 19 `--pack-*` tokens. They are used 31 times. Raw hex literals appear 157
times across 102 distinct colours. Per file:

| File                       | raw hex | token refs |
| -------------------------- | ------: | ---------: |
| `popup.css`                |      80 |         21 |
| `global.css`               |      30 |          7 |
| `popup-controls.css`       |  **29** |      **1** |
| `popup-target-summary.css` |      18 |          2 |

`popup-controls.css` — which styles every radio group, every option card and every select in the
builder — references the design system exactly once.

This is the mechanical reason complaint 15 ("no distinct identity") cannot be fixed by choosing
better colours. **You cannot restyle a product whose colours are hand-written 157 times.** Any
identity work has to be preceded by collapsing 102 literals into a token set, or it will be a
find-and-replace across four stylesheets that silently misses the fifth state nobody rendered.

Same shape in spacing: 14 distinct gap/padding values with no scale, including 3px, 5px, 7px and
9px used interchangeably with 4px, 6px, 8px and 10px.

### 2. The 16px icon carries 68 colours across 192 pixels

RENDERED — icon rasterised to a canvas, pixels counted directly.

| Asset               |  Opaque px | Distinct colours | Coverage |
| ------------------- | ---------: | ---------------: | -------: |
| `icons/icon-16.png` |  192 / 256 |           **68** |      75% |
| `icons/icon-32.png` | 840 / 1024 |              119 |      82% |

Sixty-eight colours in 192 pixels is roughly one new colour per three pixels. That is not a palette,
it is antialiasing mush — the quantitative form of "too detailed for 16px". A mark that resolves at
toolbar size lands in single-digit colour counts.

### 3. Confirming the Codex dark-toolbar finding, by a different method

Codex reported the dominant navy fails on dark toolbars. I measured it from rendered pixels rather
than from the SVG source:

| Colour           | Share of opaque px | vs light toolbar | vs dark toolbar `rgb(32,33,36)` |
| ---------------- | -----------------: | ---------------: | ------------------------------: |
| `rgb(13,42,102)` |              25.5% |          13.63:1 |                      **1.18:1** |
| `rgb(30,91,255)` |              21.9% |           5.26:1 |                          3.06:1 |

**Confirmed to the decimal on the figure that matters.** Its light-toolbar number was 12.94:1 against
my 13.63:1, which is a difference in the assumed toolbar colour, not a disagreement. Nearly half the
icon's pixels sit below 3:1 on a dark toolbar, and the largest single block is invisible at 1.18:1.
That is a measured explanation for complaint 1, and it is stronger than my own earlier claim that
the mark "collapses into a blue blob" — which was an assertion, not a measurement.

### 4. A WCAG AA failure inside content you cannot see

`.pack-summary-meta`, `#64768a` on `#f8fbfe` — **4.49:1 against a 4.5:1 requirement**
(`src/styles/popup.css:423`).

Reached independently three ways: Impeccable's browser renderer, Codex's static CSS computation, and
my own check. Three methods, same number, so this one is not in doubt.

What makes it worse than a rounding error: it lives in the "Your pack" summary panel, which is the
section my 674px measurement shows is **clipped below the popup's scroll**. `PRODUCT.md` names WCAG
2.1 AA as the target for this surface, so this is a stated-target miss, not a nitpick.

## Where the fifteen complaints actually come from

Same sorting exercise as the Codex pass, reached before reading it. The two passes converged on the
top two causes; the differences are noted in `09-diff.md`.

| Cause                            | Complaints         | Statement                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope, not job**               | 3, 5, 6, 7, 11, 12 | `FiledReturnsDownloadScope` carries one `period`, one `returnType`, one `artifactType`. "Full year" is not a concept — it is the sentinel `FULL_FISCAL_YEAR_PERIOD` stuffed into the month-shaped `period` field, which is why a _second_ kind of year-level job (complaint 5) has nowhere to go. |
| **Wrong surface**                | 3, 8, 13           | A popup dies on click-away and is clamped at 600px. The full-year flow asks the user to keep the portal tab in front — the exact gesture that closes it.                                                                                                                                          |
| **Recovery as state dump**       | 8                  | 10 `<button>` sites from 10 `signals.has` checks inside a collapsed `<details>`. And `PACK_CLEAR_LOCAL_DATA` works but is reachable only from the options page, which the popup never links to — so there is no way to clear stuck state from the popup.                                          |
| **No type system**               | 14, 15             | 36 weight declarations, none regular; 7 rendered sizes; Inter named first with zero `@font-face`.                                                                                                                                                                                                 |
| **No token adoption**            | 15                 | 102 literals, 31 token refs. New in this pass.                                                                                                                                                                                                                                                    |
| **Identity draws the mechanism** | 1, 2, 15           | Six ideas in one mark — three documents, a pouch, a zipper, a check badge — and 68 colours at 16px.                                                                                                                                                                                               |
| **Labels hand-written per type** | 4                  | Three names for one PDF: "Filed return (PDF)", "Summary PDF", "Summary (PDF)".                                                                                                                                                                                                                    |
| Not a UI cause                   | 9, 10              | Real roadmap pressure, ask-first, and not something this pass can truthfully claim.                                                                                                                                                                                                               |

## The Inter claim, stated as falsifiable

I asserted in the first artifact that the popup renders differently on a developer's machine than on
a user's. What is **measured**: zero `@font-face` rules, no bundled font file, `Inter` first in the
stack, and `document.fonts.check('12px "Inter"')` returning true on this machine because Inter is
installed here.

What is **inferred and still unverified**: that on a machine without Inter the stack falls through to
`system-ui` and the 750/850 weights are then synthesised. Verifying it needs a profile with Inter
uninstalled, or a forced-fallback render. The Codex pass did not test it either. It should be
settled before the fix is justified by it — though the fix (ship the font or stop naming it) is
correct regardless, because a stack whose first entry is unshipped is unpredictable by construction.

## Corrections after the UX-B pass

A third pass (Codex Desktop, `tapish-codex/ux-redesign-b`) re-measured this base and falsified five
claims above. All five are corrected in place. Recorded here because the errors are more instructive
than the fixes.

- **The Inter faux-bold claim is disproven.** This pass measured zero `@font-face` rules and then
  _inferred_ that weights 750 and 850 would be synthesised on a machine without Inter. UX-B actually
  tested it: the Chrome/macOS system stack produced distinct pixel fingerprints for every sampled
  weight from 400 through 900. The stack is still unpredictable — naming a font you do not ship is
  still a defect — but the specific mechanism asserted was wrong. It was flagged unverified here and
  should not have appeared as an explanation in published copy.
- **Recovery is not collapsed.** `<details className="recovery-details" open>`. Every action is
  visible at once, which is a different problem from the one this pass described, and arguably a
  worse one. The count was also wrong: 11 `signals.has` occurrences over 9 unique strings, not 10.
  `grep -c` counts lines, not occurrences.
- **"11 controls to express one file" overstated it.** Eleven interactive sites, of which ten are
  task controls; the eleventh is the Privacy link.
- **13.33px is not a surface size.** It came from `<option>` elements inside the native select
  dropdown, which the OS renders. The ready surface renders six sizes, not seven.
- **Complaint 5 is materially wrong at this base.** GSTR-3B full-year PDF and full-year portal-data
  runs _are_ independently selectable, because `artifactType` is a separate axis from the period
  sentinel. No consolidated statement exists yet, so nothing can be entangled with one. The
  underlying observation — that `FULL_FISCAL_YEAR_PERIOD` is a sentinel in a month-shaped field —
  stands; the consequence drawn from it did not.

One UX-B finding this pass does not accept: that the parent June 2026 Impeccable critique of the
Pack logo "could not be reproduced". It exists, at
`.impeccable/critique/2026-06-23T11-52-20Z__ownload-utility-08-brand-and-content-pack-logo-svg.md`
in the **parent ComplyEaze repo**, scoring 29/40 with two P1s. UX-B's sandbox was scoped to its
worktree, so it could not see a sibling repository — a limitation of its evidence access rather than
a false claim. The path is recorded here so the next pass does not re-litigate it.

## Verification gap closed

UX-B also established that `dev/popup-preview.html` has drifted from the mounted React UI: it
contains zero `<input>` elements where the real popup renders real radios, and no `recovery-details`
block at all. That matters, because this pass used those nine states as the oracle for the colour
token collapse — so the recovery surface was never covered by the rendered check.

Closed by a static audit over every rule in the stylesheets rather than every rendered node:
**167 rules, 320 colour pairs, including the 11 recovery and diagnostic rules the preview never
renders — zero AA failures.** That is strictly stronger than the rendered check, because it does not
depend on a state being reachable in a harness.
