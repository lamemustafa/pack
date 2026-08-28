import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/connectors/gst/filed-returns-contracts";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  createFullFiscalYearLedger,
  isFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import {
  filedReturnsPlanStorageKey,
  persistLedger,
  readLedgerForScope,
  readLedgersWithPendingZipDownload,
  readPlanLedgersStorageState,
  removeLedger,
} from "../../src/background/filed-returns-full-fiscal-year-run-state";
import { persistCanonicalFiledReturnsFlowSummary } from "../../src/background/filed-returns-session-summary";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { clearPackLocalDataWithRecoveryGuard } from "../../src/background/local-data";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
  RECOVERY_SCOPE,
  RECOVERY_TARGET_STATUSES,
} from "./full-year-completion-fixtures.test-helpers";

const storage = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
}));
const mocks = vi.hoisted(() => {
  const area = (name: "local" | "session") => ({
    get: vi.fn(async (key?: string | string[] | null) => {
      if (key == null) return structuredClone(storage[name]);
      return Object.fromEntries(
        (Array.isArray(key) ? key : [key]).map((entry) => [
          entry,
          structuredClone(storage[name][entry]),
        ]),
      );
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(storage[name], structuredClone(values));
    }),
    remove: vi.fn(async (key: string | string[]) => {
      for (const entry of Array.isArray(key) ? key : [key]) delete storage[name][entry];
    }),
    clear: vi.fn(async () => {
      storage[name] = {};
    }),
  });
  return {
    local: area("local"),
    session: area("session"),
    discardAll: vi.fn(async () => ["filed-returns-opfs-cleared"]),
    discardFullYear: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
    discardSingle: vi.fn(async () => ["single-period-opfs-cleared"]),
    download: vi.fn(),
    executeScript: vi.fn(),
    sendMessage: vi.fn(),
  };
});
vi.mock("wxt/browser", () => ({
  browser: {
    storage: mocks,
    downloads: { download: mocks.download },
    scripting: { executeScript: mocks.executeScript },
    tabs: { sendMessage: mocks.sendMessage },
  },
}));
vi.mock("../../src/background/filed-returns-staged-zip", () => ({
  discardAllFiledReturnsStaging: mocks.discardAll,
}));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => ({
  discardFullFiscalYearFiledReturnsZip: mocks.discardFullYear,
}));
vi.mock("../../src/background/filed-returns-single-period-zip", () => ({
  discardSinglePeriodFiledReturnsZip: mocks.discardSingle,
}));

const storageKeys = {
  activeRun: "active",
  completion: "completion",
  fullFiscalYearLedger: "legacy",
  fullFiscalYearLedgerIndex: "index",
  targetReview: "review",
};
const deps = {
  storageKeys,
  now: () => RECOVERY_NOW,
  clearableLocalStorageKeys: Object.values(storageKeys),
};
function indexKey(ledger: FiledReturnsFullFiscalYearLedger): string {
  return [ledger.scope.returnType, ledger.scope.financialYear, ledger.scope.artifactType].join(":");
}
function install(...ledgers: FiledReturnsFullFiscalYearLedger[]) {
  for (const ledger of ledgers) expect(isFullFiscalYearLedger(ledger)).toBe(true);
  storage.local = {
    index: {
      schemaVersion: "1.0",
      ledgerIdsByScope: Object.fromEntries(
        ledgers.map((ledger) => [indexKey(ledger), ledger.ledgerId]),
      ),
    },
    ...Object.fromEntries(
      ledgers.map((ledger) => [
        filedReturnsPlanStorageKey(ledger.ledgerId),
        structuredClone(ledger),
      ]),
    ),
    unrelated: { keep: true },
  };
}
function settled(id: string, financialYear = "2025-26"): FiledReturnsFullFiscalYearLedger {
  const ledger = createFullFiscalYearLedger({ ...RECOVERY_SCOPE, financialYear }, RECOVERY_NOW, [
    "April",
  ]);
  return {
    ...ledger,
    ledgerId: id,
    status: "complete",
    zipPhase: "cleaned-without-export",
    targets: ledger.targets.map((target) => ({
      ...target,
      status: "not-filed",
      ...canonicalDurableTargetStatus(target, "not-filed", ["filed-return-positively-not-filed"]),
    })),
  };
}
function expectReadOnly(before: typeof storage) {
  expect(storage).toEqual(before);
  for (const action of [
    mocks.local.set,
    mocks.local.remove,
    mocks.session.remove,
    mocks.session.clear,
    mocks.discardAll,
    mocks.discardFullYear,
    mocks.discardSingle,
    mocks.download,
    mocks.executeScript,
    mocks.sendMessage,
  ])
    expect(action).not.toHaveBeenCalled();
  // The canonical summary reader re-saves its redacted session value. The
  // snapshot above proves it changes neither that value nor any durable plan.
}

async function storeSinglePeriodSummary() {
  expect(
    await persistCanonicalFiledReturnsFlowSummary("completion", {
      scope: { ...RECOVERY_SCOPE, period: "March" },
      status: "complete",
      completedAt: RECOVERY_NOW.toISOString(),
      currentPeriod: "March",
      completedPeriods: ["March"],
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: ["filed-return-positively-not-filed"],
        safeMessage: "The selected return is not filed.",
      },
    }),
  ).not.toBeNull();
}

describe("reconciled indexed plan recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.local = {};
    storage.session = {};
  });

  describe.each(["missing", "single-period", "other-plan"] as const)(
    "with %s session summary",
    (session) => {
      it.each(RECOVERY_TARGET_STATUSES)(
        "keeps indexed %s recovery visible without rewriting it",
        async (status) => {
          const ledger = makeCompletedRecoveryLedger(status);
          const other = settled("full-fiscal-year-00000031", "2024-25");
          install(ledger, other);
          if (session === "other-plan") {
            expect(
              await persistCanonicalFiledReturnsFlowSummary(
                "completion",
                summariseFullFiscalYearLedger(other, RECOVERY_NOW),
              ),
            ).not.toBeNull();
          } else if (session === "single-period") {
            await storeSinglePeriodSummary();
          }
          vi.clearAllMocks();
          const before = structuredClone(storage);
          const summary = await readCurrentFiledReturnsFlowSummary(deps);
          expect(summary).toMatchObject({
            status: "blocked",
            scope: ledger.scope,
            updatedAt: ledger.updatedAt,
            fullFiscalYearRecovery: {
              ledgerId: ledger.ledgerId,
              targetId: ledger.targets[0]!.targetId,
              expectedRevision: ledger.revision,
              targetStatus: status,
            },
          });
          expect(summary).not.toHaveProperty("completedAt");
          expectReadOnly(before);
        },
      );
    },
  );

  it.each([
    "downloaded-cleanup-pending",
    "no-artifacts-cleanup-pending",
    "legacy-cleanup-pending",
  ] as const)(
    "keeps indexed %s authoritative over a newer single-period summary",
    async (zipPhase) => {
      const ledger = {
        ...makeCompletedRecoveryLedger("not-filed", {
          stagedPositive: zipPhase !== "no-artifacts-cleanup-pending",
        }),
        status: "blocked" as const,
        zipPhase,
      };
      install(ledger);
      await storeSinglePeriodSummary();
      vi.clearAllMocks();
      const before = structuredClone(storage);
      const summary = await readCurrentFiledReturnsFlowSummary(deps);
      expect(summary).toMatchObject({
        status: "blocked",
        scope: ledger.scope,
        flowStep: { safeSignals: expect.arrayContaining(["full-fiscal-year-local-cleanup-retry"]) },
      });
      expect(parseDurableFiledReturnsFlowSummary(summary)).toMatchObject({ status: "blocked" });
      expect(await clearPackLocalDataWithRecoveryGuard(deps)).toMatchObject({ ok: false });
      expectReadOnly(before);
    },
  );

  it("projects a complete legacy aggregate as blocked while staging cleanup remains", async () => {
    const ledger = makeCompletedRecoveryLedger("not-filed", { stagedPositive: true });
    install(ledger);
    await storeSinglePeriodSummary();
    vi.clearAllMocks();
    const before = structuredClone(storage);
    const summary = await readCurrentFiledReturnsFlowSummary(deps);
    expect(summary).toMatchObject({
      status: "blocked",
      scope: ledger.scope,
      updatedAt: ledger.updatedAt,
      flowStep: { safeSignals: expect.arrayContaining(["full-fiscal-year-local-cleanup-retry"]) },
    });
    expect(summary).not.toHaveProperty("completedAt");
    expect(parseDurableFiledReturnsFlowSummary(summary)).toMatchObject({ status: "blocked" });
    expectReadOnly(before);
  });

  it.each(["blocked", "partial"] as const)(
    "preserves an ordinary %s manually-observed indexed target",
    async (status) => {
      const ledger = { ...makeCompletedRecoveryLedger("manually-observed"), status };
      install(ledger);
      await storeSinglePeriodSummary();
      vi.clearAllMocks();
      const before = structuredClone(storage);
      expect(await readCurrentFiledReturnsFlowSummary(deps)).toMatchObject({
        status,
        scope: ledger.scope,
        fullFiscalYearRecovery: { ledgerId: ledger.ledgerId, targetStatus: "manually-observed" },
      });
      expect(await clearPackLocalDataWithRecoveryGuard(deps)).toMatchObject({ ok: false });
      expectReadOnly(before);
    },
  );

  describe.each(["valid", "missing-index", "orphan", "malformed-index"] as const)(
    "with %s plan storage",
    (shape) => {
      it.each(RECOVERY_TARGET_STATUSES)(
        "protects individually valid indexed %s recovery from broad clear",
        async (status) => {
          const ledger = makeCompletedRecoveryLedger(status);
          install(ledger);
          if (shape === "missing-index") delete storage.local.index;
          if (shape === "orphan")
            storage.local[filedReturnsPlanStorageKey("full-fiscal-year-00000099")] = {};
          if (shape === "malformed-index") storage.local.index = { schemaVersion: "invalid" };
          const before = structuredClone(storage);
          expect(await clearPackLocalDataWithRecoveryGuard(deps)).toMatchObject({
            ok: false,
            error: expect.stringContaining("unresolved filed-return recovery"),
          });
          expectReadOnly(before);
        },
      );
    },
  );

  it("clears settled plan records and their index together while preserving unrelated storage", async () => {
    const first = settled("full-fiscal-year-00000031");
    const other = settled("full-fiscal-year-00000032", "2024-25");
    install(first, other);
    expect(await clearPackLocalDataWithRecoveryGuard(deps)).toEqual({ ok: true, cleared: true });
    expect(mocks.discardFullYear.mock.calls).toEqual([[first.ledgerId], [other.ledgerId]]);
    expect(storage.local).toEqual({ unrelated: { keep: true } });
    expect(await readPlanLedgersStorageState(deps)).toEqual({ state: "valid", ledgers: [] });
  });

  it("replaces only the settled same-scope record without orphaning it or erasing another plan", async () => {
    const previous = settled("full-fiscal-year-00000031");
    const other = settled("full-fiscal-year-00000032", "2024-25");
    const replacement = settled("full-fiscal-year-00000033");
    install(previous, other);
    await persistLedger(deps, replacement);
    expect(storage.local[filedReturnsPlanStorageKey(previous.ledgerId)]).toBeUndefined();
    expect(storage.local[filedReturnsPlanStorageKey(other.ledgerId)]).toEqual(other);
    expect(await readLedgerForScope(deps, previous.scope)).toEqual(replacement);
    expect(await readPlanLedgersStorageState(deps)).toEqual({
      state: "valid",
      ledgers: [replacement, other],
    });
    await removeLedger(deps, previous);
    expect(await readLedgerForScope(deps, replacement.scope)).toEqual(replacement);
  });

  it("keeps a plan recoverable when removing its index cannot persist", async () => {
    const ledger = settled("full-fiscal-year-00000031");
    install(ledger);
    mocks.local.set.mockRejectedValueOnce(new Error("synthetic index write failure"));

    await expect(removeLedger(deps, ledger)).rejects.toThrow("synthetic index write failure");

    expect(storage.local[filedReturnsPlanStorageKey(ledger.ledgerId)]).toEqual(ledger);
    expect(await readLedgerForScope(deps, ledger.scope)).toEqual(ledger);
  });

  it.each(RECOVERY_TARGET_STATUSES)(
    "does not overwrite a prior %s recovery plan",
    async (status) => {
      const previous = makeCompletedRecoveryLedger(status);
      install(previous);
      const before = structuredClone(storage);
      await expect(persistLedger(deps, settled("full-fiscal-year-00000033"))).rejects.toThrow(
        "resolve the saved plan",
      );
      expectReadOnly(before);
    },
  );

  it.each([
    "download-intent-persisted",
    "download-observing",
    "downloaded-cleanup-pending",
  ] as const)("does not overwrite a %s ZIP owner", async (zipPhase) => {
    const previous = {
      ...settled("full-fiscal-year-00000031"),
      status: "blocked" as const,
      zipPhase,
      ...(zipPhase === "download-observing"
        ? { zipDownloadAttempt: { requestedAt: RECOVERY_NOW.toISOString(), downloadId: 81 } }
        : zipPhase === "download-intent-persisted"
          ? { zipDownloadAttempt: { requestedAt: RECOVERY_NOW.toISOString() } }
          : {}),
    };
    install(previous);
    const before = structuredClone(storage);
    await expect(persistLedger(deps, settled("full-fiscal-year-00000033"))).rejects.toThrow(
      "resolve the saved plan",
    );
    expectReadOnly(before);
  });

  it("preserves both prior records if the replacement index write fails", async () => {
    install(settled("full-fiscal-year-00000031"), settled("full-fiscal-year-00000032", "2024-25"));
    const before = structuredClone(storage);
    mocks.local.set.mockRejectedValueOnce(new Error("synthetic write failure"));
    await expect(persistLedger(deps, settled("full-fiscal-year-00000033"))).rejects.toThrow(
      "synthetic write failure",
    );
    expect(storage).toEqual(before);
    expect(mocks.local.remove).not.toHaveBeenCalled();
  });

  it("keeps a failed superseded-record removal visible as malformed instead of hiding it", async () => {
    const previous = settled("full-fiscal-year-00000031");
    const replacement = settled("full-fiscal-year-00000033");
    install(previous);
    mocks.local.remove.mockRejectedValueOnce(new Error("synthetic remove failure"));
    await expect(persistLedger(deps, replacement)).rejects.toThrow("synthetic remove failure");
    expect(storage.local[filedReturnsPlanStorageKey(previous.ledgerId)]).toEqual(previous);
    expect(storage.local[filedReturnsPlanStorageKey(replacement.ledgerId)]).toEqual(replacement);
    expect(await readPlanLedgersStorageState(deps)).toEqual({ state: "malformed" });
  });

  it("rejects a scope index pointing to a different valid plan without returning or replacing it", async () => {
    const ledger = settled("full-fiscal-year-00000031", "2024-25");
    install(ledger);
    storage.local.index = {
      schemaVersion: "1.0",
      ledgerIdsByScope: { "GSTR-3B:2025-26:PDF": ledger.ledgerId },
    };
    const before = structuredClone(storage);
    expect(await readLedgerForScope(deps, RECOVERY_SCOPE)).toBeNull();
    expect(await readPlanLedgersStorageState(deps)).toEqual({ state: "malformed" });
    await expect(persistLedger(deps, settled("full-fiscal-year-00000033"))).rejects.toThrow(
      "verify the saved plan index",
    );
    expectReadOnly(before);
  });

  it.each(["scope-mismatch", "id-mismatch", "unindexed"] as const)(
    "does not adopt a pending ZIP with %s ownership",
    async (shape) => {
      const ledger = {
        ...settled("full-fiscal-year-00000031"),
        status: "blocked" as const,
        zipPhase: "download-observing" as const,
        zipDownloadAttempt: { requestedAt: RECOVERY_NOW.toISOString(), downloadId: 81 },
      };
      install(ledger);
      if (shape === "scope-mismatch")
        storage.local.index = {
          schemaVersion: "1.0",
          ledgerIdsByScope: { "GSTR-3B:2024-25:PDF": ledger.ledgerId },
        };
      if (shape === "id-mismatch")
        storage.local[filedReturnsPlanStorageKey(ledger.ledgerId)] = {
          ...ledger,
          ledgerId: "full-fiscal-year-00000032",
        };
      if (shape === "unindexed")
        storage.local.index = { schemaVersion: "1.0", ledgerIdsByScope: {} };
      const before = structuredClone(storage);
      expect(await readLedgersWithPendingZipDownload(deps, 81)).toEqual([]);
      expectReadOnly(before);
    },
  );

  it("returns only the exact indexed owner of a pending ZIP ID", async () => {
    const ledger = {
      ...settled("full-fiscal-year-00000031"),
      status: "blocked" as const,
      zipPhase: "download-observing" as const,
      zipDownloadAttempt: { requestedAt: RECOVERY_NOW.toISOString(), downloadId: 81 },
    };
    install(ledger);
    const before = structuredClone(storage);
    expect(await readLedgersWithPendingZipDownload(deps, 81)).toEqual([ledger]);
    expect(await readLedgersWithPendingZipDownload(deps, 82)).toEqual([]);
    expectReadOnly(before);
  });

  it.each(["missing-index", "present-index", "unrelated-legacy", "same-id-other-scope"] as const)(
    "removes only the matching legacy record alongside plan cleanup with %s",
    async (shape) => {
      const ledger = settled("full-fiscal-year-00000031");
      const other = settled("full-fiscal-year-00000032", "2024-25");
      install(ledger, other);
      if (shape === "missing-index") {
        delete storage.local.index;
        delete storage.local[filedReturnsPlanStorageKey(ledger.ledgerId)];
        delete storage.local[filedReturnsPlanStorageKey(other.ledgerId)];
      }
      const legacy =
        shape === "same-id-other-scope"
          ? { ...other, ledgerId: ledger.ledgerId }
          : shape === "unrelated-legacy"
            ? other
            : ledger;
      storage.local.legacy = structuredClone(legacy);
      await removeLedger(deps, ledger);
      expect(storage.local[filedReturnsPlanStorageKey(ledger.ledgerId)]).toBeUndefined();
      if (shape === "unrelated-legacy" || shape === "same-id-other-scope")
        expect(storage.local.legacy).toEqual(legacy);
      else expect(storage.local.legacy).toBeUndefined();
      if (shape !== "missing-index") {
        expect(storage.local[filedReturnsPlanStorageKey(other.ledgerId)]).toEqual(other);
        expect(await readPlanLedgersStorageState(deps)).toEqual({
          state: "valid",
          ledgers: [other],
        });
      }
      expect(storage.local.unrelated).toEqual({ keep: true });
    },
  );
});
