import { describe, expect, it } from "vitest";
import {
  capturedPortalSafeSignals,
  isPossibleArtifactContentType,
  splitCaptureDataUrlIntoChunks,
  forEachEmbeddedCaptureUrl,
} from "../../src/background/main-world-capture-utils";

describe("main-world capture utilities", () => {
  it("classifies only expected artifact content types", () => {
    expect(isPossibleArtifactContentType("application/pdf")).toBe(true);
    expect(isPossibleArtifactContentType("application/octet-stream; charset=binary")).toBe(true);
    expect(isPossibleArtifactContentType("application/vnd.ms-excel")).toBe(true);
    expect(
      isPossibleArtifactContentType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
    expect(isPossibleArtifactContentType("text/html")).toBe(false);
    expect(isPossibleArtifactContentType("application/json")).toBe(false);
  });

  it("chunks captured data URLs and rejects excessive transfer counts", () => {
    expect(splitCaptureDataUrlIntoChunks("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
    expect(splitCaptureDataUrlIntoChunks("", 2)).toBeNull();
    expect(splitCaptureDataUrlIntoChunks("x".repeat(201), 1)).toBeNull();
  });

  it("extracts embedded blob and data URLs without including surrounding markup", () => {
    const urls: string[] = [];

    forEachEmbeddedCaptureUrl(
      `<a href="blob:https://gstr2b.gst.gov.in/report">pdf</a><script>open('data:application/pdf;base64,JVBERi0x')</script>`,
      (url) => urls.push(url),
    );

    expect(urls).toEqual([
      "blob:https://gstr2b.gst.gov.in/report",
      "data:application/pdf;base64,JVBERi0x",
    ]);
  });

  it("builds redacted capture signals for blob and data URL sources", () => {
    expect(
      capturedPortalSafeSignals({
        filename: "portal.pdf",
        signalPrefix: "gstr2b",
        source: "blob",
        suppressedWindowOpen: true,
      }),
    ).toEqual([
      "gstr2b-portal-blob-captured",
      "gstr2b-native-blob-click-suppressed",
      "gstr2b-main-world-capture",
      "gstr2b-native-window-open-suppressed",
      "gstr2b-portal-filename-observed",
    ]);

    expect(
      capturedPortalSafeSignals({
        signalPrefix: "gstr2b",
        source: "data-url",
        suppressedWindowOpen: false,
      }),
    ).toEqual([
      "gstr2b-portal-data-url-captured",
      "gstr2b-native-data-click-suppressed",
      "gstr2b-main-world-capture",
    ]);
  });
});
