import { describe, expect, it } from "vitest";
import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import {
  createScopeFormModel,
  getScopeDestinationPreview,
  getScopeFormStartAction,
} from "../../src/entrypoints/popup/scope-form-model";

describe("popup scope form model", () => {
  it("does not expose pre-availability GSTR-2B years or months in the planner", () => {
    const model = createScopeFormModel({
      artifactType: "PDF",
      financialYear: "2020-21",
      period: "July",
      returnType: "GSTR-2B",
    });

    expect(model.financialYearOptions.at(-1)?.value).toBe("2020-21");
    expect(model.singlePeriodOptions[0]?.value).toBe("July");
    expect(model.singlePeriodOptions.some((option) => option.value === "April")).toBe(false);
  });

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
      label: "Download June 2026-27 GSTR-1 Excel",
    });
  });

  it("names an immutable custom range as one ZIP action", () => {
    const action = getScopeFormStartAction(
      {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "October",
        rangeEndPeriod: "January",
        returnType: "GSTR-1",
      },
      null,
      null,
      false,
    );

    expect(action).toEqual({
      disabled: false,
      label: "Download October–January 2025-26 GSTR-1 ZIP",
    });
  });

  it("keeps a custom range start picker bounded so an end period always remains", () => {
    const model = createScopeFormModel({
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "October",
      rangeEndPeriod: "January",
      returnType: "GSTR-1",
    });

    expect(model.rangeStartOptions.at(-1)?.value).toBe("February");
    expect(model.rangeStartOptions.some((option) => option.value === "March")).toBe(false);
  });

  it("previews the exact relative path requested for one artifact", () => {
    expect(
      getScopeDestinationPreview({
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "June",
        returnType: "GSTR-3B",
      }),
    ).toEqual({
      label: "Requested relative path",
      value: "complyeaze-pack/gst/2026-27/gstr-3b/june.pdf",
      detail: "Chrome's configured download location controls the final folder.",
    });
  });

  it("previews a generated local archive code without inventing the final code", () => {
    expect(
      getScopeDestinationPreview({
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2025-26",
        period: "October",
        rangeEndPeriod: "January",
        returnType: "GSTR-1",
      }),
    ).toEqual({
      label: "Requested relative path",
      value: "ComplyEaze-Pack/Archive-<local-code>/FY-2025-26/GSTR-1/october-to-january.zip",
      detail:
        "Pack creates the local archive code when the run starts; Chrome's configured download location controls the final folder.",
    });
  });

  it("keeps the full workbench start action available when portal context is inactive", () => {
    const action = getScopeFormStartAction(fullYearGstr2bScope(), null, null, true);

    expect(action).toEqual({
      disabled: true,
      label: "Full fiscal year temporarily paused",
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
      disabled: true,
      label: "Full fiscal year temporarily paused",
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

    expect(action).toEqual({ disabled: true, label: "Full fiscal year temporarily paused" });
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
