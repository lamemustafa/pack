import { describe, expect, it } from "vitest";
import {
  capturedFiledReturnsArtifactExtension,
  isExpectedCapturedDataUrl,
} from "../../src/background/captured-download-data-url";
import { createZip } from "../../src/entrypoints/offscreen/zip";
import { textBytes } from "../fixtures/gstr2b-workbook";

function base64(input: string): string {
  return globalThis.btoa(input);
}

describe("captured download data URL validation", () => {
  it("accepts generic binary PDF blobs only when PDF magic bytes match", () => {
    expect(
      isExpectedCapturedDataUrl(
        `data:application/octet-stream;base64,${base64("%PDF-1.7 synthetic\\n%%EOF\\n")}`,
        "PDF",
      ),
    ).toBe(true);
    expect(
      isExpectedCapturedDataUrl(
        `data:application/octet-stream;base64,${base64("<html>not a pdf</html>")}`,
        "PDF",
      ),
    ).toBe(false);
  });

  it("recognises XLS and XLSX magic bytes without return-specific heuristics", () => {
    const xlsDataUrl = `data:application/vnd.ms-excel;base64,${base64(
      "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1legacy-xls",
    )}`;
    const xlsxBytes = createZip([
      { path: "[Content_Types].xml", bytes: textBytes("<Types />") },
      { path: "xl/workbook.xml", bytes: textBytes("<workbook />") },
    ]);
    const binary = Array.from(xlsxBytes, (byte) => String.fromCharCode(byte)).join("");
    const xlsxDataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64(binary)}`;

    expect(isExpectedCapturedDataUrl(xlsDataUrl, "EXCEL")).toBe(true);
    expect(capturedFiledReturnsArtifactExtension(xlsDataUrl, "EXCEL")).toBe(".xls");
    expect(isExpectedCapturedDataUrl(xlsxDataUrl, "EXCEL")).toBe(true);
    expect(capturedFiledReturnsArtifactExtension(xlsxDataUrl, "EXCEL")).toBe(".xlsx");
  });
});
