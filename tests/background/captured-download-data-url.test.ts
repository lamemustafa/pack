import { describe, expect, it } from "vitest";
import {
  capturedFiledReturnsArtifactExtension,
  isExpectedCapturedDataUrl,
  isExpectedCapturedDataUrlForTarget,
} from "../../src/background/captured-download-data-url";
import { createZip } from "../../src/entrypoints/offscreen/zip";

function base64(input: string): string {
  return globalThis.btoa(input);
}

function gstr2bTarget() {
  return {
    actionId: "action",
    financialYear: "2025-26",
    period: "April",
    returnType: "GSTR-2B",
  } as const;
}

describe("captured download data URL validation", () => {
  it("accepts generic binary PDF blobs only when PDF magic bytes match", () => {
    expect(
      isExpectedCapturedDataUrl(
        `data:application/octet-stream;base64,${base64("%PDF-1.7 synthetic\n%%EOF\n")}`,
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

  it("accepts legacy XLS bytes and classifies the captured Excel extension from magic bytes", () => {
    const xlsDataUrl = `data:application/vnd.ms-excel;base64,${base64(
      "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1legacy-xls",
    )}`;
    const xlsxBytes = createZip([
      { path: "[Content_Types].xml", bytes: textBytes("<Types />") },
      { path: "xl/workbook.xml", bytes: textBytes("<workbook />") },
    ]);
    const xlsxDataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64(
      bytesToBinaryString(xlsxBytes),
    )}`;

    expect(isExpectedCapturedDataUrl(xlsDataUrl, "EXCEL")).toBe(true);
    expect(capturedFiledReturnsArtifactExtension(xlsDataUrl, "EXCEL")).toBe(".xls");
    expect(isExpectedCapturedDataUrl(xlsxDataUrl, "EXCEL")).toBe(true);
    expect(capturedFiledReturnsArtifactExtension(xlsxDataUrl, "EXCEL")).toBe(".xlsx");
  });

  it("requires portal-sized bytes before accepting captured GSTR-2B PDFs", () => {
    const target = gstr2bTarget();
    const portalSizedPdf = `%PDF-1.7 GSTR-2B statement ${"x".repeat(21 * 1024)}\n%%EOF\n`;

    expect(
      isExpectedCapturedDataUrlForTarget(
        `data:application/pdf;base64,${base64(portalSizedPdf)}`,
        "PDF",
        target,
      ),
    ).toBe(true);
    expect(
      isExpectedCapturedDataUrlForTarget(
        `data:application/pdf;base64,${base64("%PDF-1.7 wrong statement")}`,
        "PDF",
        target,
      ),
    ).toBe(false);
  });

  it("rejects tiny local GSTR-2B PDF placeholders even when they contain a GSTR-2B marker", () => {
    expect(
      isExpectedCapturedDataUrlForTarget(
        `data:application/pdf;base64,${base64(
          "%PDF-1.4 ComplyEaze Pack generated GSTR-2B summary",
        )}`,
        "PDF",
        gstr2bTarget(),
      ),
    ).toBe(false);
  });

  it("rejects malformed GSTR-2B spreadsheet ZIP containers with unsupported local flags", () => {
    const malformedZipHeader =
      "PK\u0003\u0004" +
      "\u0014\u0000" +
      "\u0014\u0000" +
      "\u0000\u0000" +
      "\u0000".repeat(18) +
      "[Content_Types].xml xl/workbook.xml";

    expect(
      isExpectedCapturedDataUrlForTarget(
        `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64(
          malformedZipHeader,
        )}`,
        "EXCEL",
        gstr2bTarget(),
      ),
    ).toBe(false);
  });

  it("rejects spreadsheet ZIPs that do not look like portal GSTR-2B details workbooks", () => {
    const oneSheetWorkbook = createZip([
      { path: "[Content_Types].xml", bytes: textBytes("<Types />") },
      { path: "xl/workbook.xml", bytes: textBytes('<sheet name="Sheet1" />') },
    ]);

    expect(
      isExpectedCapturedDataUrlForTarget(
        `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytesToBase64(
          oneSheetWorkbook,
        )}`,
        "EXCEL",
        gstr2bTarget(),
      ),
    ).toBe(false);
  });

  it("accepts portal-style spreadsheet ZIP containers for GSTR-2B Excel captures", () => {
    const workbook = createZip([
      { path: "[Content_Types].xml", bytes: textBytes("<Types />") },
      { path: "xl/workbook.xml", bytes: textBytes("<workbook />") },
      { path: "xl/worksheets/sheet10.xml", bytes: textBytes("<worksheet />") },
    ]);

    expect(
      isExpectedCapturedDataUrlForTarget(
        `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytesToBase64(
          workbook,
        )}`,
        "EXCEL",
        gstr2bTarget(),
      ),
    ).toBe(true);
  });
});

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  return globalThis.btoa(bytesToBinaryString(bytes));
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}
