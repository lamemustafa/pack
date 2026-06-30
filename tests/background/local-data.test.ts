import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";

const filedReturnsCurrentStateStorageKeys = {
  activeRun: "pack:active-filed-returns-run",
  completion: "pack:last-filed-returns-flow-summary",
  fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
  targetReview: "pack:filed-returns-target-review",
};

const browserMocks = vi.hoisted(() => ({
  downloads: {
    download: vi.fn(async () => 1),
  },
  runtime: {
    id: "pack-test-extension",
    getManifest: vi.fn(() => ({ version: "0.1.0" })),
    onInstalled: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
  storage: {
    local: {
      get: vi.fn(async (_key?: unknown) => {
        void _key;
        return {};
      }),
      remove: vi.fn(async () => undefined),
      setAccessLevel: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    session: {
      clear: vi.fn(async () => undefined),
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ ok: true })),
  },
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));

describe("Pack local data clearing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal("defineBackground", (entrypoint: () => void) => {
      entrypoint();
      return entrypoint;
    });
  });

  it("removes every Pack local storage key and clears session storage", async () => {
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(browserMocks.storage.session.clear).toHaveBeenCalledTimes(1);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
    expect(background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS).toEqual(
      Object.values(background.PACK_LOCAL_STORAGE_KEYS),
    );
  });

  it("refuses broad local-data clearing while a full-year recovery target is unresolved", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              ledgerId: "ledger-existing",
              revision: 2,
              status: "blocked",
              scope: {
                financialYear: "2026-27",
                period: FULL_FISCAL_YEAR_PERIOD,
                returnType: "GSTR-3B",
              },
              currentTargetId: "GSTR-3B:2026-27:April",
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:00:00.000Z",
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "download-unconfirmed",
                  attempts: 1,
                  safeSignals: ["browser-download-size-unknown"],
                  safeMessage: "Unconfirmed.",
                  updatedAt: "2026-06-24T00:00:00.000Z",
                },
              ],
            },
          }
        : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({
      ok: false,
      error:
        "Pack has unresolved filed-return recovery state. Cancel or resolve the run before clearing local data.",
    });
    expect(browserMocks.storage.session.clear).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("restricts local storage to trusted extension contexts on startup", async () => {
    await import("../../src/entrypoints/background");

    expect(browserMocks.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });

  it("prefers an interrupted active run over an older session summary", async () => {
    const sessionSummary: FiledReturnsFlowSummary = {
      scope: {
        financialYear: "2025-26",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      status: "complete",
      completedPeriods: ["April"],
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["full-fiscal-year-complete"],
        safeMessage: "Complete.",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:active-filed-returns-run"
        ? {
            [key]: {
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
            },
          }
        : {},
    );
    browserMocks.storage.session.get.mockResolvedValue({
      "pack:last-filed-returns-flow-summary": sessionSummary,
    });
    const summary = await readCurrentFiledReturnsFlowSummary({
      storageKeys: filedReturnsCurrentStateStorageKeys,
      now: () => new Date("2026-06-24T00:01:00Z"),
    });

    expect(summary).toMatchObject({
      status: "blocked",
      scope: {
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
      },
      flowStep: {
        safeSignals: ["filed-returns-run-needs-review"],
      },
    });
  });

  it("keeps same-scope active-run recovery visible over a terminal summary", async () => {
    const sessionSummary: FiledReturnsFlowSummary = {
      scope: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      status: "complete",
      completedAt: "2026-06-24T00:00:01.000Z",
      completedPeriods: ["May"],
      currentPeriod: "May",
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["filed-gstr3b-download-clicked", "browser-download-completed"],
        safeMessage: "Complete.",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:active-filed-returns-run"
        ? {
            [key]: {
              schemaVersion: "1.0",
              runId: "run-existing",
              revision: 1,
              scope: {
                financialYear: "2026-27",
                period: "May",
                returnType: "GSTR-3B",
              },
              status: "running",
              leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
            },
          }
        : {},
    );
    browserMocks.storage.session.get.mockResolvedValue({
      "pack:last-filed-returns-flow-summary": sessionSummary,
    });
    const summary = await readCurrentFiledReturnsFlowSummary({
      storageKeys: filedReturnsCurrentStateStorageKeys,
      now: () => new Date("2026-06-24T00:01:00Z"),
    });

    expect(summary).toMatchObject({
      status: "blocked",
      scope: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      flowStep: {
        safeSignals: ["filed-returns-run-needs-review"],
      },
    });
  });

  it("does not let a blocked single-period summary hide interrupted active-run recovery", async () => {
    const sessionSummary: FiledReturnsFlowSummary = {
      scope: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      status: "blocked",
      updatedAt: "2026-06-24T00:00:01.000Z",
      completedPeriods: [],
      currentPeriod: "May",
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: ["browser-download-not-observed"],
        safeMessage: "No browser completion.",
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:active-filed-returns-run"
        ? {
            [key]: {
              schemaVersion: "1.0",
              runId: "run-existing",
              revision: 1,
              scope: {
                financialYear: "2026-27",
                period: "May",
                returnType: "GSTR-3B",
              },
              status: "running",
              leaseUpdatedAt: "2026-06-24T00:00:00.000Z",
            },
          }
        : {},
    );
    browserMocks.storage.session.get.mockResolvedValue({
      "pack:last-filed-returns-flow-summary": sessionSummary,
    });
    const summary = await readCurrentFiledReturnsFlowSummary({
      storageKeys: filedReturnsCurrentStateStorageKeys,
      now: () => new Date("2026-06-24T00:01:00Z"),
    });

    expect(summary).toMatchObject({
      status: "blocked",
      scope: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      flowStep: {
        safeSignals: ["filed-returns-run-needs-review"],
      },
    });
  });

  it("reports a stale running full-year ledger as blocked in current state", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              ledgerId: "ledger-existing",
              revision: 2,
              status: "running",
              scope: {
                financialYear: "2026-27",
                period: FULL_FISCAL_YEAR_PERIOD,
                returnType: "GSTR-3B",
              },
              currentTargetId: "GSTR-3B:2026-27:April",
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:00:00.000Z",
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "running",
                  attempts: 1,
                  safeSignals: [],
                  safeMessage: "Checking April.",
                  updatedAt: "2026-06-24T00:00:00.000Z",
                },
              ],
            },
          }
        : {},
    );
    const summary = await readCurrentFiledReturnsFlowSummary({
      storageKeys: filedReturnsCurrentStateStorageKeys,
      now: () => new Date("2026-06-24T00:01:00Z"),
    });

    expect(summary).toMatchObject({
      status: "blocked",
      currentPeriod: "April",
      fullFiscalYearRecovery: {
        ledgerId: "ledger-existing",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
        targetStatus: "running",
      },
      flowStep: {
        safeSignals: ["full-fiscal-year-run-interrupted"],
      },
    });
  });
});
