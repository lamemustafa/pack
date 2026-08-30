import { describe, expect, it } from "vitest";
import { isDurableFiledReturnsSignal } from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  PACK_OFFSCREEN_BLOB_URL_TARGET,
  isPackOffscreenBlobUrlMessageShape,
} from "../../src/connectors/gst/offscreen-blob-url";
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

/**
 * The creation message carries its own ceiling, separate from the durable signal's, and counts
 * only the staged artifacts -- the summary and workbook the offscreen document writes are not in
 * `expectedEntries`. A single bound of 36 covered every caller until a plan could span return
 * types; a complete cross-return year stages 84, so the listener rejected the message outright and
 * every already-staged file ended in an export failure.
 */
function createZipMessage(entryCount: number, returnType?: "GSTR-1"): unknown {
  return {
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
    payload: {
      requestId: "ceiling-probe-request",
      ledgerId: "ceiling-probe",
      generatedAt: "2026-08-29T00:00:00.000Z",
      expectedEntryCount: entryCount,
      expectedEntries: Array.from({ length: entryCount }, (_, index) => ({
        artifactType: "PDF",
        returnType: returnType ?? "GSTR-2B",
        entryNames: [`entry-${index}.pdf`],
      })),
      ...(returnType ? { expectedReturnType: returnType } : {}),
    },
  };
}

describe("ZIP creation message ceilings", () => {
  it("admits a full cross-return year and refuses one entry more", () => {
    const everyReturn = FILED_RETURNS_RETURN_TYPES.reduce(
      (total, returnType) => total + artifactsPerYear(returnType),
      0,
    );

    expect(everyReturn).toBe(84);
    expect(isPackOffscreenBlobUrlMessageShape(createZipMessage(everyReturn))).toBe(true);
    expect(isPackOffscreenBlobUrlMessageShape(createZipMessage(everyReturn + 1))).toBe(false);
  });

  it("keeps the single-return message at the widest single return", () => {
    const widest = Math.max(...FILED_RETURNS_RETURN_TYPES.map(artifactsPerYear));

    expect(widest).toBe(36);
    expect(isPackOffscreenBlobUrlMessageShape(createZipMessage(widest, "GSTR-1"))).toBe(true);
    // The regression this pins: admitting the cross-return plan must not raise the bound for a
    // caller that named one return type.
    expect(isPackOffscreenBlobUrlMessageShape(createZipMessage(widest + 1, "GSTR-1"))).toBe(false);
  });
});
