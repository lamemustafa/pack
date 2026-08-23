import { describe, expect, it } from "vitest";
import type {
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import { toFullFiscalYearSummary } from "../../src/background/filed-returns-full-fiscal-year-summary";

const FLOW_STEP: PortalFlowStepResult = {
  connectorId: "gst",
  scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
  state: "downloaded",
  safeMessage: "",
  safeSignals: [],
};

function ledgerWith(
  statuses: readonly FiledReturnsFullFiscalYearTargetStatus[],
): FiledReturnsFullFiscalYearLedger {
  const periods = ["April", "May", "June", "July"] as const;
  return {
    ledgerId: "full-fiscal-year-12345678",
    revision: 1,
    scope: {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "Full financial year",
      returnType: "GSTR-3B",
    },
    status: "partial",
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    targets: statuses.map((status, index) => ({
      targetId: `t${index}`,
      period: periods[index]!,
      status,
    })),
  } as FiledReturnsFullFiscalYearLedger;
}

describe("per-target evidence in the flow summary", () => {
  // Only `downloaded` asserts correlated download evidence. `not-filed` is a
  // true outcome and not a saved file, and a manual observation is a person's
  // report -- the ledger already refuses to count it toward completion, and the
  // evidence list must not undo that by calling it saved.
  it("maps only a downloaded target to saved", () => {
    const summary = toFullFiscalYearSummary(
      ledgerWith(["downloaded", "not-filed", "manually-observed", "download-unconfirmed"]),
      FLOW_STEP,
    );

    expect(summary.targetEvidence).toEqual([
      { period: "April", outcome: "saved" },
      { period: "May", outcome: "not-filed" },
      { period: "June", outcome: "needs-review" },
      { period: "July", outcome: "needs-review" },
    ]);
  });

  // `completedPeriods` groups downloaded with not-filed, which is right for
  // progress and wrong for evidence. Both are produced from one ledger, so this
  // pins that they disagree deliberately rather than by accident.
  it("keeps the evidence list narrower than completedPeriods", () => {
    const summary = toFullFiscalYearSummary(ledgerWith(["downloaded", "not-filed"]), FLOW_STEP);

    expect(summary.completedPeriods).toEqual(["April", "May"]);
    expect(summary.targetEvidence?.filter((entry) => entry.outcome === "saved")).toEqual([
      { period: "April", outcome: "saved" },
    ]);
  });

  it("reports work still in flight rather than settling it", () => {
    const summary = toFullFiscalYearSummary(ledgerWith(["running", "pending"]), FLOW_STEP);

    expect(summary.targetEvidence).toEqual([
      { period: "April", outcome: "running" },
      { period: "May", outcome: "pending" },
    ]);
  });
});
