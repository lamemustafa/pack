# T1-1b — GSTR-2B fixture shape correction

## What changed

- Regenerated both CASE-REGISTER-2B-01 fixtures with one document group per
  counterparty: five B2B groups containing all sixteen B2B invoices.
- Added supplier filing dates, the complete B2B/B2BA invoice field set, the
  CDNR note field set (including `suptyp`), and IMS status values.
- Added the portal envelope fields `chksum`, `data.gendt`, and
  `data.version`, plus section-level per-counterparty `data.cpsumm` controls.
- Added focused assertions for B2B grouping, full document field presence, and
  counterparty-level `cpsumm` reconciliation against `docdata`.

## Commands and results

```text
node tools/casepack/generate-gstr2b-case-register.mjs case_register.json tests/fixtures/casepack
exit code: 0

node_modules/.bin/vitest run tests/connectors/case-register-gstr2b-workbook.test.ts
exit code: 1
```

The required Vitest command did not start because its launcher could not find
`node_modules/vitest/vitest.mjs`. No packages were installed and no new store
was created in this pass; no broader test or build command was run.

## Assertion status

- The generator completed and rewrote both deterministic fixtures.
- The newly added assertions for five B2B groups / sixteen invoices, complete
  `inv[]` fields, and per-supplier `cpsumm` controls were not executed because
  Vitest could not load.

## Still unverified

- Focused runtime verification remains held until this worktree has the
  already-locked dependencies available. The task's disk constraint prevents
  dependency installation here.
