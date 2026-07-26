import { describe, expect, it } from "vitest";
import {
  isCanonicalFiledReturnsActionId,
  isCanonicalFiledReturnsRunId,
} from "../../src/connectors/gst/filed-returns-operation-id";

describe("filed-return operation IDs", () => {
  it("accepts generated UUIDs and exact historical fallback shapes", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";

    expect(isCanonicalFiledReturnsActionId(uuid)).toBe(true);
    expect(isCanonicalFiledReturnsRunId(uuid)).toBe(true);
    expect(isCanonicalFiledReturnsActionId("action-m0abc123-abc123de")).toBe(true);
    expect(isCanonicalFiledReturnsRunId("filed-returns-run-m0abc123")).toBe(true);
  });

  it("rejects arbitrary labels", () => {
    expect(isCanonicalFiledReturnsActionId("action-synthetic-taxpayer")).toBe(false);
    expect(isCanonicalFiledReturnsRunId("filed-returns-run-synthetic-taxpayer")).toBe(false);
  });
});
