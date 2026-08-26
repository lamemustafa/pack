import { describe, expect, it } from "vitest";
import {
  FLOW_STEP_DEADLINE_MS,
  FLOW_STEP_SETTLE_MS,
  MAX_GSTR2B_FLOW_STEPS,
  MAX_GSTR3B_FLOW_STEPS,
  flowStepDeadlineMs,
} from "../../src/background/filed-returns-flow-runner-utils";

// A step count is not a duration. Bounding a portal wait by iterations gave a
// GSTR-3B period ~1.8s of patience, so a twelve-period run was twelve coin
// flips against the portal's render time. Three live stalls, all recovered by
// retry -- because a retry is only a fresh budget. Pin the bound in elapsed
// time so nobody restores a step count without this failing.
describe("flow step deadline", () => {
  it("is expressed in wall-clock milliseconds", () => {
    expect(flowStepDeadlineMs({})).toBe(FLOW_STEP_DEADLINE_MS);
    expect(flowStepDeadlineMs({ timings: { flowStepDeadlineMs: 5_000 } })).toBe(5_000);
  });

  it("waits far longer than the step budget it replaced", () => {
    // The old effective wait, reconstructed: iterations times the settle.
    const oldPatienceMs = MAX_GSTR3B_FLOW_STEPS * FLOW_STEP_SETTLE_MS;
    expect(oldPatienceMs).toBeLessThan(2_000);
    expect(flowStepDeadlineMs({})).toBeGreaterThan(oldPatienceMs * 10);
  });

  it("gives every return type the same patience, since the portal does not care which one", () => {
    // GSTR-1 previously got 30 steps and the others 12 -- someone had already
    // hit this and raised one number by hand. A deadline removes the asymmetry.
    expect(MAX_GSTR3B_FLOW_STEPS).toBe(MAX_GSTR2B_FLOW_STEPS);
    expect(flowStepDeadlineMs({})).toBe(FLOW_STEP_DEADLINE_MS);
  });

  it("stays long enough to outlast a slow portal render but short enough to report", () => {
    expect(flowStepDeadlineMs({})).toBeGreaterThanOrEqual(20_000);
    expect(flowStepDeadlineMs({})).toBeLessThanOrEqual(60_000);
  });
});
