import { describe, expect, it } from "vitest";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  supportsFiledReturnsArtifactType,
} from "../../src/connectors/gst/filed-returns-artifacts";
import { filedReturnsOfferedArtifacts } from "../../src/connectors/gst/filed-returns-capabilities";

// "All formats" travels on the legacy wire value PDF_AND_EXCEL. Read literally
// it excluded GSTR-3B -- which offers PDF and portal data but no Excel -- and
// needed a hardcoded exception for GSTR-2B, whose "all" is three formats. It
// means every format the return offers, and the catalogue already knows that.
const RETURN_TYPES = ["GSTR-3B", "GSTR-1", "GSTR-2B"] as const;

describe("all-formats selection", () => {
  it.each(RETURN_TYPES)("%s offers all formats when it has more than one", (returnType) => {
    const offered = filedReturnsOfferedArtifacts(returnType);
    expect(offered.length).toBeGreaterThan(1);
    expect(supportsFiledReturnsArtifactType(returnType, "PDF_AND_EXCEL")).toBe(true);
  });

  it.each(RETURN_TYPES)("%s expands all formats to exactly what it offers", (returnType) => {
    expect(concreteFiledReturnsArtifactTypesForSelection(returnType, "PDF_AND_EXCEL")).toEqual(
      filedReturnsOfferedArtifacts(returnType),
    );
  });

  it("includes GSTR-3B's portal data, which the literal reading excluded", () => {
    const expanded = concreteFiledReturnsArtifactTypesForSelection("GSTR-3B", "PDF_AND_EXCEL");
    expect(expanded).toContain("PDF");
    expect(expanded).toContain("JSON");
    expect(expanded).not.toContain("EXCEL");
  });

  it("still expands GSTR-2B to three formats without a special case", () => {
    // Order now comes from the canonical concrete-type list rather than the
    // deleted exception's hand-written order.
    expect(concreteFiledReturnsArtifactTypesForSelection("GSTR-2B", "PDF_AND_EXCEL")).toEqual([
      "PDF",
      "EXCEL",
      "JSON",
    ]);
  });
});
