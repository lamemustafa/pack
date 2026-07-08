import { describe, expect, it } from "vitest";
import {
  capturedFiledReturnsArtifactExtension,
  isExpectedCapturedDataUrl,
  isExpectedCapturedDataUrlForTarget,
} from "../../src/background/captured-download-data-url";

function base64(input: string): string {
  return globalThis.btoa(input);
}

describe("captured download data URL validation", () => {
  it("accepts generic binary PDF blobs only when PDF magic bytes match", () => {
    expect(
      isExpectedCapturedDataUrl(
        `data:application/octet-stream;base64,${base64("%PDF-1.7 synthetic")}`,
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
    const xlsxDataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64(
      "PK\u0003\u0004xlsx",
    )}`;

    expect(isExpectedCapturedDataUrl(xlsDataUrl, "EXCEL")).toBe(true);
    expect(capturedFiledReturnsArtifactExtension(xlsDataUrl, "EXCEL")).toBe(".xls");
    expect(isExpectedCapturedDataUrl(xlsxDataUrl, "EXCEL")).toBe(true);
    expect(capturedFiledReturnsArtifactExtension(xlsxDataUrl, "EXCEL")).toBe(".xlsx");
  });

  it("requires a GSTR-2B marker before accepting captured GSTR-2B files", () => {
    const target = {
      actionId: "action",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    } as const;

    expect(
      isExpectedCapturedDataUrlForTarget(
        `data:application/pdf;base64,${base64("%PDF-1.7 GSTR-2B statement")}`,
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
});
