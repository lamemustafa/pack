import { describe, expect, it } from "vitest";
import {
  canRetryFiledReturnsTargetWithoutPortal,
  canRetryFullFiscalYearZipWithoutPortal,
  getScopeMatchedFiledReturnsSummary,
  hasConfirmedSinglePeriodBrowserDownload,
  hasUnresolvedFiledReturnsRecovery,
  hasUnresolvedFiledReturnsTargetReview,
} from "../../src/entrypoints/popup/flow-summary";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";

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

  it("accepts only exact, non-empty diagnostic evidence for every selected artifact", () => {
    const summary: FiledReturnsFlowSummary = {
      ...COMPLETE_SUMMARY,
      completedPeriods: ["May"],
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1",
      },
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "downloaded",
        safeMessage: "Complete.",
        safeSignals: [],
        downloadDiagnostics: [diagnostic("PDF", 7), diagnostic("EXCEL", 8)],
      },
    };

    expect(hasConfirmedSinglePeriodBrowserDownload(summary)).toBe(true);
    expect(
      hasConfirmedSinglePeriodBrowserDownload({
        ...summary,
        flowStep: { ...summary.flowStep, downloadDiagnostics: [diagnostic("PDF", 7)] },
      }),
    ).toBe(false);
    expect(
      hasConfirmedSinglePeriodBrowserDownload({
        ...summary,
        flowStep: {
          ...summary.flowStep,
          downloadDiagnostics: [
            diagnostic("PDF", 7),
            { ...diagnostic("EXCEL", 8), downloadId: -1 },
          ],
        },
      }),
    ).toBe(false);
    expect(
      hasConfirmedSinglePeriodBrowserDownload({
        ...summary,
        flowStep: {
          ...summary.flowStep,
          downloadDiagnostics: [
            diagnostic("PDF", 7),
            { ...diagnostic("EXCEL", 8), period: "April" },
          ],
        },
      }),
    ).toBe(false);
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
    expect(hasUnresolvedFiledReturnsRecovery({ ...summary, status: "partial" })).toBe(true);
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
          state: "download-unconfirmed",
          safeSignals: [
            "full-fiscal-year-final-zip-retry",
            "full-fiscal-year-zip-download-started",
            "full-fiscal-year-zip-download-unconfirmed",
            "full-fiscal-year-zip-phase:download-started",
            "full-fiscal-year-opfs-retained",
          ],
        },
      }),
    ).toBe(true);
    expect(
      canRetryFullFiscalYearZipWithoutPortal({
        ...finalZipRetry,
        flowStep: {
          ...finalZipRetry.flowStep,
          state: "download-unconfirmed",
          safeSignals: [
            "full-fiscal-year-zip-phase:download-started",
            "full-fiscal-year-opfs-retained",
          ],
        },
      }),
    ).toBe(true);
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
    expect(
      canRetryFullFiscalYearZipWithoutPortal({
        ...finalZipRetry,
        flowStep: {
          ...finalZipRetry.flowStep,
          safeSignals: [
            "full-fiscal-year-zip-entry-count-mismatch",
            "full-fiscal-year-opfs-retained",
          ],
        },
      }),
    ).toBe(false);
    expect(canRetryFullFiscalYearZipWithoutPortal(COMPLETE_SUMMARY)).toBe(false);
  });

  it("allows only the local target-review retries (reconcile, local cleanup) without a portal tab", () => {
    const targetReviewBase: FiledReturnsFlowSummary = {
      scope: { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" },
      status: "blocked",
      completedPeriods: [],
      totalPeriods: 1,
      currentPeriod: "May",
      updatedAt: "2026-06-24T00:00:00.000Z",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-target-review-required"],
        safeMessage: "Pack could not confirm the browser download for May.",
      },
    };

    const reconcileSummary: FiledReturnsFlowSummary = {
      ...targetReviewBase,
      flowStep: {
        ...targetReviewBase.flowStep,
        safeSignals: [
          "filed-returns-target-review-required",
          "artifact-acquisition-download-unreconciled",
        ],
      },
    };
    expect(canRetryFiledReturnsTargetWithoutPortal(reconcileSummary)).toBe(true);

    const cleanupSummary: FiledReturnsFlowSummary = {
      ...targetReviewBase,
      flowStep: {
        ...targetReviewBase.flowStep,
        safeSignals: [
          "filed-returns-target-review-required",
          "filed-returns-target-local-cleanup-required",
        ],
      },
    };
    expect(canRetryFiledReturnsTargetWithoutPortal(cleanupSummary)).toBe(true);

    // Neither reconcile nor local cleanup applies: the only remaining action is starting
    // fresh, which does reach the portal.
    expect(canRetryFiledReturnsTargetWithoutPortal(targetReviewBase)).toBe(false);
    expect(canRetryFiledReturnsTargetWithoutPortal(null)).toBe(false);
    expect(canRetryFiledReturnsTargetWithoutPortal(undefined)).toBe(false);
  });
});

function diagnostic(artifactType: "PDF" | "EXCEL", downloadId: number) {
  return {
    actionId: `action-${artifactType}`,
    artifactType,
    byteCountClass: "non-empty" as const,
    downloadId,
    downloadPathClass: "captured-portal-request-unknown" as const,
    endpointClass:
      artifactType === "PDF"
        ? ("gstr1-pdf-portal-blob-captured-download" as const)
        : ("gstr1-excel-portal-blob-captured-download" as const),
    eventType: "filed-return-download-path" as const,
    financialYear: "2025-26",
    mimeClass: artifactType === "PDF" ? ("pdf" as const) : ("spreadsheet" as const),
    period: "May",
    returnType: "GSTR-1" as const,
    schemaVersion: "1.0" as const,
    status: "downloaded" as const,
  };
}
