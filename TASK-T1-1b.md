Task ID: T1-1b — correct the 2B fixture against the REAL portal shape
Outcome: make the generated fixture structurally faithful to a genuine GSTR-2B file.
Base: your current branch. Same worktree. Model gpt-5.6-terra, effort high.
Allowed files: the same files you created in T1-1 only.

Your T1-1 totals are CORRECT and must not change:
  b2b  16 rows  txval 1119345.67  cgst 43741.11  sgst 43741.11  igst 111600
  b2ba  1 row   txval 45000       cgst 4050      sgst 4050
  cdnr  2 rows  txval -30000      cgst -1800     sgst -1800     igst -1800
The GSTIN check characters you computed are accepted. Do not revisit either.

Three shape defects were found by comparing your fixture against a REAL portal 2B file. The
real file's structure (field names and array shapes only; no taxpayer values were retained) is:

  data.docdata.b2b[]  = { ctin, trdnm, supfildt, supprd, inv: [ ... ] }
  data.docdata.cdnr[] = { ctin, trdnm, supfildt, supprd, nt:  [ ... ] }
  inv[] keys: inum, dt, val, txval, igst, cgst, sgst, cess, pos, rev, typ,
              itcavl, rsn, srctyp, irn, irngendate, imsStatus
  nt[]  keys: the same, but ntnum instead of inum, plus suptyp
  data keys: gstin, rtnprd, gendt, version (observed "1.0"), docdata, cpsumm, itcsumm
  root: chksum, data

Fix exactly these:

1. **One group per counterparty, not per invoice.** Your fixture emits 16 b2b groups for 5
   distinct `ctin`. A real file carries ONE group per counterparty with all that supplier's
   invoices nested in its `inv[]`. As written, the fixture never exercises multi-invoice
   flattening — the most common real case. Group by `ctin`; the 16 invoices must end up under
   5 groups. Same for `cdnr`.

2. **Populate the full invoice field set.** Your `inv[]` carries only
   `cess, cgst, dt, igst, inum, sgst, txval`. Add the missing real fields listed above, with
   values consistent with the case register: `val` = taxable + all tax; `pos` = the recipient
   state code implied by the supply (intra-state for 27→27 suppliers, inter-state otherwise);
   `typ`, `rev`, `itcavl`, `rsn`, `srctyp`, `suptyp`, `imsStatus` set to plausible portal
   values. `imsStatus` matters — it is load-bearing under IMS and must not be omitted.
   Add `supfildt` to each group alongside `supprd`.

3. **Add the envelope fields**: `data.gendt`, `data.version`, root `chksum`, and a
   `data.cpsumm` per-counterparty summary whose per-supplier `ttldocs`/`txval`/`igst`/`cgst`/
   `sgst`/`cess` reconcile to the `docdata` rows for that same supplier. `cpsumm` is the
   portal's own control total and is what a reader should cross-check flattening against.

Then extend your test to assert: 5 b2b groups covering 16 invoices; every `inv[]` carries the
full key set; and `cpsumm` per-supplier totals equal the `docdata` totals for that supplier.

## Verification — IMPORTANT

Run ONLY your own test file, not the whole suite:
  node_modules/.bin/vitest run tests/connectors/case-register-gstr2b-workbook.test.ts
The full suite takes too long and is not part of this task.

Access boundary: OFFLINE ONLY. No network, no GST portal, no Tally.

Handback: append to `runs/T1-1-report.md` — what changed, the command and exit code, the new
assertions and their results, and anything still unverified. Do not push. Do not mark accepted.

## Resource limit — MANDATORY

The previous run died with "No space left on device"; the host is at 99% disk. Therefore:
- Run ONLY `node_modules/.bin/vitest run tests/connectors/case-register-gstr2b-workbook.test.ts`.
- Do NOT run `wxt build`, the package verifier, the full vitest suite, or any repository-wide
  Prettier/lint gate. Those already passed in T1-1 and are not part of this task.
- Do NOT install packages or create a `.pnpm-store`. Do not write build output.
If a command fails with ENOSPC, stop and report it rather than retrying.
