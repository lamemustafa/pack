import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import type {
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
} from "../../src/core/contracts";
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
    onActivated: {
      addListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(),
    },
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ ok: true })),
  },
}));
const zipMocks = vi.hoisted(() => ({
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => "full-fiscal-year-opfs-cleared"),
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => zipMocks);

describe("Pack local data clearing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValue(
      "full-fiscal-year-opfs-cleared",
    );
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

  it("clears retained full-year files before removing a completed ledger", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              ledgerId: "ledger-complete",
              revision: 3,
              status: "complete",
              scope: {
                financialYear: "2026-27",
                period: FULL_FISCAL_YEAR_PERIOD,
                returnType: "GSTR-3B",
              },
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:01:00.000Z",
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "downloaded",
                  attempts: 1,
                  safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
                  safeMessage: "Staged.",
                  updatedAt: "2026-06-24T00:01:00.000Z",
                },
              ],
            },
          }
        : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith("ledger-complete");
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it("keeps local state when retained full-year files cannot be cleared", async () => {
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValueOnce(
      "full-fiscal-year-opfs-clear-failed",
    );
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              ledgerId: "ledger-complete",
              revision: 3,
              status: "complete",
              scope: {
                financialYear: "2026-27",
                period: FULL_FISCAL_YEAR_PERIOD,
                returnType: "GSTR-3B",
              },
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:01:00.000Z",
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "downloaded",
                  attempts: 1,
                  safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
                  safeMessage: "Staged.",
                  updatedAt: "2026-06-24T00:01:00.000Z",
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
        "Pack could not clear retained fiscal-year files. Retry clearing local data before removing the saved ledger.",
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

  it("preserves a final ZIP retry summary over a blocked completed-target ledger", async () => {
    const updatedAt = "2026-06-24T00:10:00.000Z";
    const sessionSummary: FiledReturnsFlowSummary = {
      scope: {
        financialYear: "2026-27",
        period: FULL_FISCAL_YEAR_PERIOD,
        returnType: "GSTR-3B",
      },
      status: "blocked",
      updatedAt,
      completedPeriods: ["April"],
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage: "The final ZIP download was not confirmed.",
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          message: "Allow downloads, then retry the ZIP export.",
          canResume: true,
        },
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              ledgerId: "ledger-ready-for-zip-retry",
              revision: 3,
              status: "blocked",
              scope: sessionSummary.scope,
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt,
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "downloaded",
                  attempts: 1,
                  safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
                  safeMessage: "Staged.",
                  updatedAt,
                },
              ],
            },
          }
        : {},
    );
    browserMocks.storage.session.get.mockResolvedValue({
      "pack:last-filed-returns-flow-summary": sessionSummary,
    });

    const summary = await readCurrentFiledReturnsFlowSummary({
      storageKeys: filedReturnsCurrentStateStorageKeys,
      now: () => new Date("2026-06-24T00:11:00.000Z"),
    });

    expect(summary).toEqual(sessionSummary);
  });

  it.each([
    ["export-retry-pending", "full-fiscal-year-final-zip-retry"],
    ["downloaded-cleanup-pending", "full-fiscal-year-local-cleanup-retry"],
  ] as const)(
    "reconstructs %s recovery from the local ledger after session storage is lost",
    async (zipPhase, expectedSignal) => {
      const ledger = createDurableZipPhaseLedger(zipPhase);
      browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
        key === "pack:full-fiscal-year-ledger" ? { [key]: ledger } : {},
      );
      browserMocks.storage.session.get.mockResolvedValue({});

      const summary = await readCurrentFiledReturnsFlowSummary({
        storageKeys: filedReturnsCurrentStateStorageKeys,
        now: () => new Date("2026-06-24T00:11:00.000Z"),
      });

      expect(summary).toMatchObject({
        status: "blocked",
        scope: ledger.scope,
        flowStep: {
          state: "blocked",
          safeSignals: expect.arrayContaining([expectedSignal, "full-fiscal-year-opfs-retained"]),
        },
      });
    },
  );

  it("shows unresolved target review before durable full-year ZIP recovery", async () => {
    const ledger = createDurableZipPhaseLedger("export-retry-pending");
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === "pack:full-fiscal-year-ledger") return { [key]: ledger };
      if (key === "pack:filed-returns-target-review") {
        return {
          [key]: {
            schemaVersion: "1.0",
            targetId: "GSTR-3B:2026-27:May",
            status: "download-unconfirmed",
            scope: {
              financialYear: "2026-27",
              period: "May",
              returnType: "GSTR-3B",
            },
            safeSignals: ["browser-download-not-observed"],
            safeMessage: "The browser download was not confirmed.",
            updatedAt: "2026-06-24T00:10:00.000Z",
          },
        };
      }
      return {};
    });
    browserMocks.storage.session.get.mockResolvedValue({});

    const summary = await readCurrentFiledReturnsFlowSummary({
      storageKeys: filedReturnsCurrentStateStorageKeys,
      now: () => new Date("2026-06-24T00:11:00.000Z"),
    });

    expect(summary).toMatchObject({
      scope: { period: "May" },
      status: "blocked",
      flowStep: { safeSignals: ["filed-returns-target-review-required"] },
    });
  });

  it("prefers a newer single-period summary over a completed full-year ledger", async () => {
    const sessionSummary: FiledReturnsFlowSummary = {
      scope: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      },
      status: "complete",
      completedAt: "2026-06-24T00:10:00.000Z",
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
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              ledgerId: "ledger-complete",
              revision: 2,
              status: "complete",
              scope: {
                financialYear: "2026-27",
                period: FULL_FISCAL_YEAR_PERIOD,
                returnType: "GSTR-3B",
              },
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:00:00.000Z",
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "downloaded",
                  attempts: 1,
                  safeSignals: [],
                  safeMessage: "Downloaded.",
                  updatedAt: "2026-06-24T00:00:00.000Z",
                  completedAt: "2026-06-24T00:00:00.000Z",
                },
              ],
            },
          }
        : {},
    );
    browserMocks.storage.session.get.mockResolvedValue({
      "pack:last-filed-returns-flow-summary": sessionSummary,
    });

    const summary = await readCurrentFiledReturnsFlowSummary({
      storageKeys: filedReturnsCurrentStateStorageKeys,
      now: () => new Date("2026-06-24T00:11:00Z"),
    });

    expect(summary).toMatchObject({
      status: "complete",
      currentPeriod: "May",
      completedPeriods: ["May"],
      totalPeriods: 1,
      scope: {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
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

function createDurableZipPhaseLedger(
  zipPhase: NonNullable<FiledReturnsFullFiscalYearLedger["zipPhase"]>,
): FiledReturnsFullFiscalYearLedger {
  const updatedAt = "2026-06-24T00:10:00.000Z";
  return {
    schemaVersion: "1.0",
    ledgerId: "ledger-durable-zip-phase",
    revision: 4,
    status: zipPhase === "cleaned" ? "complete" : "blocked",
    zipPhase,
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt,
    targets: [
      {
        targetId: "GSTR-3B:2026-27:April",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
        status: "downloaded",
        attempts: 1,
        safeSignals: ["full-fiscal-year-opfs-staged:PDF"],
        safeMessage: "Staged.",
        updatedAt,
        completedAt: updatedAt,
      },
    ],
  };
}
