import { beforeEach, describe, expect, it, vi } from "vitest";
import { PACK_CLEAR_LOCAL_DATA_ACTION_LABEL } from "../../src/core/recovery-actions";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  allSupportedExplicitRetryTarget,
  allSupportedRecoveryIsWithheld,
  createAllSupportedFullFiscalYearLedger,
  markAllSupportedFullFiscalYearTargetRunning,
  markAllSupportedFullFiscalYearTargetTerminal,
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

function createReturnSpecificLedger(now = NOW) {
  const returnPlan = expandedPlan();
  return createAllSupportedFullFiscalYearLedger(
    PLAN_ROOT,
    returnPlan,
    returnPlan.map(({ returnType }) => ({ returnType, periods: [...PERIODS] })),
    now,
  );
}

function boundGstr2bNotGeneratedSignals() {
  return [
    "filed-gstr2b-not-generated",
    "gstr2b-summary-route-verified",
    "gstr2b-visible-period-verified",
  ];
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

  it.each([null, false, "", 0])("rejects a present non-array period plan: %j", (periodPlan) => {
    expect(isAllSupportedFullFiscalYearLedger({ ...createLedger(), periodPlan })).toBe(false);
  });

  it("rejects a period plan whose eligible-through marker disagrees with its periods", () => {
    expect(
      isAllSupportedFullFiscalYearLedger({
        ...createReturnSpecificLedger(),
        eligibleThrough: "March",
      }),
    ).toBe(false);
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

  describe("recovery withheld (#376)", () => {
    // The live capture: earlier targets resolved, one blocked on a signal Pack will not retry, the
    // rest pending. No retry, no productive resume, and a fresh start is refused because the saved
    // plan holds the root -- discarding it is the only exit, so the predicate must say so.
    function withheldAt(index: number, signal = "full-fiscal-year-pinned-gst-tab-unavailable") {
      const ledger = createLedger();
      return {
        ...ledger,
        status: "blocked" as const,
        targets: ledger.targets.map((target, position) =>
          position < index
            ? {
                ...target,
                status: "not-filed" as const,
                ...canonicalDurableTargetStatus(target, "not-filed", [
                  "filed-return-positively-not-filed",
                ]),
              }
            : position === index
              ? { ...target, status: "blocked" as const, safeSignals: [signal] }
              : target,
        ),
      };
    }

    it("is withheld when a later target is blocked on a non-resumable signal", () => {
      const ledger = withheldAt(3);
      expect(allSupportedRecoveryIsWithheld(ledger)).toBe(true);
      expect(allSupportedExplicitRetryTarget(ledger)).toBeNull();
    });

    it("is withheld for a partial plan stopped the same way", () => {
      expect(allSupportedRecoveryIsWithheld({ ...withheldAt(3), status: "partial" })).toBe(true);
    });

    it("is not withheld when the blocked target is one an explicit retry accepts", () => {
      const ledger = withheldAt(3, "no-filed-returns-candidate");
      expect(allSupportedExplicitRetryTarget(ledger)).not.toBeNull();
      expect(allSupportedRecoveryIsWithheld(ledger)).toBe(false);
    });

    it("is not withheld once a ZIP phase is recorded", () => {
      expect(
        allSupportedRecoveryIsWithheld({ ...withheldAt(3), zipPhase: "export-retry-pending" }),
      ).toBe(false);
    });

    it.each(["running", "complete", "cancelled"] as const)(
      "is not withheld for a %s plan",
      (status) => {
        expect(allSupportedRecoveryIsWithheld({ ...withheldAt(3), status })).toBe(false);
      },
    );

    it("is not withheld by a target that holds a person's answer (#380)", () => {
      // `manually-observed` is unresolved, so the retry machinery considers it, but a person
      // answered it. Discarding the plan would throw that answer away, and a stale non-resumable
      // signal beside it is not a reason to.
      const ledger = withheldAt(3);
      const observed = {
        ...ledger,
        targets: ledger.targets.map((target, position) =>
          position === 3 ? { ...target, status: "manually-observed" as const } : target,
        ),
      };
      expect(allSupportedRecoveryIsWithheld(observed)).toBe(false);
    });

    it("is not withheld when any other target holds a person's answer (#380)", () => {
      // The discard replaces the whole plan, so protecting only the target that triggers it would
      // still throw away an answer a person gave on a different one.
      const ledger = withheldAt(3);
      const observedElsewhere = {
        ...ledger,
        status: "partial" as const,
        targets: ledger.targets.map((target, position) =>
          position === 1 ? { ...target, status: "manually-observed" as const } : target,
        ),
      };
      expect(allSupportedRecoveryIsWithheld(observedElsewhere)).toBe(false);

      // No control is offered, so the message is the only way out and must name one.
      const summary = toAllSupportedFullFiscalYearSummary(observedElsewhere);
      expect(summary.recoveryWithheld).toBeUndefined();
      expect(summary.flowStep.safeMessage).toContain(PACK_CLEAR_LOCAL_DATA_ACTION_LABEL);
    });

    it("is not withheld when the non-resumable signal sits on a resolved target", () => {
      const ledger = withheldAt(3);
      const resolved = {
        ...ledger,
        targets: ledger.targets.map((target, position) =>
          position === 3 ? { ...target, status: "not-filed" as const } : target,
        ),
      };
      expect(allSupportedRecoveryIsWithheld(resolved)).toBe(false);
    });
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

describe("a period the portal declined to generate, in an all-returns year", () => {
  // The single-return fiscal-year path reported this correctly from the day the status existed,
  // because its status-to-outcome mapping is an exhaustive record that fails to compile when a
  // status is missing. The all-returns path kept two hand-written copies ending in a
  // `needs-review` default, so the same period read as needing a person in one run type and as
  // resolved in the other -- and a run of everything stopped on periods that could never change.
  it("reports it as not generated, not as needing review", () => {
    let ledger = createLedger();
    const target = ledger.targets.find((candidate) => candidate.returnType === "GSTR-2B");
    if (!target) throw new Error("expected a GSTR-2B target in the all-returns plan");

    ledger = markAllSupportedFullFiscalYearTargetRunning(ledger, target.targetId, NOW);
    ledger = markAllSupportedFullFiscalYearTargetTerminal(
      ledger,
      target.targetId,
      "not-generated",
      {
        connectorId: "gst",
        scopeId: "gst-gstr2b-private-v0",
        state: "blocked",
        safeSignals: boundGstr2bNotGeneratedSignals(),
        safeMessage: "x",
      } as never,
      NOW,
    );

    const summary = toAllSupportedFullFiscalYearSummary(ledger);
    const evidence = summary.targetEvidence.find((row) => row.targetId === target.targetId);

    expect(evidence?.outcome).toBe("not-generated");
    expect(evidence?.outcome).not.toBe("needs-review");
  });

  it.each([
    "full-fiscal-year-opfs-staged:PDF",
    "all-supported-full-fiscal-year-opfs-staged:PDF",
    "filed-return-artifact-downloaded:PDF",
  ])("rejects a stored whole-target refusal retaining %s", (retainedSignal) => {
    const ledger = createLedger();
    const target = ledger.targets.find((candidate) => candidate.returnType === "GSTR-2B");
    if (!target) throw new Error("expected a GSTR-2B target in the all-returns plan");
    const staged = {
      ...ledger,
      targets: ledger.targets.map((candidate) =>
        candidate.targetId === target.targetId
          ? {
              ...candidate,
              status: "not-generated" as const,
              ...canonicalDurableTargetStatus(candidate, "not-generated", [
                "filed-gstr2b-not-generated",
                "gstr2b-summary-route-verified",
                "gstr2b-visible-period-verified",
                retainedSignal,
              ]),
            }
          : candidate,
      ),
    };

    expect(isAllSupportedFullFiscalYearLedger(staged)).toBe(false);
    const summary = toAllSupportedFullFiscalYearSummary(staged);
    expect(summary.targetEvidence.find((row) => row.targetId === target.targetId)?.outcome).toBe(
      "needs-review",
    );
  });

  it("requires the bound route and visible-period proof for a stored not-generated target", () => {
    const ledger = createLedger();
    const target = ledger.targets.find((candidate) => candidate.returnType === "GSTR-2B");
    if (!target) throw new Error("expected a GSTR-2B target in the all-returns plan");

    for (const missingProof of [
      "gstr2b-summary-route-verified",
      "gstr2b-visible-period-verified",
    ]) {
      const invalid = {
        ...ledger,
        targets: ledger.targets.map((candidate) =>
          candidate.targetId === target.targetId
            ? {
                ...candidate,
                status: "not-generated" as const,
                ...canonicalDurableTargetStatus(
                  candidate,
                  "not-generated",
                  boundGstr2bNotGeneratedSignals().filter((signal) => signal !== missingProof),
                ),
              }
            : candidate,
        ),
      };
      expect(isAllSupportedFullFiscalYearLedger(invalid)).toBe(false);
    }

    const boundSignals = boundGstr2bNotGeneratedSignals();
    const valid = {
      ...ledger,
      targets: ledger.targets.map((candidate) =>
        candidate.targetId === target.targetId
          ? {
              ...candidate,
              status: "not-generated" as const,
              ...canonicalDurableTargetStatus(candidate, "not-generated", boundSignals),
            }
          : candidate,
      ),
    };
    expect(isAllSupportedFullFiscalYearLedger(valid)).toBe(true);
  });

  it("rejects a not-generated signal on a non-GSTR-2B stored target", () => {
    const ledger = createLedger();
    const target = ledger.targets.find((candidate) => candidate.returnType === "GSTR-1");
    if (!target) throw new Error("expected a GSTR-1 target in the all-returns plan");

    const invalid = {
      ...ledger,
      targets: ledger.targets.map((candidate) =>
        candidate.targetId === target.targetId
          ? {
              ...candidate,
              safeSignals: ["filed-gstr2b-not-generated"],
              status: "not-generated" as const,
            }
          : candidate,
      ),
    };

    expect(isAllSupportedFullFiscalYearLedger(invalid)).toBe(false);
  });

  // #366: a service-worker death mid-target left the plan with no exit at all. Reproduced from a
  // ledger captured from `chrome.storage.local` during a live authenticated run on 2026-09-15 --
  // status `running`, one target `running` with `attempts: 1` and no result, thirteen `pending`,
  // no `zipPhase`. The shape below is that capture, not an invented one.
  describe("a run interrupted with a target still marked running", () => {
    function interruptedLedger() {
      const ledger = createLedger();
      return {
        ...ledger,
        status: "running" as const,
        // Older than the 30s staleness window, so the projection can see it is not merely slow.
        updatedAt: new Date(Date.now() - 120_000).toISOString(),
        currentTargetId: ledger.targets[0]!.targetId,
        targets: ledger.targets.map((target, index) =>
          index === 0 ? { ...target, status: "running" as const, attempts: 1 } : target,
        ),
      };
    }

    it("offers no recovery while a live lease says a worker is still behind it", () => {
      // The guard this fix must not weaken. A leased run is a live race; resuming or retrying
      // alongside it is exactly what the original refusal was written to prevent.
      const summary = toAllSupportedFullFiscalYearSummary(interruptedLedger(), new Date(), true);
      expect(summary.allSupportedFullFiscalYearRecovery).toBeUndefined();
      expect(summary.status).toBe("running");
    });

    it("offers no recovery while the ledger is still fresh, even with no lease", () => {
      // Within the staleness window the worker may simply not have written yet. Age alone is not
      // evidence of death, which is why the lease exists.
      const fresh = { ...interruptedLedger(), updatedAt: new Date().toISOString() };
      expect(
        toAllSupportedFullFiscalYearSummary(fresh, new Date(), false)
          .allSupportedFullFiscalYearRecovery,
      ).toBeUndefined();
    });

    it("offers an explicit retry for the abandoned target once stale and unleased", () => {
      const ledger = interruptedLedger();
      const summary = toAllSupportedFullFiscalYearSummary(ledger, new Date(), false);

      // The observable outcome: the panel has something to render. Before this fix all three
      // exits refused and the saved plan blocked every other scope, so the panel was unusable.
      expect(summary.allSupportedFullFiscalYearRecovery).toMatchObject({
        targetId: ledger.targets[0]!.targetId,
        targetStatus: "running",
        expectedRevision: ledger.revision,
      });
      expect(summary.status).toBe("blocked");
    });

    it("keeps the retry explicit rather than resuming the plan", () => {
      // The target records an attempt and no result, so its portal action may already have fired.
      // AGENTS.md routes that ambiguity to review, never to a blind retry -- so the exit is a
      // per-target decision the reader makes, and plan-level resume stays refused.
      const summary = toAllSupportedFullFiscalYearSummary(interruptedLedger(), new Date(), false);
      expect(summary.resumeAvailable).toBe(false);
    });

    it("still withholds a retry when the abandoned target carries a non-resumable signal", () => {
      const ledger = interruptedLedger();
      const nonResumable = {
        ...ledger,
        targets: ledger.targets.map((target, index) =>
          index === 0
            ? { ...target, safeSignals: ["filed-return-durable-status-rejected"] }
            : target,
        ),
      };
      expect(
        toAllSupportedFullFiscalYearSummary(nonResumable, new Date(), false)
          .allSupportedFullFiscalYearRecovery,
      ).toBeUndefined();
    });
  });
});
