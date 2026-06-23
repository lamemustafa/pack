import { describe, expect, it } from "vitest";
import { buildRelativePath, makeTargetId, sanitizeFileSegment } from "../../src/core/naming";

describe("Pack filename safety", () => {
  it("removes unsafe path characters and keeps reserved names safe", () => {
    expect(sanitizeFileSegment("../CON\u0000:bad/name.pdf")).toBe("CON-bad-name.pdf");
    expect(sanitizeFileSegment("CON")).toBe("CON-file");
  });

  it("builds deterministic target IDs and relative paths", () => {
    expect(
      makeTargetId({
        documentType: "GSTR-3B",
        financialYear: "FY-2023-24",
        period: "APR",
        format: "pdf",
      }),
    ).toBe("gstr-3b:fy-2023-24:apr:pdf");

    expect(
      buildRelativePath({
        subjectLabel: "Synthetic GSTIN",
        financialYear: "FY-2023-24",
        documentType: "GSTR-1",
        filename: "../return.pdf",
      }),
    ).toBe("Synthetic-GSTIN/FY-2023-24/GSTR-1/return.pdf");
  });
});
