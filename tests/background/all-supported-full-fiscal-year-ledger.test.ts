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
  savedPlanStorageStateRecoveryMessage,
  savedPlanStorageStateStep,
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
    // `clearAllMocks` clears calls, not implementations. A test that makes a
    // write silently fail would otherwise leave every later test writing into
    // a void, which reads as an unrelated failure in whichever one runs next.
    browserMocks.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(stored.current, values);
    });
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

  it("rejects a target plan that omits a historically captured return group", () => {
    const ledger = createLedger();
    const firstGroupLength = PERIODS.length;
    const omitted = {
      ...ledger,
      targetPlan: ledger.targetPlan.slice(firstGroupLength),
      targets: ledger.targets.slice(firstGroupLength),
    };

    expect(isAllSupportedFullFiscalYearLedger(ledger)).toBe(true);
    expect(isAllSupportedFullFiscalYearLedger(omitted)).toBe(false);
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
      zipDownloadAttempt: { requestedAt: NOW.toISOString(), downloadId: 41 },
      targets: ledger.targets.map((target) => ({
        ...target,
        status: "not-filed" as const,
        ...canonicalDurableTargetStatus(target, "not-filed", ["filed-return-positively-not-filed"]),
      })),
    };

    expect(isAllSupportedFullFiscalYearLedger(finalZipRecovery)).toBe(true);
    expect(allSupportedExplicitRetryTarget(finalZipRecovery)).toBeNull();
    expect(
      toAllSupportedFullFiscalYearSummary(finalZipRecovery).allSupportedFullFiscalYearRecovery,
    ).toBeUndefined();
  });

  it("withholds explicit retry while accepted ZIP restaging is required", () => {
    const ledger = createLedger();
    const restagingRequired = {
      ...ledger,
      status: "blocked" as const,
      zipPhase: "restaging-required" as const,
      targets: ledger.targets.map((target, index) =>
        index === 0
          ? {
              ...target,
              status: "blocked" as const,
              ...canonicalDurableTargetStatus(target, "blocked", [
                "full-fiscal-year-restaging-required",
              ]),
            }
          : target,
      ),
    };

    expect(isAllSupportedFullFiscalYearLedger(restagingRequired)).toBe(true);
    expect(allSupportedExplicitRetryTarget(restagingRequired)).toBeNull();
    expect(
      toAllSupportedFullFiscalYearSummary(restagingRequired).allSupportedFullFiscalYearRecovery,
    ).toBeUndefined();
  });

  it("withholds a later retryable target while an earlier target remains unresolved", () => {
    const ledger = createLedger();
    const blockedOutOfOrder = {
      ...ledger,
      status: "blocked" as const,
      targets: ledger.targets.map((target, index) => {
        if (index === 1) {
          return {
            ...target,
            status: "blocked" as const,
            ...canonicalDurableTargetStatus(target, "blocked", []),
          };
        }
        return target;
      }),
    };

    expect(isAllSupportedFullFiscalYearLedger(blockedOutOfOrder)).toBe(true);
    expect(allSupportedExplicitRetryTarget(blockedOutOfOrder)).toBeNull();
    expect(
      toAllSupportedFullFiscalYearSummary(blockedOutOfOrder).allSupportedFullFiscalYearRecovery,
    ).toBeUndefined();
  });

  it("withholds the first retryable target when a later target is already terminal", () => {
    const ledger = createLedger();
    const laterOutOfOrder = {
      ...ledger,
      status: "blocked" as const,
      targets: ledger.targets.map((target, index) =>
        index <= 1
          ? {
              ...target,
              status: "blocked" as const,
              ...canonicalDurableTargetStatus(target, "blocked", []),
            }
          : target,
      ),
    };

    expect(isAllSupportedFullFiscalYearLedger(laterOutOfOrder)).toBe(true);
    expect(allSupportedExplicitRetryTarget(laterOutOfOrder)).toBeNull();
    expect(
      toAllSupportedFullFiscalYearSummary(laterOutOfOrder).allSupportedFullFiscalYearRecovery,
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
      schemaVersion: "2.0",
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
      schemaVersion: "2.0",
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

  it("checkpoints removal before deleting its ledger record, then clears the checkpoint", async () => {
    const ledger = createLedger();
    await persistAllSupportedFullFiscalYearLedger(deps, ledger);
    vi.clearAllMocks();

    await removeAllSupportedFullFiscalYearLedger(deps, ledger);

    const indexWrites = browserMocks.storage.local.set.mock.invocationCallOrder;
    const checkpointIndex =
      browserMocks.storage.local.set.mock.calls.at(-2)?.[0]?.["all-supported-index"];
    const ledgerRemoval = browserMocks.storage.local.remove.mock.invocationCallOrder.at(-1);
    expect(indexWrites).toHaveLength(2);
    expect(checkpointIndex).toMatchObject({
      schemaVersion: "2.0",
      pendingRemoval: {
        ledgerId: ledger.ledgerId,
        planRootKey: allSupportedFullFiscalYearPlanRootKey(ledger.planRoot),
      },
    });
    expect(ledgerRemoval).toBeDefined();
    expect(indexWrites[0]!).toBeLessThan(ledgerRemoval!);
    expect(indexWrites[1]!).toBeGreaterThan(ledgerRemoval!);
    expect(
      stored.current[allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)],
    ).toBeUndefined();
  });

  it("finishes exactly the checkpointed removal after an interrupted worker operation", async () => {
    const ledger = createLedger();
    const planKey = allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId);
    stored.current[planKey] = ledger;
    stored.current["all-supported-index"] = {
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {},
      pendingRemoval: {
        ledgerId: ledger.ledgerId,
        planRootKey: allSupportedFullFiscalYearPlanRootKey(ledger.planRoot),
      },
    };

    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "valid",
      ledgers: [],
    });
    expect(stored.current[planKey]).toBeUndefined();
    expect(stored.current["all-supported-index"]).toEqual({
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {},
    });
  });

  it("refuses to delete a plan record that does not answer to the removal checkpoint", async () => {
    const ledger = createLedger();
    const planKey = allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId);
    // The stored record carries a different ledger id than the checkpoint that
    // names its key. Comparing two copies of the checkpoint proves only that
    // the checkpoint agrees with itself, and deleting on that basis drops a
    // ledger while its ledger-keyed staged files stay on disk -- then clears
    // the checkpoint, so the index reads healthy and broad cleanup never runs.
    stored.current[planKey] = { ...ledger, ledgerId: "all-supported-full-fiscal-year-00009999" };
    stored.current["all-supported-index"] = {
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {},
      pendingRemoval: {
        ledgerId: ledger.ledgerId,
        planRootKey: allSupportedFullFiscalYearPlanRootKey(ledger.planRoot),
      },
    };

    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "removal-pending",
      planRoot: ledger.planRoot,
    });
    expect(stored.current[planKey]).toBeDefined();
    expect(stored.current["all-supported-index"]).toMatchObject({
      pendingRemoval: { ledgerId: ledger.ledgerId },
    });
  });

  it("finishes an in-flight removal instead of overwriting its checkpoint", async () => {
    const stranded = createLedger();
    const other = {
      ...createLedger(),
      ledgerId: "all-supported-full-fiscal-year-00008888",
      planRoot: { ...PLAN_ROOT, financialYear: "2024-25" },
    };
    const strandedKey = allSupportedFullFiscalYearPlanStorageKey(stranded.ledgerId);
    stored.current[strandedKey] = stranded;
    stored.current[allSupportedFullFiscalYearPlanStorageKey(other.ledgerId)] = other;
    stored.current["all-supported-index"] = {
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {
        [allSupportedFullFiscalYearPlanRootKey(other.planRoot)]: other.ledgerId,
      },
      pendingRemoval: {
        ledgerId: stranded.ledgerId,
        planRootKey: allSupportedFullFiscalYearPlanRootKey(stranded.planRoot),
      },
    };

    await removeAllSupportedFullFiscalYearLedger(deps, other);

    // The first root was already unindexed; its checkpoint was the only record
    // that could finish or explain its removal, so writing the second root's
    // checkpoint over it would have stranded the first ledger for good.
    expect(stored.current[strandedKey]).toBeUndefined();
    expect(
      stored.current[allSupportedFullFiscalYearPlanStorageKey(other.ledgerId)],
    ).toBeUndefined();
    expect(stored.current["all-supported-index"]).toEqual({
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {},
    });
  });

  it.each(["provenance-unavailable", "removal-pending", "malformed"] as const)(
    "names what Pack found as well as what to do for saved-plan state %s",
    (state) => {
      const { safeMessage } = savedPlanStorageStateStep("2026-27", state);
      const sentences = (safeMessage ?? "").split(". ").filter(Boolean);

      // The invariant, not the wording: a blocked state has to say what Pack
      // found before it says what to do. `malformed` once delegated its whole
      // message to the shared instruction, so the one state that also
      // withholds its fiscal year told the reader to clear every saved plan
      // and never said why -- undiagnosable from outside, and the only one of
      // the three that was.
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      expect(sentences[0]).toMatch(/^Pack /);
      expect(safeMessage).not.toBe(savedPlanStorageStateRecoveryMessage(state));
    },
  );

  it("gives up on an index migration that never takes instead of rewriting it forever", async () => {
    const ledger = createLedger();
    stored.current[allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)] = ledger;
    stored.current["all-supported-index"] = {
      schemaVersion: "1.0",
      ledgerIdsByPlanRoot: {
        [allSupportedFullFiscalYearPlanRootKey(ledger.planRoot)]: ledger.ledgerId,
      },
    };
    // A write that resolves without persisting is what an exhausted quota or a
    // torn-down worker looks like from in here. The reader used to tail-call
    // itself on every repair, so this state ran the service worker out of
    // memory inside the operation critical section with nothing user-visible.
    browserMocks.storage.local.set.mockImplementation(async () => undefined);

    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "malformed",
    });
    expect(browserMocks.storage.local.set.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("gives up on a removal checkpoint that never clears instead of retrying forever", async () => {
    const ledger = createLedger();
    stored.current[allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)] = ledger;
    stored.current["all-supported-index"] = {
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {},
      pendingRemoval: {
        ledgerId: ledger.ledgerId,
        planRootKey: allSupportedFullFiscalYearPlanRootKey(ledger.planRoot),
      },
    };
    browserMocks.storage.local.set.mockImplementation(async () => undefined);

    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "removal-pending",
      planRoot: ledger.planRoot,
    });
  });

  it("does not tolerate an unindexed ledger without the exact removal checkpoint", async () => {
    const ledger = createLedger();
    stored.current[allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)] = ledger;
    stored.current["all-supported-index"] = { schemaVersion: "2.0", ledgerIdsByPlanRoot: {} };

    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "malformed",
    });
  });

  it("migrates a stored v1 index but fails closed for a pre-provenance ledger", async () => {
    const ledger = createLedger();
    const legacyLedger = structuredClone(ledger) as unknown as Record<string, unknown>;
    delete legacyLedger.planProvenance;
    const planKey = allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId);
    stored.current[planKey] = { ...legacyLedger, schemaVersion: "1.0" };
    stored.current["all-supported-index"] = {
      schemaVersion: "1.0",
      ledgerIdsByPlanRoot: {
        [allSupportedFullFiscalYearPlanRootKey(ledger.planRoot)]: ledger.ledgerId,
      },
    };

    // The affected plan root is part of the state, not incidental to it: the
    // summary names the year the reader has to clear, so a state that forgot
    // which year it was blocked on would go back to being undiagnosable.
    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "provenance-unavailable",
      planRoots: [ledger.planRoot],
    });
    expect(stored.current["all-supported-index"]).toEqual({
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {
        [allSupportedFullFiscalYearPlanRootKey(ledger.planRoot)]: ledger.ledgerId,
      },
    });
    expect(stored.current[planKey]).toMatchObject({ schemaVersion: "1.0" });
  });

  it("fails closed when an all-supported index is malformed, even without plan records", async () => {
    stored.current["all-supported-index"] = { schemaVersion: "3.0", ledgerIdsByPlanRoot: {} };

    await expect(readAllSupportedPlanLedgersStorageState(deps)).resolves.toEqual({
      state: "malformed",
    });
    await expect(persistAllSupportedFullFiscalYearLedger(deps, createLedger())).rejects.toThrow(
      "could not verify the all-supported saved-plan index",
    );
  });
});
