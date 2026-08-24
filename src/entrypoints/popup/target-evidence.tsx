import type {
  FiledReturnsFlowSummary,
  FiledReturnsTargetOutcome,
} from "../../connectors/gst/filed-returns-contracts";

/**
 * One row per planned period, saying what Pack can prove about each.
 *
 * A full-year run reported a single aggregate -- "12 periods saved as one ZIP"
 * -- and an aggregate cannot express a partially-settled run. Worse, the count
 * behind it treats a period the taxpayer never filed as a saved file, because
 * `completedPeriods` groups `downloaded` with `not-filed`. A reader deciding
 * whether anything needs their attention got one number that could not answer
 * the question.
 *
 * Only `saved` asserts correlated download evidence. Everything the runtime
 * cannot prove reads as needing review, including a manual observation -- the
 * runtime already refuses to complete a target on one, and this is that refusal
 * made visible.
 */

const OUTCOME_LABELS: Readonly<Record<FiledReturnsTargetOutcome, string>> = {
  saved: "Saved",
  "partly-saved": "Partly saved",
  captured: "Captured",
  "not-filed": "Not filed",
  "needs-review": "Needs review",
  running: "In progress",
  pending: "Waiting",
};

// Text, not colour alone. The panel is read in a side strip beside a dense
// portal page, and a glyph that only differs by hue says nothing to a reader who
// cannot separate the hues.
const OUTCOME_GLYPHS: Readonly<Record<FiledReturnsTargetOutcome, string>> = {
  saved: "✓",
  // Half of a tick: some of the selection arrived. Distinct from the review
  // mark, because nothing here is wrong -- the portal did not offer the rest.
  "partly-saved": "◐",
  // A filled mark for a file Pack holds, an outline for one the browser has
  // confirmed. The difference is the whole point of the column.
  captured: "•",
  "not-filed": "–",
  "needs-review": "!",
  running: "…",
  pending: "·",
};

export function TargetEvidence({ summary }: { summary: FiledReturnsFlowSummary | null }) {
  const evidence = summary?.targetEvidence;
  if (!evidence || evidence.length === 0) return null;

  const saved = evidence.filter((entry) => entry.outcome === "saved").length;
  const partlySaved = evidence.filter((entry) => entry.outcome === "partly-saved").length;
  const captured = evidence.filter((entry) => entry.outcome === "captured").length;
  const needsReview = evidence.filter((entry) => entry.outcome === "needs-review").length;

  return (
    <section className="evidence" aria-label="Per-period result">
      <p className="evidence-status">
        {/* Counts saved files, not finished periods. A run of twelve periods
            where nine were never filed has three saved files, and saying
            "12 of 12" there would be true of the plan and false of the ZIP. */}
        <strong>
          {saved} of {evidence.length} saved
        </strong>
        {/* Counted separately rather than folded into either neighbour. A partly
            saved period is not in the `saved` total, so without its own clause
            it would simply disappear from this line and leave the reader
            unable to account for the difference. */}
        {partlySaved > 0 ? (
          <span className="evidence-partly"> · {partlySaved} partly saved</span>
        ) : null}
        {captured > 0 ? (
          <span className="evidence-captured"> · {captured} captured, ZIP not confirmed</span>
        ) : null}
        {needsReview > 0 ? (
          <span className="evidence-review"> · {needsReview} needs review</span>
        ) : null}
      </p>
      <ul className="evidence-list">
        {evidence.map((entry) => (
          <li className={`evidence-row evidence-${entry.outcome}`} key={entry.period}>
            <span className="evidence-glyph" aria-hidden="true">
              {OUTCOME_GLYPHS[entry.outcome]}
            </span>
            <span className="evidence-period">{entry.period}</span>
            <span className="evidence-outcome">{OUTCOME_LABELS[entry.outcome]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
