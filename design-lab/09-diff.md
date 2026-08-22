# Diff — Codex pass vs Claude pass

Two passes over the same surface, run separately. Codex went first and blind; this pass read it
afterwards. What follows is where they agree, where they genuinely conflict, and what the conflict
resolves to.

## 1. Agreement, reached separately

Both passes independently landed on the same two root causes, in the same order of importance.

**The UI edits a configuration when the user is trying to express a result.** Codex: _"the problem
is not that Pack lacks safety or recovery; it's that users have to understand the safety machinery
while trying to express an outcome."_ Claude: the UI edits a `FiledReturnsDownloadScope` when it
should build a job. Same finding, and both passes traced it to the same place —
`FiledReturnsDownloadScope` carries one period, one return type, one artifact, so complaints 3, 5,
6, 7, 11 and 12 are one defect, not six.

**Recovery is correct but asks too many questions at once.** Both passes counted the same control
stack and both concluded the fix is one primary question per paused target derived from
`safeSignals`, with the existing actions still reachable rather than removed.

**Both passes independently refused the same shortcut.** Codex: _"the tempting simple answer is
'make everything multi-select'. That would be wrong if it makes the batch look complete before each
target has its own binding and browser-download evidence."_ Claude: the matrix is a selection
surface over the existing guard, not around it. Neither pass was willing to buy easier batch
selection with weaker target binding. That is the constraint most likely to be quietly traded away
by a third party, and it survived two independent attempts.

**Both passes reject "more return types" as the growth axis** and both put the computed artifact
ahead of it. Codex's own predicted disagreement — _"the other pass may prioritize more filings before
computed outputs"_ — did not happen.

**Both passes want ComplyEaze demoted, not enlarged.** Codex: _"the right direction is not to make
ComplyEaze bigger… Pack should be the product identity; ComplyEaze should be the trust parent."_
Claude reached the same lockup rule. This directly contradicts the intuition behind complaint 2, and
two passes agreeing on the contradiction is worth more than either saying it alone.

## 2. Conflicts

### 2.1 Selection metaphor — **table vs matrix**

|          | Codex                                                                                                     | Claude                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Model    | Target-plan **table**: one row per target, columns for return, period, artifact, status, evidence, action | Period **matrix**: return types down, twelve fiscal months across, cells are targets     |
| Strength | Every row shows its own evidence class and its own next action                                            | 27 targets fit in one glance; row/column headers select a year or a month in one click   |
| Weakness | 27 rows do not fit a 420 × 560 popup                                                                      | A cell can encode status by colour but cannot show evidence class or a per-target action |

**This is the most productive disagreement of the two passes, and it resolves rather than
arbitrates.** They are not competing designs; they are the selector and the ledger.

A matrix is the right _input_ control — picking 27 targets as 27 table rows is worse than painting a
grid, and the grid is where "GSTR-3B, all year" is one click. A table is the right _output_ control —
once a run is underway, a coloured cell cannot answer "what evidence do I have for April" and a row
can. Codex's rule is the sharper statement of why the ledger must exist: _"batch progress is an
aggregate of rows. It must never replace row truth. 'Batch complete' is only acceptable when every
target has a completion-eligible terminal state."_

**Resolution: matrix to select, table to track.** The matrix builds the plan; the plan renders as
rows; the run updates rows; the matrix becomes a compact status overview above the rows.

### 2.2 Surface — **popup vs side panel**

Codex keeps start and recovery in the action popup and opens a wider page only if the plan outgrows
420px. Claude moves planning, run and review into `chrome.sidePanel` and reduces the popup to status
plus two buttons.

Codex's position is the conservative one and it has a real argument: the reviewed permission set is
four items and about to face store review, and a permission added for ergonomics is a permission you
defend to a reviewer.

But its own design forces the question. A target-plan table with six columns per row does not fit
420 × 560 — and the measured baseline is that the _current_ surface, with none of this, already
overflows by 114px on its emptiest state. Codex's escape hatch ("a wider page can own planning if
the target plan outgrows 420px") is not a hypothetical: the plan outgrows 420px in its own worked
example of fourteen targets.

There is also a fact neither pass gave enough weight: the popup **closes on click-away**, and Pack's
full-year flow instructs the user to keep the GST tab in the foreground. The surface is destroyed by
the gesture the product requires. That is not an ergonomics preference, it is the run having no
place to report from.

**Resolution: Codex is right that this is ask-first and right that it should not be assumed. Claude
is right that the table it proposes cannot live in a popup.** The honest framing for the owner is
that the side panel is the price of the target plan, not a separate nicety — decide them together,
`[ASK-FIRST]`.

### 2.3 First slice — **model vs typography**

Codex votes to implement the target-plan row model first. Claude votes to fix the type system and
mark first, because both cost zero architecture and no permission.

**Codex has the better argument and I am changing my position.** The type fix is cheap, but cheap is
not the same as first. The row model is what six of the fifteen complaints are actually about; a
typographic pass on a surface whose information architecture is about to change is work done twice.

The one qualification, from this pass's own new measurement: **the token adoption problem sits in
front of both.** 102 hex literals against 31 token references, with `popup-controls.css` — every
radio, option card and select in the builder — referencing the design system exactly once. Any new
surface built now inherits that, and the restyle that complaint 15 needs is not possible until
colour has one source. Collapsing literals to tokens is mechanical, reviewable, and it makes the row
model cheaper rather than competing with it.

**Resolution: tokens, then the row model, then typography and mark.**

## 3. Findings only one pass had

| Finding                                                              | Pass                | Status                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 16px icon dominant navy at **1.18:1** on a dark toolbar              | Codex               | **Confirmed** by this pass from rendered pixels; light-toolbar figure differed (12.94 vs 13.63) only through the assumed toolbar colour |
| 68 distinct colours in 192 opaque pixels at 16px                     | Claude              | New                                                                                                                                     |
| Token system 16% adopted — 102 literals, 31 token refs               | Claude              | New                                                                                                                                     |
| 674px of content in a 560px frame; 114px clipped on the idle state   | Claude              | Unverified by Codex — its browser never launched                                                                                        |
| Zero `@font-face`; rendered weights include synthesised 750/850      | Claude              | Unverified by Codex                                                                                                                     |
| Header logo is 28 path elements plus the mark                        | Codex               | Accepted                                                                                                                                |
| Three different mark constructions across icon, mark and header logo | Codex               | Accepted, and sharper than this pass's version                                                                                          |
| `.pack-summary-meta` at 4.49:1                                       | Both, independently | Settled — three methods, one number                                                                                                     |

## 4. Where the passes were wrong

**Codex ran `graphify update .`** despite `pack/CLAUDE.md` stating graphify does not apply to this
repo. Harmless — output is gitignored and 1,979 nodes is under the threshold where it is documented
as broken — but it is a deviation from an explicit repo instruction.

**Codex could not run a browser at all**, so it labelled its layout conclusions as source-derived
and declined to treat the tool failures as product evidence. That was the right call and it is why
its findings are usable, but it means no rendered number in that pass has been checked by anyone but
this one.

**Claude's brief leaked two absolute local paths** into a committed file, which `AGENTS.md` lists
alongside GSTIN and portal URLs as forbidden. Caught by scanning Codex's output for exactly that
class of violation and finding the hits in my own file instead. Fixed by amend before push.

**Claude asserted the Inter fallback behaviour without testing it.** Zero `@font-face` is measured;
"therefore it renders differently on a user's machine" is inferred. Neither pass tested it. Flagged
in `01-findings.md` as open.

**Claude's published artifact said "six buttons from twelve signals."** The measured figure at
`e72438b` is 10 button sites and 10 `signals.has` checks. The shape of the finding holds; the numbers
were quoted from an earlier base and drifted.

## 5. What both passes agreed to leave alone

No runtime source change. No permission, host permission, manifest, CSP or storage change. No README,
store copy, release note or readiness claim. No PR. No live portal session. No private-hub content in
any committed file.

## 6. `[ASK-FIRST]`, merged

- `chrome.sidePanel` added to the reviewed permission set — and per §2.2, decide it together with the
  target plan rather than separately.
- New host permissions for any non-GST portal, plus connector code, live evidence capture, and
  public-copy changes. The largest store-review surface Pack would ever add.
- New or widened persisted fields if portal choice, target presets or a saved plan are stored.
- Bundling a webfont — a new binary asset.
- Any public copy claiming reconciliation, annual-filing support, non-GST support or durable
  full-year support, which `docs/PUBLICATION_READINESS.md` gates.
- Any change to a target-binding or identity guard. Neither pass proposes one; it is listed so that
  a later implementer cannot treat batch ergonomics as licence.

## 7. Recommended order

1. **Collapse 102 hex literals into the token set.** Mechanical, reviewable, no architecture, and it
   unblocks every later visual change.
2. **The target plan: result picker → matrix selection → target rows.** Six complaints. Decide the
   surface at the same time, because the rows do not fit the popup.
3. **One question per paused target**, plus Reset Pack reachable from the popup.
4. **One capability table** for return types, killing the three names for one PDF.
5. **Type scale and mark.** Four sizes, three real weights, one shipped font; a mark that resolves in
   single-digit colours at 16px and survives a dark toolbar.
6. **The consolidated statement**, and only then a second portal.
