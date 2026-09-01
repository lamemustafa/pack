import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  allSupportedExplicitRetryTarget,
  createAllSupportedFullFiscalYearLedger,
  createAllSupportedFullFiscalYearTargetPlan,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import {
  allSupportedFullFiscalYearPlanRootKey,
  allSupportedFullFiscalYearPlanStorageKey,
  persistAllSupportedFullFiscalYearLedger,
  readAllSupportedFullFiscalYearLedgerForPlanRoot,
  readAllSupportedPlanLedgersStorageState,
  removeAllSupportedFullFiscalYearLedger,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state";
import { isAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";
import { toAllSupportedFullFiscalYearSummary } from "../../src/background/filed-returns-all-supported-full-fiscal-year-summary";

const stored = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key?: string | null) => {
        if (typeof key === "string") return { [key]: stored.current[key] };
        return stored.current;
      }),
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

const NOW = new Date("2026-08-27T00:00:00.000Z");
const PLAN_ROOT = {
  kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  financialYear: "2025-26",
} as const;
const PERIODS = FILED_RETURNS_MONTHS.slice(0, 2);
const deps = {
  storageKeys: { allSupportedFullFiscalYearLedgerIndex: "all-supported-index" },
};

function expandedPlan() {
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  if (!expansion.ok) throw new Error("expected a supported full-year plan");
  return expansion.targets;
}

function createLedger(now = NOW) {
  return createAllSupportedFullFiscalYearLedger(PLAN_ROOT, expandedPlan(), PERIODS, now);
}

describe("all-supported full-fiscal-year ledger", () => {
  beforeEach(() => {
    stored.current = {};
    vi.clearAllMocks();
  });

  it("persists one immutable atomic target per return and period", () => {
    const ledger = createLedger();

    expect(isAllSupportedFullFiscalYearLedger(ledger)).toBe(true);
    expect(ledger.targetPlan).toHaveLength(expandedPlan().length * PERIODS.length);
    expect(ledger.targetPlan.map((target) => target.period)).toEqual(
      expandedPlan().flatMap(() => PERIODS),
    );
    expect(ledger.targetPlan.every((target) => target.concreteArtifactTypes.length > 0)).toBe(true);
  });

  it("rejects a persisted plan whose repeated return group is reordered or shortened", () => {
    const ledger = createLedger();
    const reordered = {
      ...ledger,
      targetPlan: [ledger.targetPlan[1]!, ledger.targetPlan[0]!, ...ledger.targetPlan.slice(2)],
      targets: [ledger.targets[1]!, ledger.targets[0]!, ...ledger.targets.slice(2)],
    };
    const shortened = {
      ...ledger,
      targetPlan: ledger.targetPlan.slice(0, -1),
      targets: ledger.targets.slice(0, -1),
    };

    expect(isAllSupportedFullFiscalYearLedger(reordered)).toBe(false);
    expect(isAllSupportedFullFiscalYearLedger(shortened)).toBe(false);
  });

  it("rejects a plan that substitutes a recognised return type for the canonical group", () => {
    const ledger = createLedger();
    const substituted = {
      ...ledger,
      targetPlan: ledger.targetPlan.map((target, index) =>
        index < PERIODS.length ? { ...target, returnType: "GSTR-9" } : target,
      ),
      targets: ledger.targets.map((target, index) =>
        index < PERIODS.length ? { ...target, returnType: "GSTR-9" } : target,
      ),
    };

    expect(isAllSupportedFullFiscalYearLedger(substituted)).toBe(false);
  });

  it("keeps a completed no-artifact plan complete after reopening", () => {
    const ledger = createLedger();
    const complete = {
      ...ledger,
      status: "complete" as const,
      zipPhase: "cleaned-without-export" as const,
      targets: ledger.targets.map((target) => ({
        ...target,
        status: "not-filed" as const,
        ...canonicalDurableTargetStatus(target, "not-filed", ["filed-return-positively-not-filed"]),
      })),
    };

    expect(isAllSupportedFullFiscalYearLedger(complete)).toBe(true);
    expect(toAllSupportedFullFiscalYearSummary(complete).flowStep).toMatchObject({
      state: "downloaded",
      safeSignals: expect.arrayContaining([
        "all-supported-full-fiscal-year-complete",
        "all-supported-full-fiscal-year-no-zip-artifacts",
      ]),
    });
  });

  it.each([
    "all-supported-full-fiscal-year-artifact-snapshot-mismatch",
    "full-fiscal-year-pinned-gst-tab-unavailable",
    "single-period-bundle-ledger-malformed",
    "single-period-bundle-scope-conflict",
    "single-period-bundle-state-persist-failed",
    "single-period-bundle-state-read-failed",
    "filed-return-durable-status-rejected",
  ])("withholds an explicit retry for a non-resumable target: %s", (signal) => {
    const ledger = createLedger();
    const blocked = {
      ...ledger,
      status: "blocked" as const,
      targets: ledger.targets.map((target, index) =>
        index === 0
          ? {
              ...target,
              status: "blocked" as const,
              safeSignals: [signal],
            }
          : target,
      ),
    };

    expect(allSupportedExplicitRetryTarget(blocked)).toBeNull();
    expect(
      toAllSupportedFullFiscalYearSummary(blocked).allSupportedFullFiscalYearRecovery,
    ).toBeUndefined();
  });

  it("withholds explicit retry once final ZIP recovery has started", () => {
    const ledger = createLedger();
    const finalZipRecovery = {
      ...ledger,
      status: "blocked" as const,
      zipPhase: "download-observing" as const,
      targets: ledger.targets.map((target, index) =>
        index === 0 ? { ...target, status: "blocked" as const } : target,
      ),
    };

    expect(allSupportedExplicitRetryTarget(finalZipRecovery)).toBeNull();
    expect(
      toAllSupportedFullFiscalYearSummary(finalZipRecovery).allSupportedFullFiscalYearRecovery,
    ).toBeUndefined();
  });

  it("withholds a later retryable target while an earlier target remains unresolved", () => {
    const ledger = createLedger();
    const blockedOutOfOrder = {
      ...ledger,
      status: "blocked" as const,
      targets: ledger.targets.map((target, index) => {
        if (index === 1) return { ...target, status: "blocked" as const };
        return target;
      }),
    };

    expect(allSupportedExplicitRetryTarget(blockedOutOfOrder)).toBeNull();
    expect(
      toAllSupportedFullFiscalYearSummary(blockedOutOfOrder).allSupportedFullFiscalYearRecovery,
    ).toBeUndefined();
  });

  it("rejects a plan whose immutable concrete-artifact snapshot changes", () => {
    const ledger = createLedger();
    const mutatedArtifacts = [...ledger.targetPlan[0]!.concreteArtifactTypes].reverse();
    const mutated = {
      ...ledger,
      targetPlan: ledger.targetPlan.map((target, index) =>
        index < PERIODS.length ? { ...target, concreteArtifactTypes: mutatedArtifacts } : target,
      ),
      targets: ledger.targets.map((target, index) =>
        index < PERIODS.length ? { ...target, concreteArtifactTypes: mutatedArtifacts } : target,
      ),
    };

    expect(isAllSupportedFullFiscalYearLedger(ledger)).toBe(true);
    expect(isAllSupportedFullFiscalYearLedger(mutated)).toBe(false);
  });

  it("rejects a non-consecutive fiscal-year root even when its public shape parses", () => {
    const ledger = createLedger();

    expect(
      isAllSupportedFullFiscalYearLedger({
        ...ledger,
        planRoot: { ...ledger.planRoot, financialYear: "2025-30" },
      }),
    ).toBe(false);
  });

  it("does not construct a plan from duplicate return snapshots", () => {
    const plan = expandedPlan();

    expect(() =>
      createAllSupportedFullFiscalYearTargetPlan(PLAN_ROOT, [plan[0]!, plan[0]!], PERIODS),
    ).toThrow("cannot repeat a return type");
  });

  it("uses a separate root-keyed index and never reads a v1 scope plan", async () => {
    const ledger = createLedger();
    stored.current["pack:filed-returns-plan:legacy-v1"] = { legacy: true };

    await persistAllSupportedFullFiscalYearLedger(deps, ledger);

    expect(stored.current["pack:filed-returns-plan:legacy-v1"]).toEqual({ legacy: true });
    expect(stored.current[allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)]).toEqual(
      ledger,
    );
    expect(stored.current["all-supported-index"]).toEqual({
      schemaVersion: "1.0",
      ledgerIdsByPlanRoot: {
        [allSupportedFullFiscalYearPlanRootKey(PLAN_ROOT)]: ledger.ledgerId,
      },
    });
    await expect(readAllSupportedFullFiscalYearLedgerForPlanRoot(deps, PLAN_ROOT)).resolves.toEqual(
      ledger,
    );
  });

  it("serializes concurrent root-plan writes without dropping either index mapping", async () => {
    const first = createLedger(NOW);
    const secondRoot = { ...PLAN_ROOT, financialYear: "2026-27" } as const;
    const second = createAllSupportedFullFiscalYearLedger(
      secondRoot,
      expandedPlan(),
      PERIODS,
      new Date("2026-08-27T00:00:01.000Z"),
    );

    await Promise.all([
      persistAllSupportedFullFiscalYearLedger(deps, first),
      persistAllSupportedFullFiscalYearLedger(deps, second),
    ]);

    expect(stored.current["all-supported-index"]).toEqual({
      schemaVersion: "1.0",
      ledgerIdsByPlanRoot: {
        [allSupportedFullFiscalYearPlanRootKey(first.planRoot)]: first.ledgerId,
        [allSupportedFullFiscalYearPlanRootKey(second.planRoot)]: second.ledgerId,
      },
    });
    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toMatchObject({
      state: "valid",
      ledgers: expect.arrayContaining([
        expect.objectContaining({ ledgerId: first.ledgerId }),
        expect.objectContaining({ ledgerId: second.ledgerId }),
      ]),
    });
  });

  it("removes the root index mapping before removing its ledger record", async () => {
    const ledger = createLedger();
    await persistAllSupportedFullFiscalYearLedger(deps, ledger);
    vi.clearAllMocks();

    await removeAllSupportedFullFiscalYearLedger(deps, ledger);

    const lastIndexWrite = browserMocks.storage.local.set.mock.invocationCallOrder.at(-1);
    const ledgerRemoval = browserMocks.storage.local.remove.mock.invocationCallOrder.at(-1);
    expect(lastIndexWrite).toBeDefined();
    expect(ledgerRemoval).toBeDefined();
    expect(lastIndexWrite!).toBeLessThan(ledgerRemoval!);
    expect(
      stored.current[allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)],
    ).toBeUndefined();
  });

  it("fails closed when an all-supported index is malformed, even without plan records", async () => {
    stored.current["all-supported-index"] = { schemaVersion: "2.0", ledgerIdsByPlanRoot: {} };

    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "malformed",
    });
    await expect(persistAllSupportedFullFiscalYearLedger(deps, createLedger())).rejects.toThrow(
      "could not verify the all-supported saved-plan index",
    );
  });
});
