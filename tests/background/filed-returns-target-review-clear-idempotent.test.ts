import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key?: unknown) =>
        typeof key === "string" ? { [key]: stored.current[key] } : stored.current,
      ),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored.current[key];
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(stored.current, values);
      }),
    },
  },
}));
vi.mock("wxt/browser", () => ({ browser: browserMocks }));

import { clearFiledReturnsTargetReview } from "../../src/background/filed-returns-target-review";

const scope = {
  artifactType: "PDF_AND_EXCEL",
  financialYear: "2025-26",
  period: "June",
  returnType: "GSTR-2B",
} as never;
const deps = { storageKeys: { targetReview: "pack:filed-returns-target-review" } } as never;

describe("clearing a target review is idempotent", () => {
  beforeEach(() => {
    stored.current = {};
    vi.clearAllMocks();
  });

  // A live single-period All-formats run downloaded its ZIP, correlated it by
  // exact download ID and cleared staging -- then blocked, because the review
  // record it went on to delete was already gone and "nothing to remove" was
  // reported as a failure. The post-condition is that no review exists.
  it("succeeds when there is no review to remove", async () => {
    await expect(clearFiledReturnsTargetReview(scope, deps)).resolves.toBe(true);
  });

  // Only the missing case was loosened. A record that exists but cannot be
  // validated is still refused, because that is a state Pack cannot reason
  // about -- unlike absence, which is the goal.
  it("still refuses to treat a malformed record as cleared", async () => {
    stored.current["pack:filed-returns-target-review"] = { nonsense: true };

    await expect(clearFiledReturnsTargetReview(scope, deps)).resolves.toBe(false);
    expect(stored.current["pack:filed-returns-target-review"]).toBeDefined();
  });
});
