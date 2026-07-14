import { describe, expect, it } from "vitest";
import {
  canRetryFullFiscalYearZipWithoutPortal,
  getFiledReturnsCompletionStatus,
  getScopeMatchedFiledReturnsSummary,
  getFiledReturnsSummaryHeading,
  hasUnresolvedFiledReturnsRecovery,
  hasUnresolvedFiledReturnsTargetReview,
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

  it("asks for final zip confirmation when all periods reconciled but browser save is unconfirmed", () => {
    expect(
      getFiledReturnsCompletionStatus(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
          artifactType: "PDF_AND_EXCEL",
        },
        {
          ...COMPLETE_SUMMARY,
          flowStep: {
            ...COMPLETE_SUMMARY.flowStep,
            state: "download-unconfirmed",
            safeSignals: ["full-fiscal-year-zip-download-unconfirmed"],
          },
          scope: {
            financialYear: "2025-26",
            period: FULL_FISCAL_YEAR_PERIOD,
            returnType: "GSTR-2B",
            artifactType: "PDF_AND_EXCEL",
          },
          status: "blocked",
        },
      ),
    ).toBe("FY 2025-26 GSTR-2B prepared. 12 of 12 periods reconciled; retry the final ZIP save.");
  });

  it("shows reset full-year runs as ready for a fresh local run", () => {
    expect(
      getFiledReturnsCompletionStatus(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
          artifactType: "PDF_AND_EXCEL",
        },
        {
          ...COMPLETE_SUMMARY,
          completedPeriods: [],
          currentPeriod: "April",
          scope: {
            financialYear: "2025-26",
            period: FULL_FISCAL_YEAR_PERIOD,
            returnType: "GSTR-2B",
            artifactType: "PDF_AND_EXCEL",
          },
          status: "cancelled",
          totalPeriods: 12,
        },
      ),
    ).toBe(
      "Saved FY 2025-26 GSTR-2B run cleared. Start a fresh local run when the GST Portal is ready.",
    );
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
    expect(
      getFiledReturnsSummaryHeading(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        { ...COMPLETE_SUMMARY, status: "cancelled" },
      ),
    ).toBe("Ready for a new filed-returns run");
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

  it("filters stale summaries before rendering recovery actions", () => {
    expect(
      getScopeMatchedFiledReturnsSummary(
        {
          financialYear: "2025-26",
          period: "May",
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBeNull();
    expect(
      getScopeMatchedFiledReturnsSummary(
        {
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-3B",
        },
        COMPLETE_SUMMARY,
      ),
    ).toBe(COMPLETE_SUMMARY);
  });

  it("identifies an unresolved target review that must keep ownership of the scope", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...COMPLETE_SUMMARY,
      currentPeriod: "April",
      status: "blocked",
      flowStep: {
        ...COMPLETE_SUMMARY.flowStep,
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-target-review-required"],
      },
    };

    expect(hasUnresolvedFiledReturnsTargetReview(targetReviewSummary)).toBe(true);
    expect(hasUnresolvedFiledReturnsTargetReview(COMPLETE_SUMMARY)).toBe(false);
    expect(
      hasUnresolvedFiledReturnsTargetReview({ ...targetReviewSummary, status: "cancelled" }),
    ).toBe(false);
  });

  it("keeps a blocked full-year recovery bound to its saved scope", () => {
    const summary: FiledReturnsFlowSummary = {
      ...COMPLETE_SUMMARY,
      status: "blocked",
      fullFiscalYearRecovery: {
        ledgerId: "ledger-safe",
        targetId: "target-safe",
        expectedRevision: 2,
        targetStatus: "blocked",
      },
    };

    expect(hasUnresolvedFiledReturnsRecovery(summary)).toBe(true);
    expect(hasUnresolvedFiledReturnsRecovery(COMPLETE_SUMMARY)).toBe(false);
  });

  it("allows only retained final-ZIP work to retry without a portal tab", () => {
    const finalZipRetry: FiledReturnsFlowSummary = {
      ...COMPLETE_SUMMARY,
      status: "blocked",
      flowStep: {
        ...COMPLETE_SUMMARY.flowStep,
        state: "blocked",
        safeSignals: [
          "full-fiscal-year-final-zip-retry",
          "full-fiscal-year-zip-cleanup-pending",
          "full-fiscal-year-opfs-retained",
        ],
      },
    };

    expect(canRetryFullFiscalYearZipWithoutPortal(finalZipRetry)).toBe(true);
    expect(
      canRetryFullFiscalYearZipWithoutPortal({
        ...finalZipRetry,
        flowStep: {
          ...finalZipRetry.flowStep,
          safeSignals: [
            "full-fiscal-year-zip-artifact-staging-incomplete",
            "full-fiscal-year-opfs-retained",
          ],
        },
      }),
    ).toBe(false);
    expect(canRetryFullFiscalYearZipWithoutPortal(COMPLETE_SUMMARY)).toBe(false);
  });
});
