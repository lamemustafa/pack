# Handoff

## Confident

- The main UX issue is not visual polish alone. The current popup asks users to configure a single
  scope, while the complaints are mostly about expressing a result and then seeing a target plan.
- Batch selection must be modeled as explicit target rows. A redesign that makes multi-period or
  multi-return selection feel easy but hides per-target evidence would violate Pack's core safety
  model.
- Recovery actions should be reduced to one primary question per paused target, with the existing
  advanced actions still reachable.
- The brand problem is real at small sizes. The current favicon/extension icon is too detailed and
  dark-toolbar contrast is weak for the dominant navy pixels.

## Unsure

- I could not complete browser-rendered measurements because DevTools MCP script execution was
  cancelled and system Chrome/Brave aborted under Playwright. The next thread should retry with a
  working browser harness before treating layout measurements as final.
- I did not validate the proposed wireframe against actual React mount behavior. It is a static
  design artifact only.
- I did not run live GST Portal QA, by design.

## Deliberately Not Done

- No runtime source changes.
- No permission, host permission, manifest, CSP, or storage changes.
- No README, store-copy, release-note, or public readiness claim changes.
- No PR opened, no push.
- No private-hub content copied into committed artifacts.

## Expected Disagreements

- The other pass may prefer a broader dashboard/options-page redesign. My position is that the
  action popup should still own start/recovery, while a wider page can own planning if the target
  plan outgrows 420 px.
- The other pass may prioritize "more filings" before computed outputs. I think the first IA move
  should be result -> target plan, because it supports both paths while preserving safety.
- The other pass may keep the folder/zipper mark. I would simplify to a stronger 16 px silhouette
  first, then decide whether the metaphor is document-ledger or target-archive.

## Private Hub

The private hub was consulted for judgment only. Do not publish hub-derived market, competitor,
or protocol details from this handoff. Re-derive any public claim from public sources and current
repo evidence before it leaves this lane.

## Next Step

After the second independent pass, diff the two takes and choose one first implementation slice. My
vote: implement the target-plan row model in the UI before changing runtime acquisition behavior.
