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

## Alpha package-marker reachability

Pending inventory and mutation at the audited head.
