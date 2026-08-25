# Direction B — guided scope

This direction treats a run as four confirmations, not a batch planner: return, financial year,
period, then artifact. One native select is active at a time while the complete one-scope payload
remains visible below it.

## Decisions

- Fixed render width: `320px`; no horizontal scroll region.
- Default controls: 3 on step one, 4 after Back appears. The advanced catalogue adds no child
  controls.
- Common case: 4 clicks when accepting the shown defaults (three Continue actions, then Start).
- Exactly one return, financial year, period and artifact selection is present at every step.
- The single nine-row `RETURN_CATALOGUE` feeds both the supported return select and the advanced
  reference list. Period options derive from periodicity; artifact options come from the selected
  row. There is no return-specific rendering branch.
- GSTR-3B, GSTR-1 and GSTR-2B are supported monthly rows. GSTR-9 and GSTR-9C are unsupported annual
  rows; GSTR-4 and GSTR-4A unsupported quarterly rows; IFF an unsupported monthly row; Ledgers an
  unsupported non-period row.
- Unsupported rows are plain text behind the one advanced door. They are never `option`, button,
  link or disabled pseudo-control.

## Prototype boundary

All values are synthetic. “Start synthetic run” only renders a local status message; it sends no
message, opens no URL, reads no portal state and persists nothing. The visible metrics are measured
in-page, including live horizontal overflow.
