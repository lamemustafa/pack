import { describe, expect, it } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import {
  createScopeFormModel,
  getScopeActionCopy,
  getScopeFormStartAction,
} from "../../src/entrypoints/popup/scope-form-model";

describe("popup scope form model", () => {
  it("names a single GSTR-1 Excel action truthfully", () => {
    const action = getScopeFormStartAction(
      {
        artifactType: "EXCEL",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-1",
      },
      null,
      null,
      false,
    );

    expect(action).toEqual({
      disabled: false,
      label: "Download June 2026-27 E-invoice details (Excel)",
    });
  });

  it("uses the consistent GSTR-3B format labels", () => {
    const model = createScopeFormModel({
      artifactType: "JSON",
      financialYear: "2024-25",
      period: "April",
      returnType: "GSTR-3B",
    });
    expect(model.artifactOptions).toContainEqual({
      value: "JSON",
      label: "Portal data (JSON)",
      description: "Saved verbatim from the portal; not a filed return",
    });
    expect(
      getScopeFormStartAction(
        { artifactType: "JSON", financialYear: "2024-25", period: "April", returnType: "GSTR-3B" },
        null,
        null,
        false,
      ),
    ).toEqual({ disabled: false, label: "Download April 2024-25 GSTR-3B portal data (JSON)" });
  });

  it("labels GSTR-2B multi-artifact selection without promising a ZIP", () => {
    const scope = {
      artifactType: "PDF_AND_EXCEL" as const,
      financialYear: "2026-27",
      period: "June" as const,
      returnType: "GSTR-2B" as const,
    };
    const model = createScopeFormModel(scope);

    expect(model.artifactOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "PDF", label: "Summary (PDF)" }),
        expect.objectContaining({ value: "EXCEL", label: "Details (Excel)" }),
        expect.objectContaining({ value: "JSON", label: "Portal data (JSON)" }),
        expect.objectContaining({ value: "PDF_AND_EXCEL", label: "All formats" }),
      ]),
    );
    expect(getScopeFormStartAction(scope, null, null, false)).toEqual({
      disabled: false,
      label: "Download June 2026-27 GSTR-2B all formats",
    });
  });

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

  it("labels a retained final ZIP as a portal-independent retry", () => {
    const scope = fullYearGstr2bScope();
    const action = getScopeFormStartAction(
      scope,
      {
        scope,
        status: "blocked",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr2b-pdf-excel-private-v0",
          state: "blocked",
          safeSignals: ["full-fiscal-year-final-zip-retry", "full-fiscal-year-opfs-retained"],
          safeMessage: "Retry local cleanup.",
        },
      },
      null,
      true,
    );

    expect(action).toEqual({ disabled: false, label: "Retry final ZIP" });
  });

  it("requires an explicit Downloads check before retrying an ambiguous final ZIP", () => {
    const scope = fullYearGstr2bScope();
    const action = getScopeFormStartAction(
      scope,
      {
        scope,
        status: "blocked",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr2b-pdf-excel-private-v0",
          state: "download-unconfirmed",
          safeSignals: [
            "full-fiscal-year-final-zip-retry",
            "full-fiscal-year-zip-download-unconfirmed",
            "full-fiscal-year-zip-phase:download-started",
            "full-fiscal-year-opfs-retained",
          ],
          safeMessage:
            "Pack started the final fiscal-year ZIP download. Check browser Downloads before retrying it.",
        },
      },
      null,
      true,
    );

    expect(action).toEqual({ disabled: false, label: "I checked—retry final ZIP" });
  });

  it("reconciles a persisted final-ZIP download ID before offering another download", () => {
    const scope = fullYearGstr2bScope();
    const action = getScopeFormStartAction(
      scope,
      {
        scope,
        status: "blocked",
        completedPeriods: ["April", "May"],
        totalPeriods: 2,
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr2b-pdf-excel-private-v0",
          state: "download-unconfirmed",
          safeSignals: [
            "full-fiscal-year-final-zip-manual-review",
            "full-fiscal-year-zip-download-unconfirmed",
            "full-fiscal-year-zip-phase:download-observing",
            "full-fiscal-year-opfs-retained",
          ],
          safeMessage: "Check the exact saved browser download ID.",
        },
      },
      null,
      true,
    );

    expect(action).toEqual({ disabled: false, label: "Check final ZIP status" });
  });

  // A run note is a claim about what the run will fetch. Keyed on the return type alone it
  // survives an artifact choice that makes it false, and nothing else in this suite reads
  // either string — which is why the overstatement went unnoticed.
  const EXCEL_WHEN_OFFERED = "Includes Excel only when the portal provides it";
  const PORTAL_GENERATED_ONLY = "Captures only portal-generated PDF and Excel controls";

  it("does not promise GSTR-1 Excel on a full-year run that only fetches the PDF", () => {
    const pdfOnly = getScopeActionCopy(
      {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-1",
      },
      true,
    );
    const withExcel = getScopeActionCopy(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-1",
      },
      true,
    );

    expect(pdfOnly.details).not.toContain(EXCEL_WHEN_OFFERED);
    expect(withExcel.details).toContain(EXCEL_WHEN_OFFERED);
  });

  it("does not claim a GSTR-2B PDF and Excel scope on a portal-data-only full-year run", () => {
    const jsonOnly = getScopeActionCopy(
      {
        artifactType: "JSON",
        financialYear: "2025-26",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-2B",
      },
      true,
    );

    expect(jsonOnly.details).not.toContain(PORTAL_GENERATED_ONLY);
    expect(getScopeActionCopy(fullYearGstr2bScope(), true).details).toContain(
      PORTAL_GENERATED_ONLY,
    );
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
