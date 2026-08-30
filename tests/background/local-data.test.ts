import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
} from "../../src/connectors/gst/filed-returns-contracts";
import { acquireFiledReturnsRun } from "../../src/background/filed-returns-active-run";
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";
import { clearPackLocalDataWithRecoveryGuard } from "../../src/background/local-data";
import {
  FULL_FISCAL_YEAR_PLAN_VERSION,
  isFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-validation";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import { readPlanLedgersStorageState } from "../../src/background/filed-returns-full-fiscal-year-run-state";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { createAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import {
  allSupportedFullFiscalYearPlanRootKey,
  allSupportedFullFiscalYearPlanStorageKey,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state";
import { isAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";

const filedReturnsCurrentStateStorageKeys = {
  activeRun: "pack:active-filed-returns-run",
  completion: "pack:last-filed-returns-flow-summary",
  fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
  targetReview: "pack:filed-returns-target-review",
};

const fullFiscalYearLedgerIds = {
  complete: "full-fiscal-year-00000002",
  durableZipPhase: "full-fiscal-year-00000003",
  existing: "full-fiscal-year-00000001",
  readyForZipRetry: "full-fiscal-year-00000004",
  recoverable: "full-fiscal-year-00000005",
} as const;
const singlePeriodLedgerIds = {
  clearWins: "single-period:00000004-clear",
  local: "single-period:00000001-local",
  recoverable: "single-period:00000002-local",
  startWins: "single-period:00000003-start",
} as const;
const activeRunId = "filed-returns-run-00000001";
const historicalFilenameCases = [
  [
    "download-filename-overridden",
    "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file.",
  ],
  [
    "download-filename-unavailable",
    "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
  ],
] as const;

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
      remove: vi.fn(async () => undefined),
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
  discardAllFiledReturnsStaging: vi.fn(async () => ["filed-returns-opfs-cleared"]),
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
  discardSinglePeriodFiledReturnsZip: vi.fn(async () => ["single-period-opfs-cleared"]),
}));

vi.mock("wxt/browser", () => ({
  browser: browserMocks,
}));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => ({
  discardFullFiscalYearFiledReturnsZip: zipMocks.discardFullFiscalYearFiledReturnsZip,
}));
vi.mock("../../src/background/filed-returns-single-period-zip", () => ({
  discardSinglePeriodFiledReturnsZip: zipMocks.discardSinglePeriodFiledReturnsZip,
}));
vi.mock("../../src/background/filed-returns-staged-zip", () => ({
  discardAllFiledReturnsStaging: zipMocks.discardAllFiledReturnsStaging,
}));

describe("Pack local data clearing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    browserMocks.storage.local.get.mockReset().mockResolvedValue({});
    browserMocks.storage.local.remove.mockReset().mockResolvedValue(undefined);
    browserMocks.storage.local.set.mockReset().mockResolvedValue(undefined);
    browserMocks.storage.local.setAccessLevel.mockReset().mockResolvedValue(undefined);
    browserMocks.storage.session.clear.mockReset().mockResolvedValue(undefined);
    browserMocks.storage.session.get.mockReset().mockResolvedValue({});
    browserMocks.storage.session.remove.mockReset().mockResolvedValue(undefined);
    browserMocks.storage.session.set.mockReset().mockResolvedValue(undefined);
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockReset();
    zipMocks.discardSinglePeriodFiledReturnsZip.mockReset();
    zipMocks.discardAllFiledReturnsStaging.mockReset();
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValue([
      "full-fiscal-year-opfs-cleared",
    ]);
    zipMocks.discardSinglePeriodFiledReturnsZip.mockResolvedValue(["single-period-opfs-cleared"]);
    zipMocks.discardAllFiledReturnsStaging.mockResolvedValue(["filed-returns-opfs-cleared"]);
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

  it("clears each indexed plan's staged files before deleting dynamic plan records", async () => {
    const ledger = createDurableZipPhaseLedger("cleaned");
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const indexKey = "pack:full-fiscal-year-ledger-index";
    const planKey = `pack:filed-returns-plan:${ledger.ledgerId}`;
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === indexKey) {
        return {
          [indexKey]: {
            schemaVersion: "1.0",
            ledgerIdsByScope: { "GSTR-3B:2026-27:PDF": ledger.ledgerId },
          },
        };
      }
      if (key === planKey) return { [planKey]: ledger };
      if (key == null) {
        return {
          [indexKey]: {
            schemaVersion: "1.0",
            ledgerIdsByScope: { "GSTR-3B:2026-27:PDF": ledger.ledgerId },
          },
          [planKey]: ledger,
        };
      }
      return {};
    });
    const background = await import("../../src/entrypoints/background");

    await expect(
      readPlanLedgersStorageState({
        storageKeys: {
          fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
          fullFiscalYearLedgerIndex: indexKey,
        },
      }),
    ).resolves.toEqual({ state: "valid", ledgers: [ledger] });

    await expect(background.clearPackLocalData()).resolves.toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardAllFiledReturnsStaging).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(ledger.ledgerId);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith([planKey, indexKey]);
  });

  it("lets the explicit local-data clear discard an unresolved all-supported plan only after staged files clear", async () => {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected supported full-year return plan");
    const planRoot = {
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear: "2025-26",
    } as const;
    const ledger = {
      ...createAllSupportedFullFiscalYearLedger(
        planRoot,
        expansion.targets,
        FILED_RETURNS_MONTHS.slice(0, 1),
        new Date("2026-08-27T00:00:00.000Z"),
      ),
      status: "blocked" as const,
    };
    expect(isAllSupportedFullFiscalYearLedger(ledger)).toBe(true);
    const indexKey = "pack:all-supported-full-fiscal-year-ledger-index";
    const planKey = allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId);
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key == null) {
        return {
          [indexKey]: {
            schemaVersion: "1.0",
            ledgerIdsByPlanRoot: {
              [allSupportedFullFiscalYearPlanRootKey(planRoot)]: ledger.ledgerId,
            },
          },
          [planKey]: ledger,
        };
      }
      return {};
    });
    const background = await import("../../src/entrypoints/background");

    await expect(background.clearPackLocalData()).resolves.toEqual({ ok: true, cleared: true });

    expect(zipMocks.discardAllFiledReturnsStaging).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(ledger.ledgerId);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith([planKey, indexKey]);
  });

  it("broad-clears OPFS before deleting an orphaned dynamic plan record", async () => {
    const ledger = createDurableZipPhaseLedger("cleaned");
    const planKey = `pack:filed-returns-plan:${ledger.ledgerId}`;
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === null) return { [planKey]: ledger };
      return {};
    });
    const background = await import("../../src/entrypoints/background");

    await expect(background.clearPackLocalData()).resolves.toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardAllFiledReturnsStaging).toHaveBeenCalledOnce();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith([
      planKey,
      "pack:full-fiscal-year-ledger-index",
    ]);
  });

  it("broad-clears OPFS when an index leaves an extra dynamic plan record unowned", async () => {
    const ledger = createDurableZipPhaseLedger("cleaned");
    const orphan = { ...ledger, ledgerId: "full-fiscal-year-00000006" };
    const indexKey = "pack:full-fiscal-year-ledger-index";
    const planKey = `pack:filed-returns-plan:${ledger.ledgerId}`;
    const orphanKey = `pack:filed-returns-plan:${orphan.ledgerId}`;
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === null) {
        return {
          [indexKey]: {
            schemaVersion: "1.0",
            ledgerIdsByScope: { "GSTR-3B:2026-27:PDF": ledger.ledgerId },
          },
          [planKey]: ledger,
          [orphanKey]: orphan,
        };
      }
      return {};
    });
    const background = await import("../../src/entrypoints/background");

    await expect(background.clearPackLocalData()).resolves.toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardAllFiledReturnsStaging).toHaveBeenCalledOnce();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith([planKey, orphanKey, indexKey]);
  });

  it("refuses local-data clearing while a direct artifact checkpoint still owns recovery", async () => {
    browserMocks.storage.session.get.mockResolvedValue({
      "pack.artifact-acquisition.v2.GSTR-3B.2025-26.May.PDF": {
        requestId: "opaque-request",
        state: "download-observing",
      },
    });
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

  it("refuses broad local-data clearing while a full-year recovery target is unresolved", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
              ledgerId: fullFiscalYearLedgerIds.existing,
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
              eligibleThrough: "April",
              targetPlan: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                },
              ],
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "download-unconfirmed",
                  attempts: 1,
                  ...durableGstr3bTargetStatus("April", "download-unconfirmed", [
                    "browser-download-size-unknown",
                  ]),
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

  it.each(historicalFilenameCases)(
    "keeps current-state recovery visible for historical filename cache %s",
    async (signal, oldCopy) => {
      const ledger = historicalFilenameRecoveryLedger(signal, oldCopy);
      const state = installStatefulLocalStorage({
        [filedReturnsCurrentStateStorageKeys.fullFiscalYearLedger]: ledger,
      });

      const summary = await readCurrentFiledReturnsFlowSummary({
        storageKeys: filedReturnsCurrentStateStorageKeys,
        now: () => new Date("2026-06-24T00:01:00.000Z"),
      });

      expect(summary).toMatchObject({
        status: "blocked",
        scope: ledger.scope,
        currentPeriod: "April",
        completedPeriods: [],
        fullFiscalYearRecovery: {
          ledgerId: fullFiscalYearLedgerIds.existing,
          targetId: "GSTR-3B:2026-27:April",
          expectedRevision: 2,
          targetStatus: "download-unconfirmed",
        },
        flowStep: {
          state: "user-action-required",
          safeSignals: ["full-fiscal-year-download-unconfirmed"],
        },
      });
      expect(summary?.flowStep.safeMessage).not.toContain("Pack completed the download");
      expect(state[filedReturnsCurrentStateStorageKeys.fullFiscalYearLedger]).toEqual(ledger);
      expect(browserMocks.downloads.download).not.toHaveBeenCalled();
      expect(browserMocks.tabs.sendMessage).not.toHaveBeenCalled();
      expect(browserMocks.scripting.executeScript).not.toHaveBeenCalled();
      expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
      expect(zipMocks.discardAllFiledReturnsStaging).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
      expect(zipMocks.discardSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    },
  );

  it.each(historicalFilenameCases)(
    "protects unresolved historical filename cache %s from broad local clear",
    async (signal, oldCopy) => {
      const ledger = historicalFilenameRecoveryLedger(signal, oldCopy);
      const state = installStatefulLocalStorage({
        [filedReturnsCurrentStateStorageKeys.fullFiscalYearLedger]: ledger,
      });

      const response = await clearPackLocalDataWithRecoveryGuard(localDataRaceDeps());

      expect(response).toEqual({
        ok: false,
        error:
          "Pack has unresolved filed-return recovery state. Cancel or resolve the run before clearing local data.",
      });
      expect(state[filedReturnsCurrentStateStorageKeys.fullFiscalYearLedger]).toEqual(ledger);
      expect(browserMocks.storage.session.clear).not.toHaveBeenCalled();
      expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
      expect(zipMocks.discardAllFiledReturnsStaging).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
      expect(zipMocks.discardSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    },
  );

  it.each([
    "export-pending",
    "export-retry-pending",
    "download-intent-persisted",
    "download-observing",
    "download-started",
    "restaging-required",
    "downloaded-cleanup-pending",
    "no-artifacts-cleanup-pending",
    "legacy-cleanup-pending",
  ] as const)(
    "refuses local-data clearing for a valid durable ZIP phase (%s)",
    async (zipPhase) => {
      const ledger = createDurableZipPhaseLedger(zipPhase);
      browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
        key === "pack:full-fiscal-year-ledger" ? { [key]: ledger } : {},
      );
      const background = await import("../../src/entrypoints/background");

      const response = await background.clearPackLocalData();

      expect(response).toEqual({
        ok: false,
        error:
          "Pack has unresolved filed-return recovery state. Cancel or resolve the run before clearing local data.",
      });
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
      expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    },
  );

  it("clears retained full-year files before removing a completed ledger", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
              eligibleThrough: "April",
              ledgerId: fullFiscalYearLedgerIds.complete,
              revision: 3,
              status: "complete",
              scope: {
                financialYear: "2026-27",
                period: FULL_FISCAL_YEAR_PERIOD,
                returnType: "GSTR-3B",
              },
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:01:00.000Z",
              targetPlan: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                },
              ],
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "downloaded",
                  attempts: 1,
                  ...durableGstr3bTargetStatus("April", "downloaded", [
                    "full-fiscal-year-opfs-staged:PDF",
                  ]),
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
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(
      fullFiscalYearLedgerIds.complete,
    );
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it("clears durably recorded single-period staging before removing local state", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:single-period-staging"
        ? {
            [key]: {
              ledgerId: singlePeriodLedgerIds.local,
              schemaVersion: "1.0",
            },
          }
        : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledWith(
      singlePeriodLedgerIds.local,
    );
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it("keeps local state when single-period staging ownership cannot be verified", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === "pack:single-period-staging") throw new Error("synthetic storage failure");
      return {};
    });
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({
      ok: false,
      error:
        "Pack could not verify temporary selected-file staging. Retry clearing local data before removing saved state.",
    });
    expect(browserMocks.storage.session.clear).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("keeps local state when retained artifact-acquisition recovery cannot be read", async () => {
    browserMocks.storage.session.get.mockRejectedValueOnce(
      new Error("synthetic retained-checkpoint read failure"),
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({
      ok: false,
      error:
        "Pack could not verify retained artifact recovery. Retry clearing local data before removing saved state.",
    });
    expect(browserMocks.storage.session.clear).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("recovers an explicit local-data reset from malformed staging metadata", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:single-period-staging" ? { [key]: { schemaVersion: "unexpected" } } : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardAllFiledReturnsStaging).toHaveBeenCalledTimes(1);
    expect(zipMocks.discardSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.clear).toHaveBeenCalledTimes(1);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it("clears a safe opaque ledger id recovered from malformed staging metadata", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:single-period-staging"
        ? {
            [key]: {
              ledgerId: singlePeriodLedgerIds.recoverable,
              schemaVersion: "unexpected",
            },
          }
        : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardSinglePeriodFiledReturnsZip).toHaveBeenCalledWith(
      singlePeriodLedgerIds.recoverable,
    );
  });

  it("does not delete full-year staging when single-period cleanup fails", async () => {
    zipMocks.discardSinglePeriodFiledReturnsZip.mockResolvedValueOnce([
      "single-period-opfs-clear-failed",
    ]);
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) => {
      if (key === "pack:single-period-staging") {
        return {
          [key]: {
            ledgerId: singlePeriodLedgerIds.local,
            schemaVersion: "1.0",
          },
        };
      }
      if (key === "pack:full-fiscal-year-ledger") {
        return {
          [key]: {
            schemaVersion: "1.0",
            ledgerId: fullFiscalYearLedgerIds.complete,
            revision: 3,
            status: "complete",
            scope: {
              financialYear: "2026-27",
              period: FULL_FISCAL_YEAR_PERIOD,
              returnType: "GSTR-3B",
            },
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:01:00.000Z",
            targets: [],
          },
        };
      }
      return {};
    });
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({
      ok: false,
      error:
        "Pack could not clear temporary selected-file staging. Retry clearing local data before removing saved state.",
    });
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.clear).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("keeps local state when retained full-year files cannot be cleared", async () => {
    zipMocks.discardFullFiscalYearFiledReturnsZip.mockResolvedValueOnce([
      "full-fiscal-year-opfs-clear-failed",
    ]);
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
              eligibleThrough: "April",
              ledgerId: fullFiscalYearLedgerIds.complete,
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
                  ...durableGstr3bTargetStatus("April", "downloaded", [
                    "full-fiscal-year-opfs-staged:PDF",
                  ]),
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

  it("clears a safe full-year ledger id recovered from malformed metadata", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              ledgerId: fullFiscalYearLedgerIds.recoverable,
              schemaVersion: "unexpected",
            },
          }
        : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(
      fullFiscalYearLedgerIds.recoverable,
    );
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it.each([
    [
      "unknown ZIP phase",
      {
        ...createDurableZipPhaseLedger("download-observing"),
        zipPhase: "unknown-checkpoint",
      },
    ],
    [
      "malformed ZIP download attempt",
      {
        ...createDurableZipPhaseLedger("download-intent-persisted"),
        zipDownloadAttempt: {
          requestedAt: "not-a-timestamp",
        },
      },
    ],
  ])("keeps malformed %s explicitly clearable", async (_label, malformedLedger) => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger" ? { [key]: malformedLedger } : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).toHaveBeenCalledWith(
      fullFiscalYearLedgerIds.durableZipPhase,
    );
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it("clears all retained staging when malformed full-year metadata has no safe cleanup id", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              ledgerId: "unsafe/ledger",
              schemaVersion: "unexpected",
            },
          }
        : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(zipMocks.discardAllFiledReturnsStaging).toHaveBeenCalledTimes(1);
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(browserMocks.storage.session.clear).toHaveBeenCalledTimes(1);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it.each(["", 0, false])(
    "clears all retained staging for a falsy malformed full-year ledger (%j)",
    async (malformedLedger) => {
      browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
        key === "pack:full-fiscal-year-ledger" ? { [key]: malformedLedger } : {},
      );
      const background = await import("../../src/entrypoints/background");

      const response = await background.clearPackLocalData();

      expect(response).toEqual({ ok: true, cleared: true });
      expect(zipMocks.discardAllFiledReturnsStaging).toHaveBeenCalledTimes(1);
      expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
        background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
      );
    },
  );

  it("keeps local state when the explicit broad staging clear fails", async () => {
    zipMocks.discardAllFiledReturnsStaging.mockResolvedValueOnce([
      "filed-returns-opfs-clear-failed",
    ]);
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? { [key]: { ledgerId: "unsafe/ledger", schemaVersion: "unexpected" } }
        : {},
    );
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({
      ok: false,
      error:
        "Pack could not clear temporary filed-return staging. Retry clearing local data before removing saved state.",
    });
    expect(browserMocks.storage.session.clear).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("uses Clear local Pack data as the explicit recovery path for a malformed active run", async () => {
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:active-filed-returns-run"
        ? {
            [key]: {
              schemaVersion: "1.0",
              runId: "invalid run id",
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
    const background = await import("../../src/entrypoints/background");

    const response = await background.clearPackLocalData();

    expect(response).toEqual({ ok: true, cleared: true });
    expect(browserMocks.storage.session.clear).toHaveBeenCalledTimes(1);
    expect(browserMocks.storage.local.remove).toHaveBeenCalledWith(
      background.PACK_CLEARABLE_LOCAL_STORAGE_KEYS,
    );
  });

  it("blocks local-data clearing when run acquisition wins the operation race", async () => {
    const state = installStatefulLocalStorage({
      "pack:single-period-staging": {
        ledgerId: singlePeriodLedgerIds.startWins,
        schemaVersion: "1.0",
      },
    });
    const scope = {
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-3B" as const,
    };

    const acquired = await acquireFiledReturnsRun(scope, {
      storageKeys: { activeRun: "pack:active-filed-returns-run" },
      now: () => new Date("2026-06-24T00:00:00.000Z"),
    });
    const response = await clearPackLocalDataWithRecoveryGuard(localDataRaceDeps());

    expect(acquired).toMatchObject({ run: { scope } });
    expect(response).toEqual({
      ok: false,
      error:
        "Pack has unresolved filed-return recovery state. Cancel or resolve the run before clearing local data.",
    });
    expect(state["pack:active-filed-returns-run"]).toBeDefined();
    expect(zipMocks.discardSinglePeriodFiledReturnsZip).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
  });

  it("keeps run acquisition queued through awaited OPFS cleanup when clear wins", async () => {
    const events: string[] = [];
    const state = installStatefulLocalStorage(
      {
        "pack:single-period-staging": {
          ledgerId: singlePeriodLedgerIds.clearWins,
          schemaVersion: "1.0",
        },
      },
      events,
    );
    let signalCleanupStarted: () => void = () => undefined;
    const cleanupStarted = new Promise<void>((resolve) => {
      signalCleanupStarted = resolve;
    });
    let releaseCleanup: () => void = () => undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    zipMocks.discardSinglePeriodFiledReturnsZip.mockImplementation(async () => {
      events.push("opfs-cleanup-started");
      signalCleanupStarted();
      await cleanupGate;
      events.push("opfs-cleanup-completed");
      return ["single-period-opfs-cleared"];
    });

    const clearPromise = clearPackLocalDataWithRecoveryGuard(localDataRaceDeps());
    await cleanupStarted;
    let acquisitionSettled = false;
    const acquirePromise = acquireFiledReturnsRun(
      {
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
      },
      {
        storageKeys: { activeRun: "pack:active-filed-returns-run" },
        now: () => new Date("2026-06-24T00:00:00.000Z"),
      },
    ).then((result) => {
      acquisitionSettled = true;
      return result;
    });
    await Promise.resolve();

    expect(acquisitionSettled).toBe(false);
    expect(state["pack:active-filed-returns-run"]).toBeUndefined();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();

    releaseCleanup();
    await expect(clearPromise).resolves.toEqual({ ok: true, cleared: true });
    await expect(acquirePromise).resolves.toMatchObject({
      run: {
        scope: {
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-3B",
        },
      },
    });
    expect(events).toEqual([
      "opfs-cleanup-started",
      "opfs-cleanup-completed",
      "local-storage-removed",
      "active-run-acquired",
    ]);
    expect(state["pack:active-filed-returns-run"]).toBeDefined();
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
      completedAt: "2026-06-24T00:00:00.000Z",
      completedPeriods: ["April"],
      totalPeriods: 1,
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
              runId: activeRunId,
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
        downloadDiagnostic: positiveGstr3bDownloadDiagnostic("May", 72),
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
              runId: activeRunId,
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
              runId: activeRunId,
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
        safeMessage:
          "Pack could not confirm the final fiscal-year ZIP. Check the exact browser download before retrying.",
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          message: "Allow browser downloads for the GST Portal, then retry.",
          canResume: true,
        },
      },
    };
    browserMocks.storage.local.get.mockImplementation(async (key: unknown) =>
      key === "pack:full-fiscal-year-ledger"
        ? {
            [key]: {
              schemaVersion: "1.0",
              planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
              ledgerId: fullFiscalYearLedgerIds.readyForZipRetry,
              revision: 3,
              status: "blocked",
              scope: sessionSummary.scope,
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt,
              eligibleThrough: "April",
              targetPlan: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                },
              ],
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "downloaded",
                  attempts: 1,
                  ...durableGstr3bTargetStatus("April", "downloaded", [
                    "full-fiscal-year-opfs-staged:PDF",
                  ]),
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

    // The retained summary is preserved, and the per-period evidence is rebuilt
    // from the ledger rather than read from it. Evidence is display-only and
    // never persisted, so this path -- which returns the durable summary instead
    // of re-summarising -- would otherwise show no per-period detail in exactly
    // the state where a reader is deciding whether to retry.
    expect(summary).toEqual({
      ...sessionSummary,
      targetEvidence: expect.arrayContaining([
        expect.objectContaining({ outcome: expect.any(String), period: expect.any(String) }),
      ]),
    });
    expect(summary?.targetEvidence?.length).toBeGreaterThan(0);
  });

  it.each([
    ["export-retry-pending", "full-fiscal-year-final-zip-retry", "blocked"],
    [
      "download-intent-persisted",
      "full-fiscal-year-final-zip-manual-review",
      "download-unconfirmed",
    ],
    ["download-observing", "full-fiscal-year-final-zip-manual-review", "download-unconfirmed"],
    ["download-started", "full-fiscal-year-zip-download-unconfirmed", "download-unconfirmed"],
    ["downloaded-cleanup-pending", "full-fiscal-year-local-cleanup-retry", "blocked"],
  ] as const)(
    "reconstructs %s recovery from the local ledger after session storage is lost",
    async (zipPhase, expectedSignal, expectedState) => {
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
          state: expectedState,
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
      flowStep: {
        safeSignals: expect.arrayContaining([
          "filed-returns-target-review-required",
          "browser-download-not-observed",
        ]),
      },
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
        downloadDiagnostic: positiveGstr3bDownloadDiagnostic("May", 73),
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
              planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
              eligibleThrough: "April",
              ledgerId: fullFiscalYearLedgerIds.complete,
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
                  ...durableGstr3bTargetStatus("April", "downloaded", [
                    "full-fiscal-year-opfs-staged:PDF",
                  ]),
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
              planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
              ledgerId: fullFiscalYearLedgerIds.existing,
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
              eligibleThrough: "April",
              targetPlan: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                },
              ],
              targets: [
                {
                  targetId: "GSTR-3B:2026-27:April",
                  financialYear: "2026-27",
                  period: "April",
                  returnType: "GSTR-3B",
                  status: "running",
                  attempts: 1,
                  ...durableGstr3bTargetStatus("April", "running", []),
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
        ledgerId: fullFiscalYearLedgerIds.existing,
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

function historicalFilenameRecoveryLedger(
  signal: string,
  oldCopy: string,
): FiledReturnsFullFiscalYearLedger {
  return {
    schemaVersion: "1.0",
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    eligibleThrough: "April",
    targetPlan: [
      {
        targetId: "GSTR-3B:2026-27:April",
        financialYear: "2026-27",
        period: "April",
        returnType: "GSTR-3B",
        artifactType: "PDF",
      },
    ],
    ledgerId: fullFiscalYearLedgerIds.existing,
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
        safeSignals: ["browser-download-size-unknown", signal],
        safeMessage: `Pack could not verify the browser download for April. Check Downloads before retrying or cancelling this target. ${oldCopy}`,
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ],
  };
}

function localDataRaceDeps() {
  return {
    clearableLocalStorageKeys: [
      "pack:active-filed-returns-run",
      "pack:filed-returns-target-review",
      "pack:full-fiscal-year-ledger",
      "pack:single-period-staging",
    ],
    storageKeys: {
      activeRun: "pack:active-filed-returns-run",
      fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
      targetReview: "pack:filed-returns-target-review",
    },
  };
}

function installStatefulLocalStorage(
  initialState: Record<string, unknown>,
  events: string[] = [],
): Record<string, unknown> {
  const state = { ...initialState };
  browserMocks.storage.local.get.mockImplementation(async (keys: unknown) => {
    if (typeof keys === "string") {
      return Object.hasOwn(state, keys) ? { [keys]: state[keys] } : {};
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(
        keys
          .filter((key): key is string => typeof key === "string" && Object.hasOwn(state, key))
          .map((key) => [key, state[key]]),
      );
    }
    return { ...state };
  });
  (
    browserMocks.storage.local.set as unknown as {
      mockImplementation: (
        implementation: (values: Record<string, unknown>) => Promise<void>,
      ) => void;
    }
  ).mockImplementation(async (values) => {
    Object.assign(state, values);
    if (Object.hasOwn(values, "pack:active-filed-returns-run")) {
      events.push("active-run-acquired");
    }
  });
  (
    browserMocks.storage.local.remove as unknown as {
      mockImplementation: (implementation: (keys: string | string[]) => Promise<void>) => void;
    }
  ).mockImplementation(async (keys) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
    events.push("local-storage-removed");
  });
  return state;
}

function createDurableZipPhaseLedger(
  zipPhase: NonNullable<FiledReturnsFullFiscalYearLedger["zipPhase"]>,
): FiledReturnsFullFiscalYearLedger {
  const updatedAt = "2026-06-24T00:10:00.000Z";
  return {
    schemaVersion: "1.0",
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    eligibleThrough: "May",
    lastReconciledAt: updatedAt,
    ledgerId: fullFiscalYearLedgerIds.durableZipPhase,
    revision: 4,
    status: zipPhase === "cleaned" ? "complete" : "blocked",
    zipPhase,
    ...(zipPhase === "download-intent-persisted"
      ? { zipDownloadAttempt: { requestedAt: updatedAt } }
      : zipPhase === "download-observing"
        ? { zipDownloadAttempt: { requestedAt: updatedAt, downloadId: 81 } }
        : {}),
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt,
    targetPlan: (["April", "May"] as const).map((period) => ({
      targetId: `GSTR-3B:2026-27:${period}`,
      financialYear: "2026-27",
      period,
      returnType: "GSTR-3B" as const,
    })),
    targets: (["April", "May"] as const).map((period) => ({
      targetId: `GSTR-3B:2026-27:${period}`,
      financialYear: "2026-27",
      period,
      returnType: "GSTR-3B",
      status: "downloaded",
      attempts: 1,
      ...durableGstr3bTargetStatus(period, "downloaded", ["full-fiscal-year-opfs-staged:PDF"]),
      updatedAt,
      completedAt: updatedAt,
    })),
  };
}

function durableGstr3bTargetStatus(
  period: "April" | "May",
  status: FiledReturnsFullFiscalYearLedger["targets"][number]["status"],
  safeSignals: string[],
): {
  downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
  safeMessage: string;
  safeSignals: string[];
} {
  const durableStatus = canonicalDurableTargetStatus(
    {
      financialYear: "2026-27",
      period,
      returnType: "GSTR-3B",
    },
    status,
    safeSignals,
  );
  return status === "downloaded"
    ? { ...durableStatus, downloadDiagnostic: positiveGstr3bDownloadDiagnostic(period) }
    : durableStatus;
}

function positiveGstr3bDownloadDiagnostic(
  period: "April" | "May",
  downloadId?: number,
): FiledReturnsDownloadDiagnostic {
  return {
    actionId: `action-87654321-${period === "April" ? "april001" : "may00001"}`,
    artifactType: "PDF",
    byteCountClass: "non-empty",
    ...(downloadId !== undefined ? { downloadId } : {}),
    downloadPathClass: "captured-portal-request-data",
    endpointClass: "gstr3b-portal-blob-captured-download",
    eventType: "filed-return-download-path",
    financialYear: "2026-27",
    mimeClass: "pdf",
    period,
    returnType: "GSTR-3B",
    schemaVersion: "1.0",
    status: "downloaded",
  };
}
