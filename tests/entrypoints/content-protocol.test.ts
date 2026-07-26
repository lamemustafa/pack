import { describe, expect, it } from "vitest";
import { isPackMessage } from "../../src/connectors/gst/messages";

describe("content protocol V34", () => {
  it("rejects the retired V33 acquisition request", () => {
    expect(
      isPackMessage({ type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V33", payload: {} }),
    ).toBe(false);
  });
});
