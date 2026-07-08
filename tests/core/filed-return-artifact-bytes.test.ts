import { describe, expect, it } from "vitest";
import {
  GSTR2B_PORTAL_WORKBOOK_ENTRIES,
  isLikelyPdfBytes,
  isLikelyXlsBytes,
  isLikelyXlsxBytes,
} from "../../src/core/filed-return-artifact-bytes";
import { createZip } from "../../src/entrypoints/offscreen/zip";

describe("filed-return artifact byte signatures", () => {
  it("requires both PDF magic bytes and an EOF marker", () => {
    expect(isLikelyPdfBytes(textBytes("%PDF-1.7\nbody\n%%EOF\n"))).toBe(true);
    expect(isLikelyPdfBytes(textBytes("%PDF-1.7\nbody without eof"))).toBe(false);
  });

  it("recognises legacy XLS bytes by compound-file magic", () => {
    expect(isLikelyXlsBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(
      true,
    );
    expect(isLikelyXlsBytes(textBytes("not-xls"))).toBe(false);
  });

  it("validates XLSX central-directory entries instead of raw text markers", () => {
    const workbook = createZip([
      { path: "[Content_Types].xml", bytes: textBytes("<Types />") },
      { path: "xl/workbook.xml", bytes: textBytes("<workbook />") },
      { path: "xl/worksheets/sheet10.xml", bytes: textBytes("<worksheet />") },
    ]);
    const markerTextOnly = textBytes("PK\u0003\u0004[Content_Types].xml xl/workbook.xml");

    expect(isLikelyXlsxBytes(workbook, GSTR2B_PORTAL_WORKBOOK_ENTRIES)).toBe(true);
    expect(isLikelyXlsxBytes(markerTextOnly, GSTR2B_PORTAL_WORKBOOK_ENTRIES)).toBe(false);
  });
});

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
