import { describe, expect, it } from "vitest";
import { isExpectedCapturedDataUrl } from "../../src/background/captured-download-data-url";

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
});
