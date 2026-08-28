import { describe, expect, it } from "vitest";
import {
  safeFiledReturnDownloadFilename,
  safeFiledReturnZipEntryPath,
  safeFullFiscalYearZipFilename,
  safeSinglePeriodZipFilename,
} from "../../src/background/filed-returns-download-filename";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";

describe("filed returns download filename helpers", () => {
  const scope: FiledReturnsDownloadScope = {
    artifactType: "EXCEL",
    financialYear: "2026-27",
    period: "May",
    returnType: "GSTR-2B",
  };

  it("uses the captured artifact extension for legacy GSTR-2B Excel bytes", () => {
    expect(safeFiledReturnZipEntryPath(scope, "EXCEL", ".xls")).toBe("may-details.xls");
    expect(safeFiledReturnDownloadFilename(scope, "EXCEL", ".xls")).toBe(
      "complyeaze-pack/gst/2026-27/gstr-2b/may.xls",
    );
  });

  it("derives a bundled GSTR-3B download fallback from its offered formats", () => {
    expect(
      safeFiledReturnDownloadFilename({
        ...scope,
        artifactType: "PDF_AND_EXCEL",
        returnType: "GSTR-3B",
      }),
    ).toBe("complyeaze-pack/gst/2026-27/gstr-3b/may.pdf");
  });

  it("names a selected-artifact archive under the requested return type", () => {
    expect(safeSinglePeriodZipFilename({ ...scope, artifactType: "PDF_AND_EXCEL" })).toBe(
      "ComplyEaze-Pack/2026-27/GSTR-2B/May.zip",
    );
  });

  it("names a fiscal-year archive alongside selected-period archives", () => {
    expect(safeFullFiscalYearZipFilename({ ...scope, period: "Full year" })).toBe(
      "ComplyEaze-Pack/2026-27/GSTR-2B/full-year.zip",
    );
  });
});
