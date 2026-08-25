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

## Cycle 2 — close Direction B product parity

- Window: 2026-08-26 01:15–01:29 IST.
- Picked: compare every explicit Direction B behavior with the packaged product and close or
  disposition every divergence.
- Measured before: prototype and product both had four steps, one select, one active scope, a 3→4
  control budget, focus restoration, nine rows, six non-interactive unsupported rows and zero 320px
  overflow. The prototype listed concrete artifact availability; the product disclosure reduced all
  supported rows to `available`. Direct Playwright input disproved a suspected keyboard difference:
  Enter on the prototype's focused select did not advance it either.
- Changed: supported rows now derive and display their concrete artifact labels from the same
  catalogue object. Bundle selections remain in the final file step because they are combinations,
  not additional portal artifacts. Removed the unused optional start-scope override and 25 lines of
  stale preset-era comments left after preset deletion. Added the full parity ledger in
  `design-lab/10-catalogue-overhaul/05-direction-b-parity.md`.
- Without-fix proof: the new render assertion failed once against the old disclosure, reporting
  expected `Monthly · available · Filed return (PDF) · Portal data (JSON)` and received the
  nine-row markup containing only `Monthly · available`.
- Packaged synthetic measurement after the change: step heights 624.76 / 693.55 / 676.76 /
  681.95px; 3 / 4 / 4 / 4 controls; select focused at every step; catalogue-open height 1,092.70px;
  zero overflow or clipped descendants; zero unsupported controls. The prototype's open catalogue
  was 1,405.84px. No portal action ran.
- Impeccable audit: deterministic detector returned `[]`; technical score 19/20. No P0/P1/P2
  finding remained in this cycle; assistive-technology qualification stays open for its dedicated
  cycle.
- Gate: build and package verification passed at 997.44 kB; full Vitest passed 125 files and 2,107
  tests; TypeScript passed; ESLint passed with zero warnings; Prettier passed repo-wide. Exact
  Vitest footer:

  ```text
       Tests  2107 passed (2107)
    Start at  01:26:03
    Duration  167.97s (transform 3.09s, setup 0ms, import 13.44s, tests 138.45s, environment 8ms)
  ```

- Checkpoints: `7382070 feat(panel): show catalogue artifact availability` and
  `afdb6aa refactor(panel): remove preset-era residue`.
- Learned / plan change: the prototype is a direction, not a specification to copy literally.
  Dynamic FY/month availability, real guarded run states, exact action copy and concrete-artifact
  semantics are intentional product improvements. The next cycle must enumerate product-only
  loading, empty, error and permission states rather than pretending the prototype covers them.
