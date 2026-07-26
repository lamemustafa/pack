import { describe, expect, it } from "vitest";
import { isMainWorldCaptureOutcome } from "../../src/background/main-world-capture-contracts";

describe("main world capture contracts", () => {
  it("accepts extension-private captured download outcomes", () => {
    expect(
      isMainWorldCaptureOutcome({
        capturedDownloadRequest: {
          actionId: "action-1",
          dataUrl: "data:application/pdf;base64,JVBERg==",
          safeSignals: ["gstr2b-main-world-capture"],
        },
        safeFailureSignals: [],
      }),
    ).toBe(true);
  });

  it("rejects outcomes without a captured request or explicit null", () => {
    expect(
      isMainWorldCaptureOutcome({
        safeFailureSignals: [],
      }),
    ).toBe(false);
  });

  it("accepts only canonical optional delegation timestamps and known keys", () => {
    expect(
      isMainWorldCaptureOutcome({
        capturedDownloadRequest: null,
        safeFailureSignals: ["filed-gstr3b-target-bound-native-blob-click-delegated"],
        targetBoundNativeDelegatedAt: "2026-06-24T00:00:00.100Z",
      }),
    ).toBe(true);
    expect(
      isMainWorldCaptureOutcome({
        capturedDownloadRequest: null,
        safeFailureSignals: [],
        targetBoundNativeDelegatedAt: "not-a-timestamp",
      }),
    ).toBe(false);
    expect(
      isMainWorldCaptureOutcome({
        capturedDownloadRequest: null,
        extra: "page-controlled",
        safeFailureSignals: [],
      }),
    ).toBe(false);
  });
});
