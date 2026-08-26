# Direction C — Return register

## Concept

A compact ledger/disclosure sheet at exactly 320px. The default view is one continuous run register,
not a recipe card collection and not a stepper. It makes the full runtime scope visible before the
action while keeping catalogue breadth behind one Advanced door.

## Measured interaction model

- **Default controls:** 4 — period scope, return, artifact and `Start this run`.
- **Advanced doors:** 1 — a native disclosure containing the full catalogue.
- **Active selection:** exactly 1 financial year, 1 period, 1 return and 1 artifact.
- **Common case:** 1 click when the preselected target is correct; changing a field costs one click
  plus the native choice.
- **Horizontal overflow:** computed in-page from the rendered 320px surface; expected value is 0px.

The period control deliberately carries financial year and period together, then separates both
values in the active-target ledger. That spends one control while keeping the runtime payload honest.
There is no multi-select, month grid, batch promise or unsupported action.

## Catalogue contract

One nine-row JavaScript catalogue drives both the supported return options and the read-only
Advanced register. The generic renderer does not branch on return IDs. The catalogue contains:

- Supported monthly: GSTR-3B, GSTR-1 and GSTR-2B.
- Unsupported annual: GSTR-9 and GSTR-9C.
- Unsupported quarterly: GSTR-4 and GSTR-4A.
- Unsupported monthly: IFF.
- Unsupported with no period axis: Ledgers.

Unsupported entries are explanatory list rows, not disabled or clickable controls. Adding a future
declaration is a data-row change rather than a new UI branch.

## Safety and provenance

All values are synthetic. Submitting only changes an on-page status message: it performs no network,
portal or download action. Pack's existing semantic colour roles, type sizes, spacing, ledger bands,
small radii and government-affiliation disclaimer are retained. No dependency or external asset is
used.
