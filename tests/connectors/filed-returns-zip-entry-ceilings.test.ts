import { describe, expect, it } from "vitest";
import { isDurableFiledReturnsSignal } from "../../src/connectors/gst/filed-returns-durable-signals";
import { filedReturnsOfferedArtifacts } from "../../src/connectors/gst/filed-returns-capabilities";
import { FILED_RETURNS_RETURN_TYPES } from "../../src/connectors/gst/filed-returns-return-types";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";

/**
 * The ZIP entry ceilings bound an observed count, so they are only meaningful while they
 * match what the catalogue can actually produce. A shared ceiling across the two full-year
 * kinds once raised the single-return bound from 38 to 108 as a side effect of admitting the
 * cross-return bundle; these assertions exist so that widening one kind cannot silently widen
 * another, and so that adding a return type or an offered format fails here rather than
 * quietly fitting under a bound nobody re-derived.
 */

const MAX_DERIVED_SINGLE_RETURN = 2; // full-year-summary.csv and the workbook
const MAX_DERIVED_MIXED_RETURN = 1; // mixed plans receive one combined summary, no workbook

function artifactsPerYear(returnType: (typeof FILED_RETURNS_RETURN_TYPES)[number]): number {
  return FILED_RETURNS_MONTHS.length * filedReturnsOfferedArtifacts(returnType).length;
}

describe("ZIP entry count ceilings", () => {
  it("admits the widest single-return year and refuses one entry more", () => {
    const widest = Math.max(...FILED_RETURNS_RETURN_TYPES.map(artifactsPerYear));
    const ceiling = widest + MAX_DERIVED_SINGLE_RETURN;

    expect(widest).toBe(36);
    expect(isDurableFiledReturnsSignal(`full-fiscal-year-zip-entry-count:${ceiling}`)).toBe(true);
    expect(isDurableFiledReturnsSignal(`full-fiscal-year-zip-entry-count:${ceiling + 1}`)).toBe(
      false,
    );
  });

  it("admits every supported return in one year and refuses one entry more", () => {
    const everyReturn = FILED_RETURNS_RETURN_TYPES.reduce(
      (total, returnType) => total + artifactsPerYear(returnType),
      0,
    );
    const ceiling = everyReturn + MAX_DERIVED_MIXED_RETURN;

    expect(everyReturn).toBe(84);
    expect(
      isDurableFiledReturnsSignal(`all-supported-full-fiscal-year-zip-entry-count:${ceiling}`),
    ).toBe(true);
    expect(
      isDurableFiledReturnsSignal(`all-supported-full-fiscal-year-zip-entry-count:${ceiling + 1}`),
    ).toBe(false);
    expect(isDurableFiledReturnsSignal(`all-supported-full-fiscal-year-zip-entry-count:86`)).toBe(
      false,
    );
  });

  it("does not let the cross-return ceiling raise the single-return one", () => {
    // The exact regression: 108 parsed as durable on the single-return path.
    expect(isDurableFiledReturnsSignal("full-fiscal-year-zip-entry-count:39")).toBe(false);
    expect(isDurableFiledReturnsSignal("full-fiscal-year-zip-entry-count:108")).toBe(false);
    expect(isDurableFiledReturnsSignal("single-period-zip-entry-count:4")).toBe(false);
  });
});
