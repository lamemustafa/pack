import { describe, expect, it } from "vitest";
import { concreteFiledReturnsArtifactTypesForSelection } from "../../src/connectors/gst/filed-returns-artifacts";

describe("filed return artifact selection", () => {
  it("defines GSTR-2B all formats as PDF, Excel, and JSON", () => {
    expect(concreteFiledReturnsArtifactTypesForSelection("GSTR-2B", "PDF_AND_EXCEL")).toEqual([
      "PDF",
      "EXCEL",
      "JSON",
    ]);
  });
});
