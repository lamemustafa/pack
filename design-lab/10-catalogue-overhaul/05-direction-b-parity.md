# Direction B product parity

## Scope and method

This cycle compared every explicit behavior in Direction B's notes and independent judgment with
the current product implementation. It traced the canonical model and interaction tests, then used
Chromium at an exact 320 × 900 viewport for both surfaces:

- the standalone prototype through Playwright CLI;
- the packaged extension panel in headed Chromium with only the three initial controller reads
  replaced by fixed synthetic responses.

The packaged harness did not run a portal action, navigate to GST, read portal state or persist a
flow. Its result is layout and interaction evidence only. The first headless extension attempt did
not start a service worker within the bounded 10-second wait and produced no product evidence; the
headed extension path then completed in under five seconds.

## Behavior-by-behavior ledger

| Direction B behavior                                    | Product evidence                                                                                               | Disposition                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Four confirmations: return, FY, period, artifact        | Four catalogue-derived steps render in that order                                                              | Equivalent                                                                   |
| One native select is active at a time                   | One labelled select in every measured step                                                                     | Equivalent                                                                   |
| Complete one-scope payload remains visible              | `Review target` shows return, FY, period and file throughout; its accessible name remains `One active scope`   | Equivalent; product wording is more action-specific                          |
| Three controls initially, four after Back appears       | Packaged DOM measured 3, then 4/4/4 including the catalogue disclosure                                         | Equivalent                                                                   |
| Four clicks to accept defaults                          | Three Continue actions expose the exact final download action                                                  | Equivalent                                                                   |
| One canonical eight-row catalogue                       | The same connector catalogue derives runtime options and all eight disclosure rows                             | Equivalent                                                                   |
| Supported rows alone enter the return select            | Only GSTR-3B, GSTR-1 and GSTR-2B are options                                                                   | Equivalent                                                                   |
| Five unsupported rows are never controls                | Eight rows render; unsupported rows contribute zero button/select/link controls                                | Equivalent                                                                   |
| Period axis derives from periodicity, not return name   | Complete `monthly`, `quarterly`, `annual`, `none` map; no return-name branch                                   | Equivalent, with stronger product coverage                                   |
| Return changes reconcile period and artifact            | Interaction test proves GSTR-1 replaces GSTR-3B's JSON selection with Summary PDF                              | Equivalent                                                                   |
| FY changes reconcile period                             | Canonical scope normalisation owns the change; no duplicate panel rule                                         | Equivalent                                                                   |
| Continue and Back focus the active field                | Packaged DOM reported `SELECT` as active in all four steps; interaction test covers both directions            | Equivalent                                                                   |
| Enter on a focused select advances                      | Direct prototype measurement disproved this assumption: Enter kept it on step 1                                | No divergence and no parity promise                                          |
| Catalogue states periodicity and artifact availability  | Before this cycle the product said only `available`; the new render test failed on the missing concrete labels | Gap closed: supported rows now list their canonical concrete artifact labels |
| Catalogue shows `All formats` as if it were an artifact | Product lists concrete artifacts; the combined choice remains in the file-selection step                       | Intentional correction: a bundle selection is not another portal artifact    |
| Static two-FY list                                      | Product derives currently valid FY options from the canonical scope helper                                     | Intentional production behavior                                              |
| Twelve static monthly periods                           | Product offers the canonical available months plus full-year scope where supported                             | Intentional production behavior                                              |
| `Artifact` terminology                                  | Product uses `File`, while canonical labels distinguish PDF, Excel and portal data                             | Intentional plain-language copy                                              |
| Generic cost line in every step                         | Exact target remains visible; the final step adds scope-specific action copy and exact button label            | Intentional replacement with actionable runtime copy                         |
| Synthetic final feedback                                | Product starts the real guarded flow and renders its loading/error/terminal state                              | Prototype-only boundary, not copied                                          |
| In-page metrics band                                    | Tests and validation own measurements; users do not see test instrumentation                                   | Prototype-only boundary, not copied                                          |
| Visible government non-affiliation copy                 | Packaged footer retains the disclaimer and local-only trust statement                                          | Equivalent, with product trust copy                                          |
| 320px without horizontal overflow                       | Document and client width both 320px; no clipped descendant was found                                          | Equivalent                                                                   |

## Closed implementation residue

The preset implementation had already been deleted, but three comments and an optional controller
override still described it. No production caller supplied the override. This cycle removed that
unused branch and rewrote or deleted the stale comments so the guided panel is not documented as a
feature that no longer exists.

## Packaged measurements after rectification

| State                    | Controls | Shell height | Focus                | Horizontal overflow |
| ------------------------ | -------: | -----------: | -------------------- | ------------------: |
| Step 1 — return          |        3 |     624.76px | select               |                 0px |
| Step 2 — FY              |        4 |     693.55px | select               |                 0px |
| Step 3 — period          |        4 |     676.76px | select               |                 0px |
| Step 4 — file            |        4 |     681.95px | select               |                 0px |
| Catalogue open at step 4 |        4 |   1,092.70px | summary after toggle |                 0px |

The final action read `Download July 2026-27 GSTR-3B PDF`. The prototype's open catalogue measured
1,405.84px in the same viewport; the product adds the missing concrete artifact facts while
remaining 313.14px shorter. This is density evidence, not an authenticated portal qualification.

## Technical audit

The Impeccable deterministic detector returned an empty finding set for the guided component,
panel surface and panel stylesheet.

| Dimension         |     Score | Evidence                                                                                                                                                 |
| ----------------- | --------: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility     |       3/4 | Native labelled select/buttons/details, live step status, visible focus, focus restoration; assistive-technology behavior remains a later explicit cycle |
| Performance       |       4/4 | Small derived arrays, no network, image-heavy content, layout animation or repeated layout loop                                                          |
| Responsive design |       4/4 | Exact 320px packaged measurement, 44px controls, zero overflow/clipping                                                                                  |
| Theming           |       4/4 | Panel styling uses the committed Pack tokens; detector found no hard-coded-color issue                                                                   |
| Anti-patterns     |       4/4 | No gradient text, glass, decorative card grid, side stripe, wide shadow or invented control                                                              |
| **Total**         | **19/20** | **Excellent; missing evidence is recorded rather than scored as a pass**                                                                                 |

Anti-pattern verdict: pass. No P0, P1 or P2 code finding remained in this cycle's scope. The
keyboard/screen-reader backlog remains open because Chromium semantics and source inspection are not
equivalent to assistive-technology qualification.

## Uncertainty carried forward

- Annual, quarterly and non-period axes are structurally tested but not reachable product states
  while their catalogue rows remain unsupported. This cycle does not simulate support.
- Loading, error, permission-denied and retained-recovery surfaces are product behavior absent from
  the prototype. They belong to the next state-matrix cycle rather than being called prototype
  divergences.
- Browser zoom, translated copy and external screen-reader behavior remain unmeasured.
