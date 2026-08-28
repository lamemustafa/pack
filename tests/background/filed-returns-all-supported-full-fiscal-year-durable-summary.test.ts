import { describe, expect, it } from "vitest";
import {
  parseDurableAllSupportedFullFiscalYearFlowSummary,
  parseDurableFiledReturnsFlowSummary,
} from "../../src/background/filed-returns-durable-summary";

describe("all-supported full-fiscal-year durable summary", () => {
  it("retains the discriminated root while dropping taxpayer outcome evidence", () => {
    const parsed = parseDurableAllSupportedFullFiscalYearFlowSummary(completeSummary());

    expect(parsed).toMatchObject({
      summaryIdentity: {
        kind: "all-supported-returns-full-fiscal-year",
        financialYear: "2025-26",
      },
      status: "complete",
      totalTargets: 2,
    });
    expect(parsed).not.toHaveProperty("targetEvidence");
    expect(parsed).not.toHaveProperty("completedTargetIds");
    expect(JSON.stringify(parsed)).not.toContain("not-filed");
  });

  it("keeps the atomic parser separate so it cannot misread all-returns evidence", () => {
    expect(parseDurableFiledReturnsFlowSummary(completeSummary())).toBeNull();
  });

  it("rejects period-only evidence before it can conflate return types", () => {
    const summary = completeSummary();
    const evidence = summary.targetEvidence.map((target) => ({ ...target }));
    delete (evidence[0] as Record<string, unknown>).returnType;

    expect(
      parseDurableAllSupportedFullFiscalYearFlowSummary({
        ...summary,
        targetEvidence: evidence,
      }),
    ).toBeNull();
  });

  it("rejects duplicate return-period-artifact identities even with distinct target IDs", () => {
    const summary = completeSummary();
    const evidence = summary.targetEvidence.map((target) => ({ ...target }));
    evidence[1] = { ...evidence[0]!, targetId: "target-distinct-but-ambiguous" };

    expect(
      parseDurableAllSupportedFullFiscalYearFlowSummary({
        ...summary,
        completedTargetIds: ["target-gstr1-april", "target-distinct-but-ambiguous"],
        targetEvidence: evidence,
      }),
    ).toBeNull();
  });

  it("rejects a completion that carries unresolved evidence", () => {
    const summary = completeSummary();
    const evidence = summary.targetEvidence.map((target) => ({ ...target }));
    evidence[1] = { ...evidence[1]!, outcome: "needs-review" };

    expect(
      parseDurableAllSupportedFullFiscalYearFlowSummary({
        ...summary,
        targetEvidence: evidence,
      }),
    ).toBeNull();
  });
});

function completeSummary() {
  return {
    summaryIdentity: {
      kind: "all-supported-returns-full-fiscal-year",
      financialYear: "2025-26",
    },
    status: "complete",
    completedAt: "2026-08-27T00:00:00.000Z",
    completedTargetIds: ["target-gstr1-april", "target-gstr3b-april"],
    targetEvidence: [
      {
        targetId: "target-gstr1-april",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-1",
        artifactType: "PDF",
        outcome: "saved",
      },
      {
        targetId: "target-gstr3b-april",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-3B",
        artifactType: "PDF",
        outcome: "not-filed",
      },
    ],
    totalTargets: 2,
    flowStepScope: {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
      artifactType: "PDF",
    },
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-complete"],
      safeMessage: "Synthetic safe message.",
    },
  };
}
