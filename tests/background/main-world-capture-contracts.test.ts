import { describe, expect, it } from "vitest";
import { isMainWorldCaptureOutcome } from "../../src/background/main-world-capture-contracts";

describe("main world capture contracts", () => {
  it("accepts chunked capture outcomes when browser serialization omits the null inline request", () => {
    expect(
      isMainWorldCaptureOutcome({
        chunkedCaptureRequest: {
          actionId: "action-1",
          chunkCount: 2,
          safeSignals: ["gstr2b-main-world-chunked-capture"],
          transferId: "transfer-1",
        },
        safeFailureSignals: [],
      }),
    ).toBe(true);
  });

  it("rejects incomplete chunked capture outcomes", () => {
    expect(
      isMainWorldCaptureOutcome({
        chunkedCaptureRequest: {
          actionId: "action-1",
          chunkCount: 0,
          safeSignals: ["gstr2b-main-world-chunked-capture"],
          transferId: "transfer-1",
        },
        safeFailureSignals: [],
      }),
    ).toBe(false);
  });
});
