import { describe, expect, it } from "vitest";
import { normaliseContentScriptMessageResponse } from "../../src/background/content-script-message-response";

describe("content-script artifact message boundary", () => {
  it("rejects a raw-byte-shaped artifact response", () => {
    expect(
      normaliseContentScriptMessageResponse(
        {
          ok: true,
          artifact: {
            ok: true,
            base64: "c3ludGhldGlj",
            mimeType: "application/json",
            requestId: "synthetic-request",
            safeSignals: ["target-period-verified"],
            state: "acquired",
          },
        },
        "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34",
      ),
    ).toMatchObject({ ok: false, error: "CONTENT_SCRIPT_UNAVAILABLE" });
  });
});
