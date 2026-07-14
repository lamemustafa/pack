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
});
