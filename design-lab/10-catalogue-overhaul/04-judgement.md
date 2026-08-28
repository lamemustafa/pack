# Independent prototype judgement

## Decision

**Direction B — guided scope wins.** It is slower than the other directions, but it is the only
prototype whose interactive axis is actually derived from catalogue periodicity. Its return,
financial-year, period and artifact steps keep one exact scope visible, never exceed four visible
controls, and can accommodate monthly, quarterly, annual and non-period rows without a
return-specific branch.

This is an implementation-direction decision, not a recommendation to copy the prototype verbatim.
The product should retain Direction B's catalogue-derived axis and bounded progressive disclosure;
copy density and the four-step cost can be reduced only if that does not merge or hide fields from
the runtime's single-scope contract.

## Method

I did not generate any of the prototypes. I read each HTML and its notes, then opened each page in
a local Chromium session at an exact **320 × 900** viewport. I inspected accessibility snapshots,
clicked the common path, opened the Advanced disclosure, and measured the rendered DOM rather than
relying on each page's metric labels. No network or portal session was used.

Visible-control counts below include the Advanced `summary`, because it is an operable control even
when a prototype's self-reported metric excludes it. Panel height is content height after opening
Advanced; vertical scrolling is acceptable, while horizontal overflow or clipped content is not.

## Measurements

| Criterion                            | Direction A — outcome recipes                           | Direction B — guided scope                                 | Direction C — return register                            |
| ------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Common-case clicks                   | **2**: choose recipe, prepare                           | **4**: continue through return, FY, period, artifact/start | **1**: start preselected scope                           |
| Visible controls, initial            | **4**                                                   | **3**                                                      | **5** (prototype reports 4 because it excludes Advanced) |
| Visible controls during common flow  | **8** after recipe selection                            | **4 maximum**                                              | **5**                                                    |
| Exact viewport / horizontal overflow | 320 × 900 / **0 px**                                    | 320 × 900 / **0 px**                                       | 320 × 900 / **0 px**                                     |
| Initial content height               | 900 px                                                  | 900 px                                                     | 900 px                                                   |
| Advanced-open content height         | 1,723 px                                                | 1,472 px                                                   | 1,755 px                                                 |
| Catalogue rows                       | 9                                                       | 9                                                          | 9                                                        |
| Unsupported rows that are controls   | 0 of 6                                                  | 0 of 6                                                     | 0 of 6                                                   |
| Runtime scope shown                  | One FY, period, return and artifact after recipe choice | One FY, period, return and artifact throughout             | One FY, period, return and artifact throughout           |

All three rendered without measured horizontal overflow at 320 px. The browser accessibility tree
exposed named controls, headings, lists and status messages in each direction; I found no clipped
text or unreachable control in the exercised states. The measurements do not establish screen-reader
quality across assistive technologies, native-select menu geometry outside Chromium, or behaviour
under translated/zoomed text.

## Rubric score

Scores are 1–5, with 5 strongest. Structural scaling and runtime honesty outweigh one or two saved
clicks because the objective is to remove the catalogue/UI duplication rather than optimise a
monthly-only surface.

| Criterion                                         |      A |      B |      C |
| ------------------------------------------------- | -----: | -----: | -----: |
| Common-case efficiency                            |      4 |      2 |      5 |
| Default control budget                            |      2 |      5 |      3 |
| 320 px correctness                                |      5 |      5 |      5 |
| Mixed-periodicity scaling without a return branch |      3 |      5 |      2 |
| Unsupported degradation                           |      5 |      5 |      5 |
| Single-scope runtime honesty                      |      5 |      5 |      5 |
| Accessibility and design consistency              |      4 |      5 |      4 |
| **Total / 35**                                    | **28** | **32** | **29** |

## Why Direction B wins

- `RETURN_CATALOGUE` supplies label, support, periodicity and artifact arrays. Generic steps read
  those values; supported returns alone become options.
- `periodsFor` is keyed by the four periodicity values, so monthly, quarterly, annual and `none`
  axes have explicit shapes without branching on a return identifier.
- Unsupported entries remain explanatory list items behind one disclosure. Opening Advanced adds
  no controls for them.
- The workflow holds its actual visible-control count to three initially and four thereafter,
  including the Advanced door. Its in-page metric agrees with the independent DOM count.
- The active scope is visible during every step and the final status explicitly says the action is
  synthetic and no portal action occurred.
- Native selects, labelled steps, Back/Continue controls, focus movement and a live status region
  form the clearest keyboard and semantic path of the three.

The cost is real: four clicks to accept defaults is twice Direction A and four times Direction C.
That is preferable to encoding a monthly-only shortcut in the model. Implementation should test
whether the existing product surface can use the same catalogue-derived field model without
reproducing all four screens.

## What the runners-up did better

### Direction C

Direction C has the best common-case speed: its preselected target takes one click, and all four
runtime fields are readable together in a compact register. It also presents artifact availability
and unsupported explanations particularly clearly.

It loses because the interactive `scope` options are hand-written FY/month pairs and period labels
come from a monthly `MONTHS` lookup. Changing an annual, quarterly or non-period row to supported
would still offer the monthly scope control; the catalogue renderer scales, but the runnable surface
does not. It also has five actual initial controls when Advanced is counted, not the four it reports.

### Direction A

Direction A translates technical return/artifact combinations into the most understandable user
outcomes and reaches the common case in two clicks. Its periodicity-to-period map covers all four
axis shapes, and unsupported rows are correctly non-interactive.

It loses because choosing a recipe leaves the three recipes and Advanced door visible while adding
Change, FY, period and Prepare controls: the actual count rises from four to eight. Its catalogue row
also models one preferred artifact as singular `artifact`/`artifactScope` fields rather than artifact
availability, so it does not prove the requested multi-artifact catalogue as directly as Direction B.

## Implementation constraints carried forward

1. Use a single catalogue row as the canonical source for label, support status, periodicity and
   artifact availability.
2. Derive runnable options from supported rows; declared-but-unsupported rows must not become
   product controls.
3. Derive axis shape from periodicity, never from a return-name switch or a permanent month grid.
4. Keep exactly one FY, period, return and artifact in the visible active scope.
5. Hold the default surface to at most four visible controls including its one Advanced door.
6. Preserve the 320 px no-overflow result and remeasure the implemented surface rather than
   inheriting any prototype's self-reported number.

## Uncertainty

- These are synthetic standalone pages, not the packaged extension side panel; their measurements
  choose a direction but do not qualify the eventual product implementation.
- I did not test assistive technologies beyond Chromium's accessibility snapshot and keyboard-ready
  semantics visible in the source.
- I did not mutate catalogue rows at runtime. The scaling judgement comes from tracing each
  prototype's render and axis functions: B's generic periodicity map is complete; A needs additional
  artifact/outcome data; C's runnable scope is monthly-specific.
