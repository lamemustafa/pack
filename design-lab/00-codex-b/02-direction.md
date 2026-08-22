# UX-B direction: result recipe, explicit plan, evidence ledger

## Decision

Make a persistent side panel the primary workspace and reduce the toolbar action to an entry point
and active-run indicator. Inside the panel, make the first object a **result recipe**, compile it
into an inspectable **target plan**, and execute that plan as the existing sequence of individually
bound targets.

This is a product direction, not implementation. The permission and manifest work is gated below.

## Information architecture

### 1. Prepare a result

The first sentence is the user's intended result:

> Prepare a complete filed-return archive for the selected financial year.

Common recipes are one gesture: last filed period, full financial year, or unresolved periods. A
light user can choose one and continue. "Custom result" reveals the power-user builder for multiple
periods, return types, and formats. This is structured input, not pretend natural language; the UI
must not imply it understands arbitrary requests.

### 2. Review the target plan

The recipe compiles into a Cartesian plan with a visible count and exceptions before execution.
One gesture can select several axes, but every generated row has its own connector, financial year,
period, return type, artifact type, action identity, and expected source kind. Unsupported
combinations appear as excluded rows with reasons; they are not silently dropped.

This reuses the portal-neutral direction already represented by `DownloadScope`, `DownloadPlan`,
and `DownloadTarget` in `src/core/contracts.ts`. The current filed-returns scope remains the
connector's one-target execution input until a separately reviewed migration proves parity.

### 3. Run with an evidence ledger

The panel shows counts for queued, active, completed, needs answer, and excluded targets. A click
changes a target to "waiting for download evidence," never to complete. Completion still requires
correlated, completed, non-empty browser-download evidence for that exact target.

Because Pack must click visible controls on the current page, the plan is not an autonomous crawler.
Before starting, it states which portal page the user must have visible. If the next control is not
present, that target pauses rather than constructing a navigation.

### 4. Ask one answerable recovery question

Recovery gets its own state instead of a list of generic buttons. Example:

> Is the visible page showing April 2026 GSTR-3B?

Actions are "Yes — retry this target" and "No — leave it paused." Download reconciliation can ask
"Does Browser Downloads show this attempt as completed and non-empty?" Recording an observation
never completes a target by itself. Safe diagnostics remain available under a secondary disclosure.

### 5. Finish with a result receipt

The final view separates:

- portal-original artifacts;
- Pack-generated indexes or reports;
- unresolved or excluded targets;
- the recipe, target-plan version, and transformation version;
- source coverage and checks performed for each generated output.

"Reset Pack" is always visible in the panel footer. It offers "Clear current run" and "Reset all
local Pack data" with a consequence summary and confirmation. It does not claim to remove files
already handed to Browser Downloads.

## Light user versus power user

The default is genuinely simpler only for known recipes. It does not hide a multi-select matrix
behind friendly prose and call that simplicity. Light users see a recipe, one scope choice, target
count, exceptions, and start. Power users open "Customize result" or "Inspect target plan" to edit
axes and exclusions. Both execute the same plan and evidence rules.

## A second portal without a rewrite

Add a connector capability descriptor beside the existing portal-neutral connector and target
contracts. It declares supported result kinds, period vocabulary, document/format combinations,
required starting-page capability, and which outputs are original versus generated. The recipe
compiler consumes capabilities; a connector adapter converts one target into a portal-specific
flow.

The cost is substantial: a newly reviewed host set, portal-specific captures and decoy fixtures,
authentication-state handling without collecting session material, target-binding rules, live
qualification for every supported artifact, recovery language, store review, and continuing portal
change maintenance. A connector selector alone is not multi-portal support.

## Transparent advanced capabilities

Advanced means inspectable, not hidden. Every computed output must:

1. label itself as Pack-generated and never as a portal-original filing;
2. list the source artifact class and covered periods without exposing sensitive identifiers;
3. publish a versioned transformation specification and deterministic checks;
4. show exclusions, missing inputs, unresolved targets, and any non-computable fields;
5. preserve a local row/section-to-source evidence map;
6. be reproducible from the same local inputs and version;
7. fail closed rather than infer across missing or ambiguous source values.

Open source makes this verifiable; it does not make opaque computation transparent by itself.

## Three committed arguments

### 1. Is `chrome.sidePanel` right? **Yes, as the primary workspace.**

Chrome documents that an action popup closes when focus moves outside it and cannot be kept open.
That directly conflicts with a flow that requires interaction with the page. Chrome also documents
that a side panel can remain open across tab navigation and hosts an extension page with Chrome API
access. The persistent, taller surface fixes the interaction architecture rather than compressing
the form harder.

**Case against:** it adds a fifth extension permission, increases store-review explanation and
possibly user concern, has different discovery and width behavior, and introduces a second shell to
test. An extension tab/options workspace avoids a new permission and offers more width. It is less
useful beside the page and still forces context switches. The recommendation remains side panel,
but only after permission-warning and review evidence.

### 2. Should a consolidated GSTR-3B statement exist? **Yes, as a separately named generated working paper.**

It matches the clarified product direction: users need a result, not only a bag of files. Pack's
core contract already distinguishes portal-original from Pack-generated reports. The statement
should be opt-in, generated only from complete supported inputs, and carry field lineage, coverage,
transformation version, unresolved periods, and a conspicuous "not a filed return" boundary.

**Case against:** consolidation changes Pack from acquisition into interpretation, adds statutory
and support exposure, and can make a polished but wrong result feel more authoritative than its
inputs. If field lineage and deterministic source coverage cannot be made inspectable, do not ship
it. It must never silently become the default output of a download recipe.

### 3. Is more return types the right growth axis? **No; complete auditable outcomes are.**

Coverage is necessary when it completes a practitioner job, but raw type count optimizes a catalog.
The stronger axis is a small set of results—complete archive, missing-period review, evidence-indexed
working paper—each backed by explicit source coverage and recovery. Public product surfaces already
make broad return coverage easy to advertise; Pack's harder, defensible work is proving that each
result is correctly bound and locally reproducible.

**Case against:** users search by portal and return name, and broader coverage can unlock adoption
before higher-order results matter. The compromise is not to stop adding types; add a type when it
completes a named result or reuses an already qualified acquisition mechanism, never merely to raise
the count.

## Flat approval gates

- [ASK-FIRST] Add the `sidePanel` permission and related manifest/action wiring only after permission-warning, store-review, fallback, and browser-version evidence is recorded.
- [ASK-FIRST] Add any second-portal host permission only with an independently reviewed exact host set, connector qualification plan, and privacy review.
- [ASK-FIRST] Persist a saved recipe or connector choice only after defining the minimal fields, retention, reset behavior, and data-minimization tests.
- [ASK-FIRST] Strengthen public copy for multi-portal support or generated statements only after the corresponding capability and evidence protocol are proven.
