import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_CAPABILITIES,
  FILED_RETURNS_PERIODICITIES,
} from "../../src/connectors/gst/filed-returns-catalogue";

// Periodicity is the fact the catalogue exists to carry. It is why a twelve
// column month grid was abandoned: GSTR-9 is annual and GSTR-4 is quarterly, so
// a month axis is only coherent for the three returns supported today. Before
// this file, relabelling a quarterly return as monthly broke two tests.
const EXPECTED_PERIODICITY: Record<string, string> = {
  "GSTR-3B": "monthly",
  "GSTR-1": "monthly",
  "GSTR-2B": "monthly",
  "GSTR-4": "quarterly",
  "GSTR-4A": "quarterly",
  "GSTR-9": "annual",
  "GSTR-9C": "annual",
};

describe("catalogue periodicity", () => {
  it.each(Object.entries(EXPECTED_PERIODICITY))("%s is %s", (returnType, periodicity) => {
    expect(FILED_RETURNS_CAPABILITIES[returnType as never]).toBeDefined();
    expect(
      (FILED_RETURNS_CAPABILITIES[returnType as never] as { periodicity: string }).periodicity,
    ).toBe(periodicity);
  });

  it("declares a periodicity from the canonical list for every entry", () => {
    for (const [returnType, entry] of Object.entries(FILED_RETURNS_CAPABILITIES)) {
      const periodicity = (entry as { periodicity: string }).periodicity;
      expect(
        FILED_RETURNS_PERIODICITIES as readonly string[],
        `${returnType} declares an unknown periodicity`,
      ).toContain(periodicity);
    }
  });

  it("covers more than one periodicity, or the catalogue earns nothing", () => {
    // A catalogue whose entries are all monthly is a hardcoded list wearing a
    // table's clothes. The extensibility claim rests on this being false.
    const distinct = new Set(
      Object.values(FILED_RETURNS_CAPABILITIES).map(
        (e) => (e as { periodicity: string }).periodicity,
      ),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });
});
