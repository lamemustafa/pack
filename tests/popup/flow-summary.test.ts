import { describe, expect, it } from "vitest";
import { getFiledReturnsCompletionStatus } from "../../src/entrypoints/popup/flow-summary";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";

const COMPLETE_SUMMARY: FiledReturnsFlowSummary = {
  completedAt: "2026-06-20T16:30:00.000Z",
  completedPeriods: [
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "January",
    "February",
    "March",
  ],
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "downloaded",
    safeSignals: ["filed-return-financial-year-complete"],
    safeMessage: "Complete.",
  },
  scope: {
    financialYear: "2025-26",
    period: "ALL",
    returnType: "GSTR-3B",
  },
  status: "complete",
};

describe("popup filed returns flow summary", () => {
  it("shows a completion status for a matching full-year scope", () => {
    expect(
      getFiledReturnsCompletionStatus(
        {
          financialYear: "2025-26",
          period: "ALL",
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBe("FY 2025-26 GSTR-3B download complete. 12 periods finished.");
  });

  it("does not show stale completion for a different selected scope", () => {
    expect(
      getFiledReturnsCompletionStatus(
        {
          financialYear: "2024-25",
          period: "ALL",
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBeNull();
  });
});
