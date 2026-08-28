import { describe, expect, it } from "vitest";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";
import {
  MAX_SELECTED_FILED_RETURNS_TARGETS,
  createSelectedFiledReturnsTargetsRequest,
  isSelectedFiledReturnsTargetsRequest,
} from "../../src/connectors/gst/filed-returns-selected-target-plan";

describe("selected filed-returns target plan", () => {
  it("canonicalises a multi-return matrix selection without widening an atomic scope", () => {
    expect(
      createSelectedFiledReturnsTargetsRequest("2025-26", [
        { returnType: "GSTR-3B", period: "May", artifactType: "PDF" },
        { returnType: "GSTR-1", period: "April", artifactType: "PDF_AND_EXCEL" },
        { returnType: "GSTR-3B", period: "April", artifactType: "PDF" },
      ]),
    ).toEqual({
      kind: "selected-filed-returns-targets",
      financialYear: "2025-26",
      targets: [
        { returnType: "GSTR-1", period: "April", artifactType: "PDF_AND_EXCEL" },
        { returnType: "GSTR-3B", period: "April", artifactType: "PDF" },
        { returnType: "GSTR-3B", period: "May", artifactType: "PDF" },
      ],
    });
  });

  it("rejects empty, duplicate, unavailable, malformed, and noncanonical saved selections", () => {
    expect(createSelectedFiledReturnsTargetsRequest("2025-26", [])).toBeNull();
    expect(
      createSelectedFiledReturnsTargetsRequest("2025-26", [
        { returnType: "GSTR-3B", period: "April", artifactType: "PDF" },
        { returnType: "GSTR-3B", period: "April", artifactType: "PDF_AND_EXCEL" },
      ]),
    ).toBeNull();
    expect(
      createSelectedFiledReturnsTargetsRequest("2025-26", [
        { returnType: "GSTR-1", period: "April", artifactType: "JSON" },
      ]),
    ).toBeNull();
    expect(
      isSelectedFiledReturnsTargetsRequest({
        kind: "selected-filed-returns-targets",
        financialYear: "2025-26",
        targets: [
          { returnType: "GSTR-3B", period: "May", artifactType: "PDF" },
          { returnType: "GSTR-3B", period: "April", artifactType: "PDF" },
        ],
      }),
    ).toBe(false);
  });

  it("accepts exactly one cell for every supported return and month", () => {
    const targets = FILED_RETURNS_RETURN_TYPES.flatMap((returnType) =>
      FILED_RETURNS_MONTHS.map((period) => ({ returnType, period, artifactType: "PDF" as const })),
    );
    expect(targets).toHaveLength(MAX_SELECTED_FILED_RETURNS_TARGETS);
    expect(createSelectedFiledReturnsTargetsRequest("2025-26", targets)).not.toBeNull();
  });
});
