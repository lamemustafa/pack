import { describe, expect, it } from "vitest";
import {
  getFiledReturnsCompletionStatus,
  getFiledReturnsSummaryHeading,
} from "../../src/entrypoints/popup/flow-summary";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";

const COMPLETE_SUMMARY: FiledReturnsFlowSummary = {
  completedAt: "2026-06-20T16:30:00.000Z",
  totalPeriods: 12,
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
    safeSignals: ["full-fiscal-year-complete"],
    safeMessage: "Complete.",
  },
  scope: {
    financialYear: "2025-26",
    period: FULL_FISCAL_YEAR_PERIOD,
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
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBe("FY 2025-26 GSTR-3B complete. 12 of 12 periods reconciled.");
  });

  it("does not show stale completion for a different selected scope", () => {
    expect(
      getFiledReturnsCompletionStatus(
        {
          financialYear: "2024-25",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBeNull();
  });

  it("shows partial full fiscal year status without claiming completion", () => {
    expect(
      getFiledReturnsCompletionStatus(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        {
          ...COMPLETE_SUMMARY,
          status: "blocked",
          totalPeriods: 12,
          completedPeriods: ["April", "May"],
          currentPeriod: "June",
        },
      ),
    ).toBe("FY 2025-26 GSTR-3B blocked at June. 2 of 12 periods reconciled.");
  });

  it("uses reconciled language when completed periods may include manual or not-filed outcomes", () => {
    expect(
      getFiledReturnsCompletionStatus(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        {
          ...COMPLETE_SUMMARY,
          status: "complete",
          completedPeriods: ["April", "May"],
          totalPeriods: 2,
        },
      ),
    ).toBe("FY 2025-26 GSTR-3B complete. 2 of 2 periods reconciled.");
  });

  it("uses the persisted summary status in the popup heading for the selected scope", () => {
    expect(
      getFiledReturnsSummaryHeading(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBe("Last filed-returns run: complete");
    expect(
      getFiledReturnsSummaryHeading(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        { ...COMPLETE_SUMMARY, status: "blocked" },
      ),
    ).toBe("Last filed-returns run: blocked");
  });

  it("does not show stale summary details for a different selected scope", () => {
    expect(
      getFiledReturnsSummaryHeading(
        {
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBeNull();
  });
});
