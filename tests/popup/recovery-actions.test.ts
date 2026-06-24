import { describe, expect, it } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import { canManuallyObserveFullFiscalYearTarget } from "../../src/entrypoints/popup/components";

describe("popup full-year recovery actions", () => {
  it("offers manual observation only for final-click recovery states", () => {
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("download-unconfirmed"))).toBe(true);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("blocked"))).toBe(false);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("failed"))).toBe(false);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("running"))).toBe(false);
  });
});

function summaryFor(
  targetStatus: NonNullable<FiledReturnsFlowSummary["fullFiscalYearRecovery"]>["targetStatus"],
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
      safeSignals: ["full-fiscal-year-run-needs-action"],
      safeMessage: "Needs action.",
    },
  };
}
