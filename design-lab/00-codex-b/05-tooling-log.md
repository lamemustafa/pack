# UX-B tooling log

## Principle

Tool findings are hypotheses. Product context, source tracing, browser measurement, accessibility,
privacy, and the evidence contract outrank generic aesthetic advice.

## Runs and raw results

| Tool / source                 | Version or mode                                                 |            Raw count | Accepted | Rejected | Judgment                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------- | -------------------: | -------: | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impeccable                    | CLI 3.6.0, static over `src/styles` and `src/entrypoints/popup` |                    0 |        0 |        0 | Reproduced `[]`. Static rules detect code-level AI-design signatures, not overflow, duplicate harness drift, singleton task scope, or recovery decision count. Zero is not a design pass.                                                                                                                                                                                                                                                         |
| Impeccable                    | CLI 3.6.0, dynamic preview at 420 x 600                         |                    4 |        2 |        2 | Reproduced low contrast 4.49:1, cramped padding, overused Inter, and flat hierarchy (11–18 px, 1.6:1). Accepted contrast fragility and the missing/overused primary-font symptom. Rejected cramped padding because no target was reported and visual inspection could not localize it; rejected the demand for larger type steps because dense product context favors compact hierarchy, though size-token consolidation remains useful.          |
| Impeccable                    | Proposed side-panel surface at 1280 x 900                       | 24 initial / 1 final |       24 |        1 | The first pass exposed undersized status text, explicit-button padding, decorative kickers, all-caps generated-output copy, and a tinted shadow. All were corrected. Subsequent counts were 3, 2, then 1. The remaining flat-hierarchy warning sees 12–22 px across seven computed sizes; it is rejected because the functional hierarchy is visually distinct and the product register favors dense operational type over marketing-scale steps. |
| Taste Skill                   | `design-taste-frontend`, instruction skill                      |                  N/A |        3 |        4 | Accepted explicit design dials, pre-flight domain framing, and anti-repetition review. Rejected landing-page composition, large-display type, decorative image, and high-motion defaults as out of domain for a dense regulated extension. The skill itself says dense multi-step product UIs are outside its main lane.                                                                                                                          |
| Chrome DevTools Lighthouse    | Desktop snapshot of preview                                     |             2 failed |        1 |        1 | Accessibility 95, best practices 100. Accepted the contrast failure. Rejected missing SEO meta description as irrelevant to an extension popup.                                                                                                                                                                                                                                                                                                   |
| Chrome DevTools Lighthouse    | Desktop snapshot of final proposed surface                      |             0 failed |        5 |        0 | First proposed pass failed five audits: ARIA role mismatch, three contrast nodes, missing main landmark, missing meta description, and the resulting malformed accessibility tree. The wireframe was corrected; final accessibility, best practices, SEO, and agentic-browsing scores were all 100.                                                                                                                                               |
| Product Design audit workflow | Captured-state and source-comparison workflow                   |                  N/A |        2 |        1 | Accepted screenshot-first state review and same-viewport comparison. Rejected its no-handcrafted-SVG rule because the explicit deliverable requires editable SVG brand directions.                                                                                                                                                                                                                                                                |

## Impeccable disagreement, explicitly resolved

The four dynamic findings do not prove Pack is AI slop. Two are generic `slop` rules and two are
quality rules. "Overused Inter" points to a real runtime inconsistency only because Inter is named
but absent—not because a popular font is automatically unusable. "Flat hierarchy" recommends wider
size ratios, while Pack's product register calls for operational density. The product register wins:
reduce redundant weights/sizes, but do not introduce marketing-page scale.

The other-thread theory is also too broad. Pack is neither "slop" nor simply "undesigned." It has
specific design intent and a few detector-visible generic choices. The detector is structurally
blind to the more consequential architectural defects.

## Tools considered and not installed

- **skills.sh:** useful as a discovery directory, not quality evidence. Popularity/install count
  does not establish fit, privacy, maintenance, or safety. No additional skill was installed merely
  because it ranked highly.
- **21st.dev:** rejected for this task. It is a React/shadcn component-and-template registry focused
  heavily on marketing blocks, animated heroes, shaders, gradients, and copied component code. Pack
  needs contract-specific IA and has no missing generic component that justifies copied code or a
  runtime dependency.
- **Additional design systems:** rejected because Pack's own product register, CSS, and the parent
  ComplyEaze tokens supplied sufficient grounding. Adding a framework would conceal rather than
  solve the surface/plan mismatch.

## Installation footprint

Impeccable ran transiently through `pnpm dlx`; Taste Skill was already available at user scope and
was read/applied without a project install. The missing repo-local Impeccable context script was not
recreated. No hook, agent, cursor, skill, dependency, or tool configuration was added to the repo.
Generated graph data and build output remained ignored and were removed or excluded from commits.

Before each commit, `git status --porcelain` was inspected and only explicit
`design-lab/00-codex-b` deliverables were staged. Final status and the exact pre-final-commit proof
are recorded in `06-handoff.md` after verification.
