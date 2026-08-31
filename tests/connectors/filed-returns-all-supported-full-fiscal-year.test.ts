import { describe, expect, it, vi } from "vitest";
import {
  createAllSupportedFullFiscalYearRequest,
  expandAllSupportedFullFiscalYearTargetPlan,
  isAllSupportedFullFiscalYearRequest,
} from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { getFiledReturnsFinancialYearOptions } from "../../src/connectors/gst/filed-returns-scope";
import { isPackMessage } from "../../src/connectors/gst/messages";

describe("all-supported full-fiscal-year plan", () => {
  it("derives every-format selection from the offered artifacts, rather than the legacy name", () => {
    const offeredArtifacts = vi.fn(() => ["PDF", "JSON"] as const);

    const expansion = expandAllSupportedFullFiscalYearTargetPlan({
      catalogueEntries: [
        { returnType: "GSTR-3B", fullFiscalYear: true },
        { returnType: "GSTR-1", fullFiscalYear: false },
      ],
      offeredArtifacts,
    });

    expect(expansion).toEqual({
      ok: true,
      targets: [
        {
          returnType: "GSTR-3B",
          artifactType: "PDF_AND_EXCEL",
          concreteArtifactTypes: ["PDF", "JSON"],
        },
      ],
    });
    expect(offeredArtifacts).toHaveBeenCalledTimes(1);
    expect(offeredArtifacts).toHaveBeenCalledWith("GSTR-3B");
  });

  it("derives the target set from the supplied full-year catalogue rows", () => {
    const offeredArtifacts = vi.fn((returnType: string) =>
      returnType === "GSTR-1" ? (["PDF"] as const) : (["PDF", "EXCEL"] as const),
    );

    const expansion = expandAllSupportedFullFiscalYearTargetPlan({
      catalogueEntries: [
        { returnType: "GSTR-1", fullFiscalYear: true },
        { returnType: "GSTR-2B", fullFiscalYear: true },
        { returnType: "GSTR-3B", fullFiscalYear: false },
      ],
      offeredArtifacts,
    });

    expect(expansion).toEqual({
      ok: true,
      targets: [
        {
          returnType: "GSTR-1",
          artifactType: "PDF",
          concreteArtifactTypes: ["PDF"],
        },
        {
          returnType: "GSTR-2B",
          artifactType: "PDF_AND_EXCEL",
          concreteArtifactTypes: ["PDF", "EXCEL"],
        },
      ],
    });
    expect(offeredArtifacts).toHaveBeenCalledWith("GSTR-1");
    expect(offeredArtifacts).toHaveBeenCalledWith("GSTR-2B");
    expect(offeredArtifacts).not.toHaveBeenCalledWith("GSTR-3B");
  });

  it("fails closed when a listed full-year return has no offered artifact", () => {
    expect(
      expandAllSupportedFullFiscalYearTargetPlan({
        catalogueEntries: [{ returnType: "GSTR-2B", fullFiscalYear: true }],
        offeredArtifacts: () => [],
      }),
    ).toEqual({
      ok: false,
      reason: "return-has-no-offered-artifacts",
      returnType: "GSTR-2B",
    });
  });

  it("creates and validates only the narrow all-supported root request", () => {
    const request = createAllSupportedFullFiscalYearRequest("2025-26");

    expect(request).toEqual({
      kind: "all-supported-returns-full-fiscal-year",
      financialYear: "2025-26",
    });
    expect(isAllSupportedFullFiscalYearRequest(request)).toBe(true);
    expect(createAllSupportedFullFiscalYearRequest("2025/26")).toBeNull();
    expect(
      isAllSupportedFullFiscalYearRequest({
        ...request,
        returnType: "GSTR-3B",
      }),
    ).toBe(false);
  });

  it("rejects syntactically valid financial years outside the canonical supported range", () => {
    const supportedFinancialYear = getFiledReturnsFinancialYearOptions()[0]!;

    expect(createAllSupportedFullFiscalYearRequest(supportedFinancialYear)).toEqual({
      kind: "all-supported-returns-full-fiscal-year",
      financialYear: supportedFinancialYear,
    });
    expect(createAllSupportedFullFiscalYearRequest("2099-00")).toBeNull();
    expect(
      isAllSupportedFullFiscalYearRequest({
        kind: "all-supported-returns-full-fiscal-year",
        financialYear: "2099-00",
      }),
    ).toBe(false);
  });

  it("accepts the root protocol message and rejects widened or malformed payloads", () => {
    expect(
      isPackMessage({
        type: "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
        payload: {
          kind: "all-supported-returns-full-fiscal-year",
          financialYear: "2025-26",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
        payload: {
          kind: "all-supported-returns-full-fiscal-year",
          financialYear: "2025-26",
          returnType: "GSTR-3B",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
        payload: {
          kind: "single-return",
          financialYear: "2025-26",
        },
      }),
    ).toBe(false);
    expect(
      isPackMessage({
        type: "PACK_RESTART_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
        payload: {
          kind: "all-supported-returns-full-fiscal-year",
          financialYear: "2025-26",
        },
      }),
    ).toBe(true);
    expect(
      isPackMessage({
        type: "PACK_RESTART_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW",
        payload: {
          kind: "all-supported-returns-full-fiscal-year",
          financialYear: "2025-26",
          ledgerId: "must-not-come-from-the-panel",
        },
      }),
    ).toBe(false);
  });
});
