# Filed returns: everything this year

## Status

**Implemented as a source-build alpha; not a packaged or Store-facing offer.**
The separate root plan, bounded local ledger/index, background runner, recovery,
and exact-download evidence are implemented. Authenticated qualification remains
required for every supported return type and offered artifact before any broader
availability claim. The packaged-surface gate is tracked separately.

## Decision

Keep `FiledReturnsDownloadScope` as the atomic selection: one financial year,
one period, one return type, and one artifact selection. Do not turn it into an
array of return types. Introduce a separate, discriminated full-year plan root
for the user-facing “everything this year” action. The root expands once into a
persisted, ordered list of the existing atomic targets.

This preserves the existing single-return flows and lets the worker, download
binding, artifact staging, and ZIP construction continue to operate on a target
whose identity is unambiguous.

## Plan contract

The proposed root identity is conceptually:

```ts
{
  kind: "all-supported-returns-full-year";
  financialYear: string;
}
```

It is not a `FiledReturnsDownloadScope`, and it has its own message payload,
plan key, ledger discriminator, recovery payload, and UI state. Its canonical
target plan is generated at creation from:

- `supportedFiledReturnsCatalogueEntries()`, filtered by
  `supportsFullFiscalYearFiledReturnsRun`; and
- `filedReturnsOfferedArtifacts(returnType)` for the formats of each return.

The catalogue order, canonical period order, and canonical artifact order are
the stored order. No caller may hardcode a list of return types or formats. In
particular, the legacy all-format selection must keep meaning every artifact
currently offered for that return; it is not a literal PDF-and-Excel rule.

The durable plan records every expanded target before portal work begins. Each
target includes its financial year, period, return type, selected artifact set,
and canonical target ID. This snapshot, rather than a later catalogue read,
governs resume, recovery, counting, staging, and ZIP verification. Duplicate
target IDs, an empty expansion, unsupported formats, or a changed target order
are invalid and block the run with a safe message.

## Ledger and storage

Use an additive, versioned ledger representation and index key for the new
root. Do not reinterpret or mutate a stored single-return ledger into the new
shape. Existing version 1 single-return ledgers remain readable, resumable, and
recoverable under their current scope index.

The new validator must be exact-key, discriminated, bounded, and fail closed.
It validates the root identity, canonical target plan, target-state transitions,
revision, lease/session binding, and ZIP phases. A missing, malformed, or
unknown-version all-returns ledger must produce a safe blocked/recovery state;
it must never be treated as saved or silently replaced.

The index maps the root plan key—not a chosen child scope—to one ledger ID. A
write updates the ledger and index atomically within the existing storage
critical section. No backfill is needed: old ledgers are deliberately not
converted, and a new all-returns run starts from a newly generated plan.

## Worker and completion authority

The all-returns worker obtains one durable root-plan lease, persists its ledger
before each externally visible action, and retains the existing same-tab and
same-session protections. It executes persisted atomic targets in order through
the existing single-target path. It must use portal-owned controls only; it does
not construct portal navigation.

Each portal download remains bound to the exact atomic target: financial year,
period, return type, selected artifact, action identity, and visible page
identity. A click is not completion. The final bundle is saved only after its
own exact browser download ID is observed as completed and non-empty.

Every target must reach an allowed terminal outcome before final export:

- A confirmed artifact is staged and contributes to the final ZIP.
- A confirmed not-filed result is recorded but contributes no artifact.
- An unavailable artifact is recorded as unavailable, not silently omitted.
- Failed, ambiguous, cancelled, blocked, or unconfirmed targets block final
  export and route to the existing explicit recovery/review path.

The plan is `saved` only after all target outcomes are reconciled, the staged
set matches the persisted plan, and the final ZIP download is confirmed. A
partial set remains `partly-saved`; no retry, reset, or replay is implicit.

## ZIP and generated summary

Reuse the target-level staged-artifact logic, but give the all-returns root a
safe generic fiscal-year ZIP filename that contains no taxpayer data. ZIP entry
paths must include return type as well as period and artifact, so entries for
the same month cannot collide across returns. Expected entries are recalculated
from the persisted target plan and compared exactly against staging before the
final browser download starts.

The generated summary already carries return type per row. Its all-returns plan
must retain that field and its deterministic target order. Missing, duplicate,
or unexpected ZIP entries, including either spreadsheet extension ambiguity,
block export with a safe message.

## UI, messages, and recovery

Add a distinct start message for the root plan; do not overload
`PACK_START_FILED_RETURNS_DOWNLOAD_FLOW`, whose payload and guards are an
atomic scope. The panel may expose one explicit “Everything this year” preset
only when the catalogue supplies an eligible non-empty expansion. It presents
the derived return and artifact counts before user action.

The active/saved summary becomes a discriminated union. New all-returns target
evidence carries target identity (including return type, period, and artifact
selection or concrete artifact identity), rather than using a period-only key.
The UI reports target counts and groups outcomes by return type. Existing
single-return summary fields and presets remain compatible.

Recovery and fresh-start actions identify the root plan and exact recovery
target, not whatever scope happens to be selected in the panel. The panel must
not adopt a stored run's scope while the user is choosing another selection.
Loading, empty, error, blocked, and permission-denied states retain their
announcements and keyboard order.

## Required tracing and tests before implementation

Implementation must trace every writer, reader, filter, count, serializer,
worker, fixture, and backfill for the contract. At minimum, tests must prove:

- catalogue-derived expansion, ordering, and all-format derivation for each
  eligible return type;
- exact v2 validation, fail-closed malformed state, and coexistence with an
  unmodified v1 single-return ledger;
- no duplicate target identity or cross-return month collision;
- resume/recovery uses the persisted snapshot even if the catalogue changes;
- target-bound download evidence, partial/not-filed/unavailable outcomes, and
  no final ZIP for an unresolved target;
- exact staged ZIP entry containment/count and final non-empty browser-download
  evidence;
- panel and popup summaries, recovery controls, keyboard traversal, and
  announcement order; and
- mutations of the new expansion, summary identity, and completion guard make
  their corresponding tests fail.

Local tests are necessary but not qualification. A later implementation requires
redacted authenticated evidence for each return type and its offered artifacts,
recorded according to the live-evidence protocol. This design does not change
Task 1: an alive-but-spinning runner remains a separately measured live-stall
investigation.

## Affected owners to trace during implementation

The change starts at `filed-returns-contracts`, catalogue/capability and
artifact helpers, message validation, active-run and flow-runner dispatch,
full-fiscal-year ledger/run-state/summary/recovery/ZIP modules, storage keys and
cleanup, durable/session summaries, panel and popup controllers, offscreen ZIP
fixtures, and all matching tests. This list is a starting map, not permission to
skip importer tracing.
