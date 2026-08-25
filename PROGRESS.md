# Sustained catalogue-overhaul progress

This is the append-only cycle log for the continued catalogue-overhaul lane. Each cycle records
measured current state, one coherent improvement, its complete gate, and any evidence that changed
the next plan. Synthetic evidence is labelled; no entry implies an authenticated GST Portal run.

## Cycle 1 — pin stages at the emitted-signal boundary

- Window: 2026-08-26 01:07–01:14 IST.
- Picked: the mandatory staged-signal discrimination gap from independent review.
- Measured before: the durable-signal suite had two allowlist-acceptance loops but zero assertions
  mapping an input stage to its exact emitted token. Exact-symbol audit found two typed staged-error
  families: 9 target-review-clear stages and 10 single-period cleanup-checkpoint stages. Graphify
  was installed but this lane has no graph index, so the audit used exact symbol and type searches.
- Changed: added 19 parameterised assertions at the builder boundary. Production builders and
  runtime behavior are unchanged.
- Mutation proof: replacing the target-review builder with the valid constant
  `filed-returns-target-review-clear-failed:storage-key-missing` failed 8 of 9 new cases. Replacing
  the cleanup-checkpoint builder with the valid constant
  `single-period-cleanup-checkpoint-failed:bundle-missing` failed 9 of 10. In both mutations, the
  pre-existing allowlist acceptance remained green; this reproduces the missing coverage class.
- Gate: build passed at 997.37 kB; full Vitest passed 125 files and 2,106 tests; TypeScript passed;
  ESLint passed with zero warnings; Prettier passed repo-wide; package verification passed. Exact
  Vitest footer:

  ```text
       Tests  2106 passed (2106)
    Start at  01:09:53
    Duration  157.30s (transform 3.03s, setup 0ms, import 12.75s, tests 130.44s, environment 7ms)
  ```

- Checkpoint: `0013008 test(connectors): pin staged signal tokens`.
- Learned / plan change: the defect was broader than the nine-stage review-clear family because the
  ten-stage cleanup family had the same false assurance. No third typed `FailureStage`/staged-error
  builder exists in current source. Other dynamic safe-signal constructors are not claimed clean;
  they remain inputs to the later duplicate-fact and test-quality cycles.
