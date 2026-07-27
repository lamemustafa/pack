import { describe, expect, it } from "vitest";
import { isPackMessage } from "../../src/connectors/gst/messages";

describe("content protocol V34", () => {
  it("accepts the V34 portal-owned Returns Dashboard anchor request", () => {
    expect(isPackMessage({ type: "PACK_CONTENT_OPEN_RETURNS_DASHBOARD_V34" })).toBe(true);
  });

  it("rejects the retired V33 acquisition request", () => {
    expect(
      isPackMessage({ type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V33", payload: {} }),
    ).toBe(false);
  });
});
