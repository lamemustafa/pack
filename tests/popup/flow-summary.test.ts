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
    ).toBe("FY 2025-26 GSTR-3B complete. 12 of 12 periods downloaded.");
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
    ).toBe("FY 2025-26 GSTR-3B blocked at June. 2 of 12 periods downloaded.");
  });

  it("uses the persisted summary status in the popup heading", () => {
    expect(getFiledReturnsSummaryHeading(COMPLETE_SUMMARY)).toBe(
      "Last filed-returns run: complete",
    );
    expect(getFiledReturnsSummaryHeading({ ...COMPLETE_SUMMARY, status: "blocked" })).toBe(
      "Last filed-returns run: blocked",
    );
  });
});
