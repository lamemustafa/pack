# Direction — Claude pass

This pass proposes the same underlying model as the Codex pass and a different control for it. The
reconciliation is in `../09-diff.md`; this file states the position on its own terms.

## The move

Stop editing a scope. Build a **job**: a set of targets plus an output contract.

```ts
interface PackJob {
  id: string;
  source: "gst" | "income-tax" | "mca"; // complaint 9 gets a home
  targets: FiledReturnsDownloadTarget[]; // complaints 5, 6, 7, 11
  output: "individual" | "one-zip" | "consolidated-statement";
}
```

`FiledReturnsDownloadTarget` already exists and already carries `actionId`, financial year, period,
return type and artifact. A job is a list of them. **The per-target binding guard runs unchanged on
each one** — this widens what a user can ask for without touching what Pack is willing to call
complete.

Once a job is a list of targets, "last three years of ITRs", "all returns for March" and "3B for
twelve periods" are the same object with different contents. Complaint 11 falls out for free, and
complaint 5 — a whole-year 3B run independent of the JSON or all-formats run — stops being blocked
by `FULL_FISCAL_YEAR_PERIOD` occupying the only spare slot in a month-shaped field.

## The control: a period matrix

Return types down, twelve fiscal months across, plus a year column.

- Click a cell → one target.
- Click a row label → that return, all year.
- Click a month header → every return for that month.
- Drag → any arbitrary set.
- Hatched cells are periods the portal does not offer, with the reason on hover.

Light users click a row label and press the button. Power users paint cells. That is the honest
answer to complaint 12 — and the honest caveat is that a matrix is a dense control, so the
single-click row and month affordances are what keep it from being a power-user tool wearing a
simple costume.

The footer states what the batch will actually cost: **"27 files · one ZIP · 1 save prompt"**. That
is load-bearing, not decoration. `downloads.download({saveAs:false})` cannot override a user's "ask
where to save each file" preference, so 27 targets means 27 dialogs unless they are bundled.

## The ledger

The matrix is the selector. It is not sufficient as the run display: a coloured cell can encode
status but cannot show an evidence class or a per-target next action. The Codex pass is right that
the run needs rows, and its rule is the correct one — batch progress is an aggregate of rows and
must never replace row truth. "26 of 27 saved, 1 skipped" is admissible; "batch complete" is
admissible only when every target has a completion-eligible terminal state.

So: **matrix to select, rows to track**, with the matrix persisting above the rows as a compact
overview.

## Recovery

One paused target, one card, one question, at most three answers — _saved_, _try again_, _skip_. The
ten `signals.has` checks do not disappear; they move behind the "Safe diagnostics" disclosure that
already exists.

And **Reset Pack lives permanently in the footer**. `PACK_CLEAR_LOCAL_DATA` already works; it is
reachable today only from the options page, which the popup never links to.

What must not change: _skip_ and _mark saved_ still cannot mark a target complete without correlated
download evidence. Simplifying the question is copy and layout; it is not a relaxation of the guard.

## Surface `[ASK-FIRST]`

The rows do not fit 420 × 560 — a surface that already overflows by 114px with none of this on it.
`chrome.sidePanel` removes the 600px clamp, survives tab switches, and stays open while the user
works in the portal, which matters because the full-year flow asks the user to keep the GST tab in
front and that is the exact gesture that closes a popup.

It also adds a permission to a reviewed set of four, ahead of store review. **Decide the surface and
the target plan together**, because the plan is what forces the surface.

## Transparency, since the product may grow past downloading

The owner's clarification — advanced capabilities are fine if plainly stated — has a concrete UI
consequence. If Pack computes anything (a consolidated statement, a reconciliation), then for every
derived figure the UI must be able to name the portal artifact and period it came from, and a
Pack-computed value must never be presented in the visual language of a portal-issued one. The
GSTR-3B PDF's own convention is usable evidence here: the portal prints `-` where a combination is
structurally impossible, so a consolidation can omit exactly those rows on the portal's authority
rather than on ours.

## Ordering

Stated in `../09-diff.md` §7, after the two passes were reconciled. This pass's original ordering
(typography first) was revised — see §2.3 there.
