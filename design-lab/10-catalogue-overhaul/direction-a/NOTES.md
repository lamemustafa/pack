# Direction A — outcome-first recipes

## Premise

The user starts with the file they need, not a return-type configuration. Three supported catalogue
rows become common recipes. Choosing one reveals a single exact FY / period / return / artifact
scope, matching the runtime's one-scope message contract.

## Interaction

- Default view: three outcome buttons and one advanced door — four controls total.
- Common case: choose a recipe, confirm the preselected scope, press **Prepare this file** — two
  clicks. FY and period remain visible and editable before the action.
- Advanced: **Browse all return types** reveals all nine rows. Only supported rows are buttons;
  declared-but-unsupported rows are explanatory, non-interactive items.
- The prototype stops at the portal boundary and explicitly says no file was requested or saved.

## Catalogue proof

One `catalogue` array contains exactly nine rows. Both the three recipe buttons and the advanced
catalogue are derived from it. `renderCatalogueRow()` handles every return; there is no switch or
if-chain keyed to a return name. Period choices are keyed only by the row's declared periodicity.

The measurement band reports default control count, active single scope, common-case clicks,
catalogue row count, rendered width and horizontal overflow from the live DOM.
