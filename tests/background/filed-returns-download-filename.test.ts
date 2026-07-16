import { describe, expect, it } from "vitest";
import {
  safeFiledReturnDownloadFilename,
  safeFiledReturnZipEntryPath,
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
});
