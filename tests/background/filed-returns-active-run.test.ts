import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeInterruptedFiledReturnsRun,
  readActiveFiledReturnsRunSummary,
} from "../../src/background/filed-returns-active-run";

const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));

const ACTIVE_RUN = {
  schemaVersion: "1.0",
  runId: "run-existing",
  revision: 1,
  scope: {
    financialYear: "2026-27",
    period: "April",
    returnType: "GSTR-3B",
  },
  status: "running",
  leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
};

describe("filed returns active run recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.storage.local.get.mockResolvedValue({ "active-run": ACTIVE_RUN });
  });

  it("summarises an orphaned active run as blocked without requiring a start click", async () => {
    const summary = await readActiveFiledReturnsRunSummary({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-06-24T00:01:00Z"),
    });

    expect(summary).toMatchObject({
      status: "blocked",
      scope: ACTIVE_RUN.scope,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-needs-review"],
      },
    });
  });

  it("acknowledges an interrupted run by removing only the active run key", async () => {
    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-06-24T00:01:00Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-acknowledged"],
      },
    });
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("active-run");
  });

  it("does not acknowledge a still-active run as interrupted", async () => {
    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-06-24T00:00:05Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "user-action-required",
        safeSignals: ["filed-returns-run-active"],
      },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });
});
