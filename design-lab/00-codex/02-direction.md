# Proposed Direction

## Principle

Pack should ask for an outcome first, then show the exact target plan before it clicks anything.
The UI can make batch work feel like one gesture, but the runtime must still treat every row as its
own target with its own financial year, period, return type, artifact, action identity, visible page
identity, and browser-download evidence.

## Information Architecture

### 1. Result Picker

The first choice is a result, not a configuration:

- Collect filed returns
- Build a GSTR-3B reconciliation workbook
- Prepare annual filing working papers
- Continue a saved run

The first option maps to the current downloader. The other advanced options are transparent
computed outputs: the UI must show which portal artifacts are required, which ones are missing, and
which Pack-computed rows are derived from which portal-provided values. Pack-produced artifacts must
never be described as portal artifacts.

### 2. Scope Builder

After choosing a result, the user picks a compact set:

- Portal: GST for now.
- Returns: checkboxes for GSTR-3B, GSTR-1, GSTR-2B, with unsupported combinations disabled.
- Periods: chips for last month, quarter, full year, last 12 filed periods, and a compact month
  grid.
- Formats: PDF, Excel, portal data, or all supported formats. Unsupported combinations stay visible
  but disabled with the reason.

This selection creates a visible target plan before the run starts. The plan is a table/queue, not a
single optimistic batch label.

### 3. Target Plan

Each row is a target:

| Row Field   | Why It Exists                                                                         |
| ----------- | ------------------------------------------------------------------------------------- |
| Return type | Binds the contract and portal path family.                                            |
| Period      | Prevents wrong-period completion.                                                     |
| Artifact    | Prevents "all formats" from hiding missing PDF/Excel/JSON evidence.                   |
| Status      | Shows pending/running/saved/needs review/not filed.                                   |
| Evidence    | Shows safe evidence class only, never filenames, URLs, taxpayer data, or local paths. |
| Action      | One next action, derived from the row's current state.                                |

Batch progress is an aggregate of rows. It must never replace row truth. "12 of 14 saved, 1 not
filed, 1 needs review" is acceptable. "Batch complete" is only acceptable when every target has a
completion-eligible terminal state.

### 4. Light User And Power User Split

The default popup stays compact:

- Result picker
- Common period preset
- One-line target summary
- Start button

Power controls are progressive:

- "Review targets" opens the target plan.
- "Advanced formats" expands artifact details.
- "Safe diagnostics" stays collapsed until a row is blocked.
- Existing Options remains the deeper maintenance surface for local data and synthetic reviewer
  tools.

This keeps the first run light without hiding the actual binding or recovery model from operators
who need it.

### 5. Paused Or Failed Target

A paused row should ask exactly one question, chosen from the current `safeSignals`.

Examples:

- "Did Browser Downloads show a completed Pack download for this exact target?"
- "Is the GST Portal still signed in on the same account before retrying this period?"
- "Do you want to discard this saved target and start the selected plan fresh?"

The row gets one primary action. Secondary actions remain in "More run controls." Manual
observation must keep its current meaning: it records an observation but does not complete a target.

### 6. Reset Everything

There should be two reset levels:

- Popup row reset: "Cancel and reset this target" or "Discard saved run and start selected plan."
  This belongs beside the paused row because it is a recovery answer.
- Maintenance reset: "Clear local Pack data" remains in Options, but the popup should link to it
  as "Storage and reset." It should use a confirmation dialog and explain that it clears Pack state,
  not GST Portal state.

### 7. Second Portal Slot

[ASK-FIRST] A second portal requires new host permissions, portal-specific connector code, live
evidence, public-copy changes, and probably new persisted user selections. The architecture should
make this possible through a portal adapter registry, but this lane should not implement it.

Shape:

- `src/core` owns portal-neutral target-plan and run-result contracts.
- Each connector owns portal identity, available returns, artifacts, navigation, and final-click
  guards.
- The popup reads capabilities from the selected connector rather than hard-coding GST controls.
- Every connector must define its own safe evidence vocabulary and no-sensitive-data policy.

Cost:

- [ASK-FIRST] new host permissions for every non-GST portal.
- [ASK-FIRST] new or widened persisted fields if portal choice or target presets are stored.
- [ASK-FIRST] public copy updates because the current manifest and readiness docs are GST-specific.
- Live evidence for each portal before making support claims.

### 8. Advanced Capabilities With Auditability

Advanced should mean "Pack computes something traceable," not "Pack hides more automation."

Concrete rules:

- Every computed workbook/report must list the portal artifacts it used.
- Every computed value must be traceable to a source row, table, or field class.
- Missing source artifacts should create gaps, not guessed values.
- Pack-produced outputs must be visually distinct from portal-saved files.
- Public copy must say "computed by Pack from portal-provided files" where that is what happened.

[ASK-FIRST] Any public copy claiming reconciliation, annual filing support, non-GST support, or
stable full-year support needs evidence from `docs/PUBLICATION_READINESS.md` or a new gate before it
ships.

## First Change If Only One Is Allowed

Build the target-plan row model in the UI artifacts first: result picker -> explicit rows -> one
row action. That single move addresses the most complaints while preserving the target-binding
guard that cannot be weakened.
