import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireFiledReturnsRun,
  acknowledgeInterruptedFiledReturnsRun,
  type ActiveFiledReturnsRun,
  readActiveFiledReturnsRunSummary,
  readActiveFiledReturnsRunStorageState,
  renewFiledReturnsRunLease,
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
  runId: "filed-returns-run-m0abc123",
  revision: 1,
  scope: {
    financialYear: "2026-27",
    period: "April",
    returnType: "GSTR-3B",
  },
  status: "running",
  leaseUpdatedAt: "2026-07-25T00:00:00.000Z",
} satisfies ActiveFiledReturnsRun;

describe("filed returns active run recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.storage.local.get.mockResolvedValue({ "active-run": ACTIVE_RUN });
  });

  it("summarises an orphaned active run as blocked without requiring a start click", async () => {
    const summary = await readActiveFiledReturnsRunSummary({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
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

  it("uses the active run return type when reporting interrupted GSTR-1 state", async () => {
    const gstr1Run: ActiveFiledReturnsRun = {
      ...ACTIVE_RUN,
      scope: {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-1",
      },
    };
    browserMocks.storage.local.get.mockResolvedValue({ "active-run": gstr1Run });

    const summary = await readActiveFiledReturnsRunSummary({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(summary?.flowStep).toMatchObject({
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      safeSignals: ["filed-returns-run-needs-review"],
    });
  });

  it("acknowledges an interrupted run by removing only the active run key", async () => {
    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
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
      now: () => new Date("2026-07-25T00:00:05Z"),
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

  it("normalizes a legacy checkpoint-read lease so its interrupted run can be acknowledged", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, status: "recovery-blocked" },
    });

    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["filed-returns-run-acknowledged"],
        userAction: { canResume: true },
      },
    });
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith("active-run");
  });

  it("renews the active run lease without changing the scope", async () => {
    await renewFiledReturnsRunLease(ACTIVE_RUN, {
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:00:20Z"),
    });

    expect(browserMocks.storage.local.set).toHaveBeenCalledWith({
      "active-run": {
        ...ACTIVE_RUN,
        revision: 2,
        leaseUpdatedAt: "2026-07-25T00:00:20.000Z",
      },
    });
  });

  it("fails closed instead of overwriting malformed active-run metadata", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, unexpectedPortalMetadata: "synthetic-forbidden" },
    });

    const result = await acquireFiledReturnsRun(ACTIVE_RUN.scope, {
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:00:05Z"),
    });

    expect(result).toMatchObject({
      response: {
        ok: true,
        flowStep: {
          state: "blocked",
          safeSignals: ["filed-returns-active-run-malformed"],
          userAction: { canResume: false },
        },
      },
    });
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("reports a recoverable scope for malformed metadata without exposing extra fields", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, runId: "invalid run id" },
    });

    const state = await readActiveFiledReturnsRunStorageState(
      { storageKeys: { activeRun: "active-run" } },
      new Date("2026-07-25T00:00:05Z"),
    );
    const summary = await readActiveFiledReturnsRunSummary({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:00:05Z"),
    });

    expect(state).toEqual({ state: "malformed", recoverableScope: ACTIVE_RUN.scope });
    expect(summary).toMatchObject({
      status: "blocked",
      scope: ACTIVE_RUN.scope,
      flowStep: {
        safeSignals: ["filed-returns-active-run-malformed"],
        userAction: { canResume: false },
      },
    });
  });

  it("does not acknowledge or delete malformed active-run metadata", async () => {
    browserMocks.storage.local.get.mockResolvedValue({
      "active-run": { ...ACTIVE_RUN, revision: 0 },
    });

    const response = await acknowledgeInterruptedFiledReturnsRun({
      storageKeys: { activeRun: "active-run" },
      now: () => new Date("2026-07-25T00:01:00Z"),
    });

    expect(response).toMatchObject({
      ok: true,
      flowStep: {
        state: "blocked",
        safeSignals: ["filed-returns-active-run-malformed"],
      },
    });
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });
});
