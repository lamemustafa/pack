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

## Alpha package-marker reachability

Pending inventory and mutation at the audited head.
