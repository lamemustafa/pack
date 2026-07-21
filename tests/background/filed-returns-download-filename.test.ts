import { describe, expect, it } from "vitest";
import {
  safeFiledReturnDownloadFilename,
  safeFiledReturnZipEntryPath,
  safeFullFiscalYearZipFilename,
  safeSinglePeriodReceiptFilename,
} from "../../src/background/filed-returns-download-filename";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";

describe("filed returns download filename helpers", () => {
  const scope: FiledReturnsDownloadScope = {
    artifactType: "EXCEL",
    financialYear: "2026-27",
    period: "May",
    returnType: "GSTR-2B",
  };

  it("uses the captured artifact extension for legacy GSTR-2B Excel bytes", () => {
    expect(safeFiledReturnZipEntryPath(scope, "EXCEL", ".xls")).toBe("may.xls");
    expect(safeFiledReturnDownloadFilename(scope, "EXCEL", ".xls")).toBe(
      "complyeaze-pack/gst/2026-27/gstr-2b/may.xls",
    );
  });

  it("uses an opaque archive code and deterministic folders for multi-period ZIPs", () => {
    expect(
      safeFullFiscalYearZipFilename(
        {
          financialYear: "2025-26",
          period: "October",
          rangeEndPeriod: "January",
          returnType: "GSTR-1",
        },
        "7a8b9c0d-1234-5678-90ab-cdef12345678",
      ),
    ).toBe("ComplyEaze-Pack/Archive-7A8B9C0D1234/FY-2025-26/GSTR-1/october-to-january.zip");
  });

  it("uses only selected scope fields for an optional local receipt filename", () => {
    expect(safeSinglePeriodReceiptFilename(scope)).toBe(
      "ComplyEaze-Pack/Receipts/gstr-2b-2026-27-may-receipt.json",
    );
  });
});
