import { describe, expect, it } from "vitest";
import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import { getScopeFormStartAction } from "../../src/entrypoints/popup/scope-form-model";

describe("popup scope form model", () => {
  it("keeps the full workbench start action available when portal context is inactive", () => {
    const action = getScopeFormStartAction(fullYearGstr2bScope(), null, null, true);

    expect(action).toEqual({
      disabled: false,
      label: "Download all 2025-26 GSTR-2B files",
    });
  });

  it("allows retrying a full-year run that only needs a GST portal tab", () => {
    const scope = fullYearGstr2bScope();
    const action = getScopeFormStartAction(
      scope,
      {
        scope,
        status: "blocked",
        completedPeriods: [],
        totalPeriods: 12,
        updatedAt: "2026-07-08T00:00:00.000Z",
        fullFiscalYearRecovery: {
          ledgerId: "ledger-portal-required",
          targetId: "GSTR-2B:2025-26:April",
          expectedRevision: 1,
          targetStatus: "blocked",
        },
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr2b-pdf-excel-private-v0",
          state: "login-required",
          safeSignals: ["full-fiscal-year-run-needs-action", "gst-portal-tab-required"],
          safeMessage:
            "Open a signed-in GST Portal return dashboard or return page, then click Start download again.",
        },
      } satisfies FiledReturnsFlowSummary,
      null,
      true,
    );

    expect(action).toEqual({
      disabled: false,
      label: "Download all 2025-26 GSTR-2B files",
    });
  });
});

function fullYearGstr2bScope(): FiledReturnsDownloadScope {
  return {
    artifactType: "PDF_AND_EXCEL",
    financialYear: "2025-26",
    period: FULL_FISCAL_YEAR_PERIOD,
    returnType: "GSTR-2B",
  };
}
