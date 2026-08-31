import type {
  FiledReturnsAllSupportedFullFiscalYearTargetEvidence,
  FiledReturnsFlowSummary,
  FiledReturnsTargetOutcome,
} from "../../connectors/gst/filed-returns-contracts";

type TargetEvidenceEntry =
  | NonNullable<FiledReturnsFlowSummary["targetEvidence"]>[number]
  | FiledReturnsAllSupportedFullFiscalYearTargetEvidence;

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

export function TargetEvidence({
  summary,
  evidence: suppliedEvidence,
  groupByReturn = false,
}: {
  summary?: FiledReturnsFlowSummary | null;
  evidence?: readonly TargetEvidenceEntry[];
  groupByReturn?: boolean;
}) {
  const evidence = suppliedEvidence ?? summary?.targetEvidence;
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
      {groupByReturn ? (
        <div className="evidence-groups">
          {groupAllSupportedEvidenceByReturn(evidence).map(([returnType, returnEvidence]) => (
            <section
              className="evidence-group"
              key={returnType}
              aria-label={`${returnType} results`}
            >
              <h3>{returnType}</h3>
              <EvidenceList evidence={returnEvidence} />
            </section>
          ))}
        </div>
      ) : (
        <EvidenceList evidence={evidence} />
      )}
    </section>
  );
}

function EvidenceList({ evidence }: { evidence: readonly TargetEvidenceEntry[] }) {
  return (
    <ul className="evidence-list">
      {evidence.map((entry) => (
        <li className={`evidence-row evidence-${entry.outcome}`} key={evidenceKey(entry)}>
          <span className="evidence-glyph" aria-hidden="true">
            {OUTCOME_GLYPHS[entry.outcome]}
          </span>
          <span className="evidence-period">{entry.period}</span>
          <span className="evidence-outcome">{OUTCOME_LABELS[entry.outcome]}</span>
        </li>
      ))}
    </ul>
  );
}

function groupAllSupportedEvidenceByReturn(
  evidence: readonly TargetEvidenceEntry[],
): readonly [string, readonly TargetEvidenceEntry[]][] {
  const groups = new Map<string, TargetEvidenceEntry[]>();
  for (const entry of evidence) {
    const returnType = "returnType" in entry ? entry.returnType : "Selected return";
    groups.set(returnType, [...(groups.get(returnType) ?? []), entry]);
  }
  return [...groups.entries()];
}

function evidenceKey(entry: TargetEvidenceEntry): string {
  return "targetId" in entry ? entry.targetId : entry.period;
}
