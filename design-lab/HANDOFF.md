# Handoff — Pack UX redesign lane

**Written 2026-08-21 for whichever thread picks this up.** Read this before touching Pack UI.
It is short on purpose; the depth is in the files it points at.

## State

|              |                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------- |
| Branch       | `tapish-codex/ux-redesign`, based on `e72438b`                                            |
| Pushed       | **No.** No PR, no remote branch, nothing outward-facing.                                  |
| Working tree | clean                                                                                     |
| Gates        | full suite green — see the last runtime commit for the verbatim Vitest lines              |
| Second lane  | `tapish-codex/ux-redesign-b` — Codex Desktop's independent pass, committed, also unpushed |

## Do not restart the analysis

Three independent passes already ran: Codex CLI, Codex Desktop, and Claude. They converged.
Re-deriving it costs hours and will reach the same place.

- `design-lab/09-diff.md` — where the passes agreed, where they conflicted, how each conflict
  resolved, and where each pass was wrong.
- `design-lab/01-claude/01-findings.md` — measurements, and the five claims a later pass
  falsified. **Read the corrections section**; several early findings in this lane are retracted.
- `design-lab/01-claude/10-target-plan.md` — the model, plus §8 corrections after review.
- `design-lab/00-codex/`, `design-lab/00-codex-b/` — the other two passes.

## What is committed to `src/` and already gated

1. **Colour token collapse** — 102 literals → one `:root` block. `docs/DESIGN_TOKENS.md`.
2. **Capability table** — `src/connectors/gst/filed-returns-capabilities.ts` owns per-return
   labels and support. Add a return type by adding a row.
3. **Phase A panel** — `src/entrypoints/panel/`, an ordinary extension page.
4. **`DESIGN.md`** — the design contract, tokens verified against `global.css`.

## Rules this lane established, that are easy to break

- **A colour literal outside `:root` in `src/styles/**` is a defect.** That duplication caused
  five WCAG AA failures; deduplication found all five where a detector found one.
- **`returnType === "GSTR-…"` to decide a _name_ or an _availability_ belongs in the capability
  table.** Behavioural branches stay in the connector — that distinction is the point.
- **The default view has a control budget: three or four.** Anything new replaces something or
  goes behind a door. This exists because six locally-correct review fixes produced a 400px panel
  with ~384 interactive elements — worse than the 11-control popup the exercise started by
  criticising. `design-lab/01-claude/11-panel/_previous-overbuilt.html` is kept as the evidence.
- **Never ship a control for something that does not exist.** Four computed-artifact checkboxes
  were removed, three of which read "not built yet".
- **The lockup is mark + "Pack" + a separate muted "ComplyEaze"**, never the squeezed wordmark.
  The first implementation cut violated this two commits after the lane wrote the rule.

## Next steps, in order

1. **Decide whether the popup simply becomes the simplified panel.** At four controls it now fits
   420×560. If yes, the `sidePanel` permission may never be needed for the common case — the
   cheapest available outcome and it should be settled before more is built.
2. **The plan runner.** `PackTarget` / `PackPlan` in `src/core` plus a background queue over the
   existing single-target executor. Until this exists the custom view is single-scope and the
   multi-target grid cannot ship. Pure types and one adapter first; both are unit-testable.
3. **The mark.** Measured: 1.18:1 on a dark toolbar, 68 colours in 192 opaque pixels at 16px.
   Directions drawn in `design-lab/01-claude/04-brand.md`; none adopted. `[ASK-FIRST]`.
4. **`sidePanel`** — only after 1 is decided. `[ASK-FIRST]`.

## `[ASK-FIRST]` — do not implement without the owner

- `sidePanel`, or any change to `manifest-policy.ts`, `wxt.config.ts`, permissions, CSP.
- Any new host permission — the largest store-review surface Pack can add.
- Persisting a plan, or widening what is persisted.
- Replacing the shipped icon set, or any store/README copy.
- Any claim about multi-portal support or generated statements. There is **no statutory
  consolidation code in Pack** — every `reconcile*` identifier is download-evidence
  reconciliation. A consolidated statement is greenfield.

## Before opening a PR

Build the body from `.github/PULL_REQUEST_TEMPLATE.md`. `Review gate` fails on a body written
from scratch, and `gh pr create --body` bypasses the template silently — four consecutive PRs
were blocked that way. Note that this lane touches `src/styles/**`, `src/connectors/gst/**` and a
new entrypoint, so the privacy and security reviewers both apply.

Run `pnpm workflow:preflight` and `pnpm review:gate -- --strict-head-review`, and disposition
every finding as fixed, stale, rejected, or a linked follow-up — each with evidence.
