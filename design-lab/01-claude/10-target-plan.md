# The target plan, and the surface it needs

Agreed across all three passes as the first structural move. This is the spec.

Two Codex passes and this one converged on the same model from different starting points, and UX-B
reached it independently a third time. That convergence is the reason to build it, not the two
sentences of argument below.

## 1. The model

The UI stops editing a `FiledReturnsDownloadScope` and starts building a **plan**: an ordered list of
targets, each of which is exactly what the runtime already knows how to execute.

```ts
// src/core — portal-neutral. No GST vocabulary.
type TargetStatus =
  | "planned" // in the plan, not yet started
  | "queued" // run began, this target has not
  | "running"
  | "saved" // correlated, completed, non-empty download evidence
  | "needs-review" // ambiguous, unmatched, zero-byte, interrupted
  | "unavailable" // the source does not offer it; never an error
  | "skipped"; // an explicit user decision

interface PackTarget {
  id: string; // derived from the tuple; stable across restarts
  sourceId: SourceId; // "gst" today; the seam for income-tax / MCA
  documentType: string; // "GSTR-3B"
  period: string; // "2025-07" or a whole-year key
  artifact: string; // "PDF" | "EXCEL" | "JSON"
  status: TargetStatus;
  evidence?: SafeEvidenceRef; // safe class only — never a filename, URL or path
  reviewReason?: string; // why it paused, in the user's words
}

interface PackPlan {
  id: string;
  sourceId: SourceId;
  targets: PackTarget[];
  output: "individual" | "one-zip";
}
```

**There is deliberately no `complete` on a target.** Completion is a property of the plan and only
holds when every target is in a completion-eligible state. `skipped` is terminal and is _not_
completion-eligible. This is the type-level form of the rule all three passes independently refused
to trade away, stated best by the first Codex pass:

> Batch progress is an aggregate of rows. It must never replace row truth. "Batch complete" is only
> acceptable when every target has a completion-eligible terminal state.

**`saved` is unreachable without evidence.** A plan is a queue over the existing single-target
executor; every row still becomes one `FiledReturnsDownloadTarget` with its own `actionId`, and every
final click is still bound to financial year, period, return type, action identity and visible page
identity before it fires. The plan widens what a user can _ask for_. It does not touch what Pack is
willing to _call done_.

## 2. The three layers

One surface, three bands, in the order a user thinks:

**Result** — "This year's GSTR-3B", "FY 2025-26, everything", "GSTR-1 vs 3B, full year", or _Build
custom_. A recipe expands to targets; it is not a separate mechanism. This is complaint 11, and it is
what makes "last three years of ITRs" expressible the day a second source exists.

**Selection — the matrix.** Document types down, periods across, plus a year column. Cell = one
target. Row label = that document, all year. Column header = every document for that period. Drag =
any arbitrary set. Hatched = the source does not offer it, with the reason on hover.

**Plan — the ledger.** One row per target: document, period, artifact, status, evidence class, and
one next action. The same rows carry the run and the review; nothing is re-rendered into a different
shape when the run starts.

Matrix and ledger are not competing designs — they are the selector and the record, which is where
this pass and the first Codex pass reconciled. Picking 27 targets as 27 rows is worse than painting a
grid; tracking 27 running targets as coloured cells cannot answer _what evidence do I have for
April_. The matrix stays visible above the ledger as a compact overview once the run begins.

**Light and power, complaint 12.** A light user touches the first band only: pick a recipe, press the
button, and the matrix and ledger are summary and receipt. A power user paints cells and reads rows.
The honest caveat is that a matrix is a dense control; the single-click row and column affordances
are what keep it from being a power tool wearing a simple costume.

## 3. Recovery is one row, one question

A paused row expands in place. One question, at most three answers:

- **"I checked Downloads — July is there"** → records a manual observation. It does **not** set
  `saved`; it annotates the row and leaves it reviewable.
- **"Try July again"** → re-runs that target only.
- **"Skip July, keep going"** → `skipped`. Terminal, visible in the ledger, and it blocks plan
  completion.

The nine underlying signal strings do not disappear; they select the question and populate the
existing safe-diagnostics disclosure. And **Reset Pack** sits in the footer of both surfaces, because
`PACK_CLEAR_LOCAL_DATA` already works and is currently reachable only from the options page.

## 4. The surface — and how to get it without spending the permission first

The ledger does not fit the action popup. The popup is 420 × 560, Chromium clamps it to 800 × 600,
and the measured baseline is that it already overflows by 114px on its emptiest state with none of
this on it. It also closes on outside focus, which is the exact gesture the full-year flow asks for
when it tells the user to keep the portal tab in front.

`chrome.sidePanel` fixes all three. It also adds a fifth permission to a reviewed set of four, ahead
of store review — which both Codex passes correctly flagged, and UX-B tied to needing
permission-warning, fallback and browser-version evidence first.

**These do not have to be decided together.** The same document can mount two ways:

| Phase | Mount                                                                                                  | Permission  | Status          |
| ----- | ------------------------------------------------------------------------------------------------------ | ----------- | --------------- |
| **A** | `panel.html` opened as an ordinary extension page via `chrome.tabs.create(chrome.runtime.getURL(...))` | **none**    | buildable today |
| **B** | the same `panel.html` registered with `chrome.sidePanel.setOptions()`                                  | `sidePanel` | `[ASK-FIRST]`   |

Phase A is the whole target plan, working, testable and reviewable, with no manifest change at all.
Phase B is a manifest line plus a few lines of background wiring against the identical document.

So the recommendation is: **build Phase A now, and decide Phase B on evidence from using it.** The
permission stops being a prerequisite and becomes a deployment decision taken after the surface has
proved it is worth defending to a reviewer. The popup keeps its job either way — status, _Open plan_,
and _Reset Pack_ — which is all a 420px surface should have been doing.

## 5. What this does not change

- No change to acquisition. The plan is a queue over the existing executor.
- No change to target binding, download correlation, or any completion guard.
- No new host permission. No new source. `sourceId` is a seam, not an implementation.
- The existing popup flow keeps working while the plan is proven. Nothing is deleted until the
  replacement is live-verified.
- No public copy change, and no claim about multi-portal support or generated statements.

## 6. `[ASK-FIRST]`

- **`sidePanel` permission and manifest wiring** — Phase B only. Not required for Phase A.
- **Persisting a plan.** Scope selections are the user's own choices and may persist, but a plan is a
  larger object than the current scope and its retention, reset behaviour and minimal field set need
  to be defined before it is written. A plan must never carry a taxpayer identifier, a filename or a
  path — only the tuple and the safe evidence class.
- **Any public copy** describing multi-document runs, before the capability is live-verified.

## 7. Build order

1. `PackTarget` / `PackPlan` in `src/core`, plus the plan→existing-target adapter in
   `src/connectors/gst`. Pure types and one mapping function; fully unit-testable.
2. The capability table that replaces the four hand-written label functions, so the matrix can
   disable a cell and state the reason.
3. `panel.html` as a Phase A page: recipe, matrix, ledger, review. Reads the same messages the popup
   reads today.
4. The plan runner in the background — a queue over the existing executor, idempotent across
   service-worker death, persisting per target rather than under one global key.
5. Popup reduced to status + _Open plan_ + _Reset Pack_.
6. Phase B, if approved.

Steps 1–2 are the ones to do first: they are pure, testable, and every later step depends on them.
