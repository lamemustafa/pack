Task ID: T1-1 — GSTR-2B fixture generator for CASE-REGISTER-2B-01
Outcome, in one sentence: emit portal-shaped GSTR-2B JSON for the supplied case register and
prove Pack's existing 2B workbook builder consumes it.

Repository and isolated worktree: this worktree only.
Base revision: d59a16e (pack origin/master). Do not merge, rebase or pull.
Model and reasoning effort: gpt-5.6-terra, high.

Allowed files: new files under `tools/casepack/` and `src/connectors/gst/__tests__/` (or the
directory this repo already uses for tests — follow the existing convention, do not invent one).
You may READ anything. Do NOT modify existing source, the manifest, or dependencies.

## Input

`case_register.json` in the worktree root is the ANSWER KEY, authored by the lead. It is the
specification. Every counterparty, GSTIN, document number and amount in it is fictional; no
taxpayer data is involved. Reproduce its values EXACTLY — never round, re-derive, or "correct"
an amount. If a value looks wrong to you, report it; do not change it.

## What to build

1. A generator that reads `case_register.json` and writes portal-shaped GSTR-2B JSON for
   statement period 072025, owner GSTIN `27AABCB1234K1Z5`.

   The shape Pack already expects is `data.gstin`, `data.docdata.{b2b,b2ba,cdnr,impg}` and
   `data.itcsumm` — confirm the exact nesting, field names and per-section row shapes by
   reading `src/connectors/gst/filed-returns-gstr2b-workbook.ts` and its existing tests.
   Derive the shape FROM THAT SOURCE. Do not invent field names, and do not copy a shape from
   memory or a blog.

   Sections required: b2b, b2ba (D-020, carrying `oinum`/`oidt`), cdnr (D-019, D-021),
   impg (control C-022: BOE 7712345, 2025-07-14, port INMUN1, taxable 300000, IGST 54000),
   and an **isd** section (control C-023: 2 rows, taxable 40000, IGST 7200). ISD is NOT in the
   builder's SECTION_ORDER — that is deliberate. C-023 requires that an unhandled section is
   reported with its row count and totals, never silently dropped.

   Cases whose `section` is null (D-006, D-007) are books-only and must NOT appear in the 2B file.

2. A second fixture, identical except `data.gstin` is `27AABCB9999K1Z1` — control C-024,
   the wrong-taxpayer file.

3. Compute VALID GSTIN check characters for every fictional GSTIN in the register
   (state code + PAN + entity code + 'Z' + computed check character), and report which
   registered strings you changed and to what. The register's are format-shaped placeholders
   whose check characters were not computed. Report them; do not edit `case_register.json`.

4. A test that runs Pack's REAL `buildFiledReturnsGstr2bWorkbook` over the main fixture and
   asserts: the b2b/b2ba/cdnr/impg row counts, the per-section taxable/IGST/CGST/SGST totals,
   and how the builder reports the unhandled `isd` section. Assert the totals as literal
   expected numbers you take from the register — not values read back out of the builder.

## Acceptance checks and expected observations

- The generated main fixture parses and the real builder produces a workbook from it.
- Section row counts: b2b 16, b2ba 1, cdnr 2. Section totals must reconcile to:
  b2b   txval 1119345.67  cgst 43741.11  sgst 43741.11  igst 111600
  b2ba  txval 45000       cgst 4050      sgst 4050      igst 0
  cdnr  txval -30000      cgst -1800     sgst -1800     igst -1800
  If your generated file does not reproduce these, the GENERATOR is wrong — report the
  discrepancy, do not adjust the expected totals.
- Report exactly what the builder does with the `isd` section: handled, collected as unknown,
  dropped, or error. Quote the code path with file:line.

## Access boundary

OFFLINE ONLY. Do not contact the GST portal, Tally, or any network service. Do not run
`npm publish`, git push, or any command that leaves this worktree.

## Deliverable and handback

Write `runs/T1-1-report.md` in the worktree containing: files added, the exact commands you
ran with exit codes, the assertion results, the ISD finding with file:line, the corrected
GSTINs, and anything you could not verify. Commit to the current branch. Do NOT push, do NOT
open a PR, do NOT mark this accepted.
