import { describe, expect, it } from "vitest";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  filedReturnsArtifactLabel,
} from "../../src/connectors/gst/filed-returns-artifacts";

describe("filed return artifact selection", () => {
  it("defines GSTR-2B all formats as PDF, Excel, and JSON", () => {
    expect(concreteFiledReturnsArtifactTypesForSelection("GSTR-2B", "PDF_AND_EXCEL")).toEqual([
      "PDF",
      "EXCEL",
      "JSON",
    ]);
  });

  it("derives artifact labels from the return catalogue", () => {
    expect(filedReturnsArtifactLabel("PDF_AND_EXCEL", "GSTR-3B")).toBe("All formats");
    expect(filedReturnsArtifactLabel("PDF", "GSTR-1")).toBe("Summary (PDF)");
  });
});
