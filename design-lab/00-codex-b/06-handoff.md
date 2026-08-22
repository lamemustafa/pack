# UX-B handoff

## Confidence

- **High:** current popup geometry, control count, computed type, font packaging/fallback on the
  tested machine, recovery markup, clear-state reachability, active scope shape, preview drift, and
  icon behavior. These were measured or traced directly at the frozen base.
- **Medium:** side panel as the best primary surface. Chrome behavior supports the choice, but user
  comprehension, toolbar discovery, permission presentation, and store-review impact need testing.
- **Medium:** result-recipe language and plan review. The wireframe makes the model concrete but has
  not been tested with CAs or compliance operators.
- **Conditional:** the generated GSTR-3B working paper. It is recommended only if deterministic
  source lineage, unresolved-period handling, and a strict generated-versus-original boundary can
  be proven.

## Uncertainty and falsified inputs

- The asserted parent June critique archive was absent from the available design material and its
  history. Its score and P1/P2 claims are unverified.
- The static preview is not a faithful copy of the mounted ready UI. It is suitable for stylesheet
  status coverage only.
- Cross-platform font output remains unmeasured. This machine used system-ui fallback and produced
  distinct 750/850 glyph output; Windows and Linux may differ.
- The exact user cost of a fifth permission and side-panel discovery needs an unpacked-extension
  study and store-review evidence.
- No compliance-professional review was performed for the generated-statement proposal.

## Deliberately not done

- No live authenticated session, downloaded artifact, real identifier, or realistic synthetic
  identity was used.
- No production source, manifest, permission, persistence contract, target-binding guard, public
  copy, dependency, or release surface was changed.
- No navigation was constructed and no portal behavior was specified from guesswork.
- No tool hook/configuration or generated design framework was retained.
- No push, pull request, or release-readiness claim was made.

## Private knowledge boundary

A read-only private knowledge consult informed the growth-axis questions. No private claim, market
name, protocol detail, vulnerability, or quotation was copied here. The public recommendation was
re-derived from Pack's public contracts, current UI, and public product/tool surfaces. Nothing in
this deliverable requires private evidence to be defensible.

## First change if only one is allowed

Create the persistent result-recipe and target-plan workspace in a side panel while leaving the
existing popup and execution path intact behind a narrow entry-point transition.

Cost: a new permission and manifest surface, browser/store review, two-shell testing, accessibility
and width testing, plus careful adaptation of popup state without changing any target execution or
completion guard. It is still first because it removes the structural 560 px constraint and the
outside-focus closure that no amount of spacing polish can fix.

## Approval gates carried forward

See the flat `[ASK-FIRST]` list in `02-direction.md`. None was implemented.

## Verification record

All commands completed with exit code 0 unless a result is explicitly described as an advisory
finding:

- `pnpm workflow:preflight`
- `pnpm exec wxt build`
- `pnpm exec vitest run`
- `pnpm exec tsc --noEmit`
- `pnpm exec eslint . --max-warnings 0`
- `pnpm exec prettier --check .`
- `node scripts/verify-extension-package.mjs .output/chrome-mv3`

The final three Vitest lines were:

```text
 Test Files  105 passed (105)
      Tests  1720 passed (1720)
   Duration  147.72s (transform 1.25s, setup 0ms, import 10.35s, tests 125.77s, environment 7ms)
```

Visual/tool review ran in four rounds: current preview and mounted build; first proposed surface;
tool-led rectification; final visual/accessibility check. Impeccable's proposed-surface findings fell
from 24 to one documented disagreement. Final proposed-surface Lighthouse scores were 100 for
accessibility, best practices, SEO, and agentic browsing, with zero failures.

A case-insensitive privacy scan checked prohibited portal addresses, real identifiers, person-name
fields, session material, downloaded-file values, shell transfer commands, and absolute workstation
paths. It returned no content matches. The two standard SVG XML namespace declarations were
reviewed separately and are not portal addresses.

Generated graph data was deleted. The ignored tree contained only dependency and normal WXT build
directories; no hook, agent, cursor, skill, or tool configuration remained. Immediately before the
final commit, `git status --porcelain --untracked-files=all` contained exactly:

```text
A  design-lab/00-codex-b/05-tooling-log.md
A  design-lab/00-codex-b/06-handoff.md
```
