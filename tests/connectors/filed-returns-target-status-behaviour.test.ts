import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_FULL_FISCAL_YEAR_TARGET_STATUSES,
  filedReturnsTargetStatusBehaviour,
  holdsFullFiscalYearTargetAnswer,
  isResolvedFullFiscalYearTargetStatus,
  needsExplicitFullFiscalYearRetry,
  statesFullFiscalYearTargetAbsence,
} from "../../src/connectors/gst/filed-returns-contracts";

// What a status means was previously asked as literal comparisons in twenty-two modules, and
// nothing connected them: `not-generated` joined the union and five separate sites went on
// spelling the question `=== "not-filed"`. These are the invariants that make the table a single
// answer rather than a sixth copy of one.
describe("what a target status means", () => {
  const statuses = FILED_RETURNS_FULL_FISCAL_YEAR_TARGET_STATUSES;

  it("answers every question for every member", () => {
    for (const status of statuses) {
      const behaviour = filedReturnsTargetStatusBehaviour(status);
      expect(behaviour, status).toBeDefined();
      expect(Object.keys(behaviour).sort()).toEqual([
        "active",
        "holdsAnswer",
        "producedFile",
        "requiredEvidenceSignal",
        "resolved",
        "statedAbsence",
      ]);
    }
  });

  it.each(statuses)("puts %s in exactly one of active, resolved, or needs-a-decision", (status) => {
    const behaviour = filedReturnsTargetStatusBehaviour(status);
    const buckets = [
      behaviour.active,
      behaviour.resolved,
      needsExplicitFullFiscalYearRetry(status),
    ].filter(Boolean);
    expect(buckets).toHaveLength(1);
  });

  it.each(statuses)("keeps %s consistent across the narrower questions", (status) => {
    const behaviour = filedReturnsTargetStatusBehaviour(status);
    // A stated absence is an answer from the portal, so it resolves the target.
    if (behaviour.statedAbsence) expect(isResolvedFullFiscalYearTargetStatus(status)).toBe(true);
    // A staged file is an answer too.
    if (behaviour.producedFile) expect(isResolvedFullFiscalYearTargetStatus(status)).toBe(true);
    // Anything resolved is an answer worth keeping; the reverse does not hold -- a manually
    // observed target was answered by a person, which is work a run must not overwrite either.
    if (behaviour.resolved) expect(holdsFullFiscalYearTargetAnswer(status)).toBe(true);
    // An absence stages nothing, which is why restaging must leave it alone.
    if (behaviour.statedAbsence) expect(behaviour.producedFile).toBe(false);
  });

  it("treats both stated absences alike, and nothing else as one", () => {
    const absences = statuses.filter((status) => statesFullFiscalYearTargetAbsence(status));
    // Distinct to a reader -- one is a claim about the taxpayer, the other about the portal -- and
    // the same answer to "is there a file to expect?". Every site that asked the second question
    // by naming only `not-filed` was wrong.
    expect([...absences].sort()).toEqual(["not-filed", "not-generated"]);
  });

  it("requires corroborating evidence for every claim that can be asserted without it", () => {
    // `downloaded` is absent deliberately: its evidence is a richer predicate than a signal name.
    const requiring = statuses
      .filter((status) => filedReturnsTargetStatusBehaviour(status).requiredEvidenceSignal)
      .sort();
    expect(requiring).toEqual(["not-filed", "not-generated"]);
  });
});
