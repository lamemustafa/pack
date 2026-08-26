import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { canonicalDurableSummaryMessage } from "../../src/connectors/gst/filed-returns-durable-status";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";
import { acquireFiledReturnsRun } from "../../src/background/filed-returns-active-run";
import { readCurrentFiledReturnsFlowSummary } from "../../src/background/filed-returns-current-state";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummary,
} from "../../src/background/filed-returns-session-summary";
import { persistFiledReturnsTargetReview } from "../../src/background/filed-returns-target-review";
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
        (Array.isArray(key) ? key : [key])
          .filter((entry) => Object.hasOwn(storage[name], entry))
          .map((entry) => [entry, structuredClone(storage[name][entry])]),
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
  };
});

vi.mock("wxt/browser", () => ({ browser: { storage: mocks } }));
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
  activeRun: "active-run",
  completion: "completion",
  fullFiscalYearLedger: "ledger",
  targetReview: "target-review",
};
const readDeps = { storageKeys, now: () => RECOVERY_NOW };
const clearDeps = { storageKeys, clearableLocalStorageKeys: Object.values(storageKeys) };

function expectNoDestructiveClear() {
  expect(mocks.discardAll).not.toHaveBeenCalled();
  expect(mocks.discardFullYear).not.toHaveBeenCalled();
  expect(mocks.discardSingle).not.toHaveBeenCalled();
  expect(mocks.session.clear).not.toHaveBeenCalled();
  expect(mocks.local.remove).not.toHaveBeenCalled();
}

function competingSummary(kind: "single-period" | "retained"): FiledReturnsFlowSummary {
  const retained = kind === "retained";
  const scope = retained ? RECOVERY_SCOPE : { ...RECOVERY_SCOPE, period: "March" };
  const status = retained ? "blocked" : "complete";
  const safeSignals = retained
    ? ["full-fiscal-year-final-zip-retry", "full-fiscal-year-opfs-retained"]
    : ["filed-return-positively-not-filed"];
  return {
    scope,
    status,
    updatedAt: RECOVERY_NOW.toISOString(),
    ...(retained ? {} : { completedAt: RECOVERY_NOW.toISOString(), currentPeriod: "March" }),
    completedPeriods: retained ? [...FILED_RETURNS_MONTHS] : ["March"],
    totalPeriods: retained ? 12 : 1,
    targetEvidence: [{ period: "March", outcome: "not-filed" }],
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: retained ? "blocked" : "candidate-not-found",
      safeSignals,
      safeMessage: canonicalDurableSummaryMessage(scope, status, safeSignals),
    },
  };
}

describe("stored full-year completion readers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.local = {};
    storage.session = {};
  });

  it.each(RECOVERY_TARGET_STATUSES)(
    "protects complete aggregate with %s target from clear",
    async (status) => {
      const ledger = makeCompletedRecoveryLedger(status);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      storage.local.ledger = structuredClone(ledger);

      const response = await clearPackLocalDataWithRecoveryGuard(clearDeps);

      expect.soft(response).toEqual({
        ok: false,
        error:
          "Pack has unresolved filed-return recovery state. Cancel or resolve the run before clearing local data.",
      });
      expect.soft(storage.local.ledger).toEqual(ledger);
      expectNoDestructiveClear();
    },
  );

  describe.each(["none", "single-period", "retained"] as const)(
    "against %s summary",
    (competitor) => {
      it.each(RECOVERY_TARGET_STATUSES)(
        "keeps %s recovery authoritative without rewriting the ledger",
        async (status) => {
          const ledger = makeCompletedRecoveryLedger(status, {
            stagedPositive: true,
            positiveFirst: true,
            currentPositive: true,
          });
          expect(isFullFiscalYearLedger(ledger)).toBe(true);
          storage.local.ledger = structuredClone(ledger);
          if (competitor !== "none") {
            expect(
              await persistCanonicalFiledReturnsFlowSummary(
                "completion",
                competingSummary(competitor),
              ),
            ).not.toBeNull();
            expect(storage.session.completion).not.toHaveProperty("targetEvidence");
          }

          const summary = await readCurrentFiledReturnsFlowSummary(readDeps);
          const recovery = ledger.targets[1]!;

          expect.soft(summary).toMatchObject({
            status: "blocked",
            scope: RECOVERY_SCOPE,
            currentPeriod: recovery.period,
            updatedAt: ledger.updatedAt,
            fullFiscalYearRecovery: {
              ledgerId: ledger.ledgerId,
              targetId: recovery.targetId,
              expectedRevision: ledger.revision,
              targetStatus: status,
            },
          });
          expect.soft(summary).not.toHaveProperty("completedAt");
          expect.soft(summary?.targetEvidence).toHaveLength(12);
          expect.soft(storage.local.ledger).toEqual(ledger);
          expectNoDestructiveClear();
          expect(mocks.local.set).not.toHaveBeenCalled();

          const persisted = await persistCanonicalFiledReturnsFlowSummary("completion", summary);
          expect(persisted).not.toBeNull();
          expect(persisted).toMatchObject({
            status: "blocked",
            updatedAt: ledger.updatedAt,
            fullFiscalYearRecovery: summary?.fullFiscalYearRecovery,
          });
          expect(persisted).not.toHaveProperty("completedAt");
          expect(storage.session.completion).not.toHaveProperty("targetEvidence");
          expect(await readCanonicalFiledReturnsFlowSummary("completion")).toEqual(persisted);
        },
      );
    },
  );

  it.each(["not-filed", "downloaded"] as const)(
    "allows settled %s targets to clear",
    async (status) => {
      const ledger = makeCompletedRecoveryLedger(status);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      storage.local.ledger = ledger;

      expect(await clearPackLocalDataWithRecoveryGuard(clearDeps)).toEqual({
        ok: true,
        cleared: true,
      });
      expect(mocks.discardFullYear).toHaveBeenCalledWith(ledger.ledgerId);
      expect(mocks.session.clear).toHaveBeenCalledTimes(1);
      expect(mocks.local.remove).toHaveBeenCalledTimes(1);
      expect(storage.local.ledger).toBeUndefined();
    },
  );

  it.each(["not-filed", "downloaded"] as const)(
    "allows a newer single-period result after settled %s targets",
    async (status) => {
      const ledger = makeCompletedRecoveryLedger(status);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      storage.local.ledger = structuredClone(ledger);
      const newer = await persistCanonicalFiledReturnsFlowSummary(
        "completion",
        competingSummary("single-period"),
      );
      expect(newer).not.toBeNull();

      expect(await readCurrentFiledReturnsFlowSummary(readDeps)).toEqual(newer);
      expect(storage.local.ledger).toEqual(ledger);
      expectNoDestructiveClear();
    },
  );

  it("preserves active-run precedence", async () => {
    const ledger = makeCompletedRecoveryLedger("blocked");
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    storage.local.ledger = structuredClone(ledger);
    const scope = { ...RECOVERY_SCOPE, period: "June" };
    expect(await acquireFiledReturnsRun(scope, readDeps)).toHaveProperty("run");

    const summary = await readCurrentFiledReturnsFlowSummary(readDeps);
    expect(summary).toMatchObject({ status: "running", scope });
    expect(summary).not.toHaveProperty("fullFiscalYearRecovery");
    expect(await clearPackLocalDataWithRecoveryGuard(clearDeps)).toHaveProperty("ok", false);
    expect(storage.local.ledger).toEqual(ledger);
    expectNoDestructiveClear();
  });

  it("preserves target-review precedence", async () => {
    const ledger = makeCompletedRecoveryLedger("blocked");
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    storage.local.ledger = structuredClone(ledger);
    const scope = { ...RECOVERY_SCOPE, period: "June" };
    const review = await persistFiledReturnsTargetReview(
      scope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "download-unconfirmed",
        safeSignals: ["browser-download-not-observed"],
        safeMessage: canonicalDurableSummaryMessage(scope, "blocked", [
          "browser-download-not-observed",
        ]),
      },
      readDeps,
    );
    expect(review).not.toBeNull();

    expect(await readCurrentFiledReturnsFlowSummary(readDeps)).toEqual(review);
    expect(await clearPackLocalDataWithRecoveryGuard(clearDeps)).toHaveProperty("ok", false);
    expect(storage.local.ledger).toEqual(ledger);
    expectNoDestructiveClear();
  });
});
