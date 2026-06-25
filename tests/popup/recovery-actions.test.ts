import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import {
  canManuallyObserveFullFiscalYearTarget,
  RecoveryActions,
} from "../../src/entrypoints/popup/components";

describe("popup full-year recovery actions", () => {
  it("offers manual observation only for final-click recovery states", () => {
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("download-unconfirmed"))).toBe(true);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("blocked"))).toBe(false);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("failed"))).toBe(false);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("running"))).toBe(false);
  });

  it("renders resume and discard immediately for a pending saved full-year run", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        summary: summaryFor("pending", "full-fiscal-year-resume-confirmation-required"),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Resume saved run");
    expect(markup).toContain("Discard saved run");
  });

  it("shows the same-account warning on every full-year recovery path", () => {
    for (const targetStatus of ["blocked", "failed", "cancelled"] as const) {
      const markup = renderToStaticMarkup(
        createElement(RecoveryActions, {
          busy: null,
          summary: summaryFor(targetStatus),
          onAcknowledgeInterruptedRun: () => undefined,
          onRetryFullFiscalYearTarget: () => undefined,
          onRetryTarget: () => undefined,
          onResolveFullFiscalYearTarget: () => undefined,
          onResolveTarget: () => undefined,
        }),
      );

      expect(markup).toContain(
        "This saved run is not bound to a GST account. Continue only if the same GST account is currently open.",
      );
    }
  });

  it("offers discard saved full-year run for non-complete recovery targets", () => {
    for (const targetStatus of ["blocked", "failed", "cancelled"] as const) {
      const markup = renderToStaticMarkup(
        createElement(RecoveryActions, {
          busy: null,
          summary: summaryFor(targetStatus),
          onAcknowledgeInterruptedRun: () => undefined,
          onRetryFullFiscalYearTarget: () => undefined,
          onRetryTarget: () => undefined,
          onResolveFullFiscalYearTarget: () => undefined,
          onResolveTarget: () => undefined,
        }),
      );

      expect(markup).toContain("Discard saved full-year run");
    }
  });
});

function summaryFor(
  targetStatus: NonNullable<FiledReturnsFlowSummary["fullFiscalYearRecovery"]>["targetStatus"],
  signal = "full-fiscal-year-run-needs-action",
): FiledReturnsFlowSummary {
  return {
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    status: "blocked",
    completedPeriods: [],
    totalPeriods: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    fullFiscalYearRecovery: {
      ledgerId: "ledger-existing",
      targetId: "GSTR-3B:2026-27:April",
      expectedRevision: 2,
      targetStatus,
    },
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "user-action-required",
      safeSignals: [signal],
      safeMessage: "Needs action.",
    },
  };
}
