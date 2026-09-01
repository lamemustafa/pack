# Guard audit — 2026-09-01

## Scope

- **Merge base:** `d9bfb4f`
- **Audited head:** `c2f9bd3` (`origin/master` when this ledger was created)
- **Method:** for each candidate guard introduced in `d9bfb4f..origin/master`, remove
  only that guard, run the full Vitest suite with the commit SHA recorded before and
  after the run, then restore it. A green mutation is unpinned until a test is added
  and independently shown to fail without that guard.

## Classification ledger

| Guard | Location | Classification | Evidence | Recording commit |
| --- | --- | --- | --- | --- |
| Retry lease-scope bypass | `src/background/filed-returns-flow-runner.ts` (`if (!leaseScope)`) | unpinned | Replaced the condition with `false`; full Vitest passed at `6f15539` before and after (172 files / 3,143 tests). Guard restored. | `58278e8` |
| Retry ZIP-phase suppression | `src/background/filed-returns-all-supported-full-fiscal-year-ledger.ts` (`if (ledger.zipPhase)`) | unpinned | Deleted the return; full Vitest passed at `c52d67d` before and after (172 files / 3,143 tests). Guard restored. | pending |
| Retry target existence | `src/background/filed-returns-all-supported-full-fiscal-year-ledger.ts` (`if (targetIndex < 0)`) | pinned | Deletion left the suite unable to complete after 280 seconds (normal mutation runs: 220–225 seconds); no progress advanced after the full test output's final pre-existing review-gate fixture diagnostics. Guard restored. | pending |
| Retry ordering | `src/background/filed-returns-all-supported-full-fiscal-year-ledger.ts` (previous positive / later pending ordering) | unpinned | Replaced the ordering predicate with `return target`; full Vitest passed at `509df19` before and after (172 files / 3,143 tests). Guard restored. | pending |
| Retry non-resumable signals | `src/background/filed-returns-all-supported-full-fiscal-year-ledger.ts` | pinned | Removed the signal exclusion; full Vitest failed at `61d052a` before and after: 7 cases in `all-supported-full-fiscal-year-ledger.test.ts` (`withholds an explicit retry for a non-resumable target`). Guard restored. | pending |
| Restart malformed saved-plan index | `src/background/filed-returns-all-supported-full-fiscal-year.ts` | unpinned | Replaced the restart storage-state guard with `false`; full Vitest passed at `4ee0022` before and after (172 files / 3,143 tests). Guard restored. | pending |
| Restart missing saved-plan root | `src/background/filed-returns-all-supported-full-fiscal-year.ts` | unpinned | Replaced the missing-root guard with `false`; full Vitest passed at `8c5cecb` before and after (172 files / 3,143 tests). Guard restored. | pending |

## Alpha package-marker reachability

Pending inventory and mutation at the audited head.
