import { describe, expect, it } from "vitest";
import { createArchiveManifest, assertAllTargetsTerminal } from "../../src/core/manifest";
import {
  DEFAULT_GST_RETURN_SCOPE,
  createGstReturnPlan,
  createSyntheticGstResults,
} from "../../src/connectors/gst/planner";

describe("archive manifest", () => {
  it("retains every planned target with terminal status and local-only privacy flags", () => {
    const startedAt = new Date("2026-06-19T00:00:00.000Z");
    const plan = createGstReturnPlan(DEFAULT_GST_RETURN_SCOPE, startedAt);
    const results = createSyntheticGstResults(plan, new Date("2026-06-19T00:00:01.000Z"));

    assertAllTargetsTerminal(plan, results);

    const manifest = createArchiveManifest(plan, results, {
      productVersion: "0.1.0",
      build: "test",
      officialUrl: "https://pack.complyeaze.com",
      startedAt: startedAt.toISOString(),
      completedAt: "2026-06-19T00:00:01.000Z",
    });

    expect(manifest.documents).toHaveLength(plan.targets.length);
    expect(manifest.summary.total_planned).toBe(plan.targets.length);
    expect(manifest.summary.downloaded).toBeGreaterThan(0);
    expect(manifest.privacy.credentials_collected).toBe(false);
    expect(manifest.privacy.cookies_collected).toBe(false);
    expect(manifest.privacy.uploaded_to_complyeaze).toBe(false);
  });

  it("fails contract checks when targets do not have terminal results", () => {
    const plan = createGstReturnPlan(
      DEFAULT_GST_RETURN_SCOPE,
      new Date("2026-06-19T00:00:00.000Z"),
    );
    expect(() => assertAllTargetsTerminal(plan, [])).toThrow(/Missing terminal result/);
  });
});
