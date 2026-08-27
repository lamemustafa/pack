import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import { startFullFiscalYearDownloadFlow } from "../../src/background/filed-returns-full-fiscal-year";
import {
  prepareFullFiscalYearTargetRetry,
  resolveFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-recovery";
import { responseForExistingLedger } from "../../src/background/filed-returns-full-fiscal-year-run-state";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
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
const browserMocks = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storage.local[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(storage.local, value);
      }),
      remove: vi.fn(async (key: string) => {
        delete storage.local[key];
      }),
    },
    session: {
      get: vi.fn(async (key: string) => ({ [key]: storage.session[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(storage.session, value);
      }),
      remove: vi.fn(async (key: string) => {
        delete storage.session[key];
      }),
    },
  },
}));
const zipMocks = vi.hoisted(() => ({
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
  exportFullFiscalYearZip: vi.fn(),
  reconcileFullFiscalYearZipDownload: vi.fn(),
}));
vi.mock("wxt/browser", () => ({ browser: browserMocks }));
vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => zipMocks);

const deps: FiledReturnsFlowRunnerDeps = {
  getActiveGstTab: async () => null,
  sendMessageToTabWithInjection: async () => ({ ok: false, error: "Synthetic boundary." }),
  storageKeys: {
    fullFiscalYearLedger: "ledger",
    completion: "completion",
    observation: "observation",
    targetReview: "review",
  },
  now: () => RECOVERY_NOW,
};

describe("full-year Start preserves existing recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.local = {};
    storage.session = {};
  });

  it.each(
    RECOVERY_TARGET_STATUSES.flatMap((status) =>
      [false, true].map((stagedPositive) => ({ status, stagedPositive })),
    ),
  )(
    "refuses $status before reconciliation or cleanup (staged decoy: $stagedPositive)",
    async ({ status, stagedPositive }) => {
      const ledger = makeCompletedRecoveryLedger(status, {
        stagedPositive,
        positiveFirst: true,
        currentPositive: true,
      });
      const original = structuredClone(ledger);
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      storage.local.ledger = ledger;
      const runSinglePeriod = vi.fn(async () => ({ ok: false as const, error: "Synthetic stop." }));

      const response = await startFullFiscalYearDownloadFlow(RECOVERY_SCOPE, deps, runSinglePeriod);

      expect(response).toMatchObject({
        ok: true,
        flowSummary: {
          status: "blocked",
          scope: ledger.scope,
          updatedAt: ledger.updatedAt,
          fullFiscalYearRecovery: {
            ledgerId: ledger.ledgerId,
            expectedRevision: ledger.revision,
            targetId: ledger.targets[1]!.targetId,
          },
        },
      });
      expect(runSinglePeriod).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
      expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
      expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
      expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
      expect(storage.local.ledger).toEqual(original);
      expect(isFullFiscalYearLedger(storage.local.ledger)).toBe(true);
    },
  );

  it.each(RECOVERY_TARGET_STATUSES)(
    "retains the saved scope for a different selection with %s recovery",
    async (status) => {
      const ledger = makeCompletedRecoveryLedger(status, { stagedPositive: true });
      storage.local.ledger = ledger;
      const runSinglePeriod = vi.fn(async () => ({ ok: false as const, error: "Synthetic stop." }));
      const response = await startFullFiscalYearDownloadFlow(
        { ...RECOVERY_SCOPE, returnType: "GSTR-1" },
        deps,
        runSinglePeriod,
      );
      expect(response).toMatchObject({
        flowSummary: {
          status: "blocked",
          scope: ledger.scope,
          fullFiscalYearRecovery: { targetStatus: status },
        },
      });
      expect(runSinglePeriod).not.toHaveBeenCalled();
      expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
      expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
    },
  );

  it.each(RECOVERY_TARGET_STATUSES)(
    "prioritizes %s recovery over a retained-scope shortcut",
    (status) => {
      const ledger = makeCompletedRecoveryLedger(status, { stagedPositive: true });
      const original = structuredClone(ledger);
      const response = responseForExistingLedger(ledger, RECOVERY_NOW, {
        blockRetainedStaging: true,
      });
      expect(response).toMatchObject({
        flowSummary: {
          status: "blocked",
          updatedAt: ledger.updatedAt,
          fullFiscalYearRecovery: { targetStatus: status },
        },
      });
      expect(response).toHaveProperty(
        "flowStep.safeSignals",
        expect.not.arrayContaining(["full-fiscal-year-retained-staging-scope-conflict"]),
      );
      expect(ledger).toEqual(original);
    },
  );

  it("does not treat an internal resume option as validated recovery", async () => {
    const ledger = makeCompletedRecoveryLedger("pending");
    storage.local.ledger = ledger;
    const runSinglePeriod = vi.fn(async () => ({ ok: false as const, error: "Synthetic stop." }));
    const response = await startFullFiscalYearDownloadFlow(RECOVERY_SCOPE, deps, runSinglePeriod, {
      allowExistingLedgerResume: true,
    });
    expect(response).toHaveProperty(
      "flowStep.safeSignals",
      expect.arrayContaining(["full-fiscal-year-resume-confirmation-required"]),
    );
    expect(runSinglePeriod).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
  });

  it("keeps the explicitly validated pending retry route available", async () => {
    const ledger = makeCompletedRecoveryLedger("pending");
    storage.local.ledger = ledger;
    const preparation = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: ledger.ledgerId,
        targetId: ledger.targets[0]!.targetId,
        expectedRevision: ledger.revision!,
      },
      deps,
    );
    expect(preparation.ok).toBe(true);
    if (!preparation.ok) throw new Error("Expected canonical retry preparation.");
    expect(preparation.ledger.status).toBe("running");
    expect(preparation.ledger.revision).toBe(ledger.revision! + 1);
    const runSinglePeriod = vi.fn(async () => ({ ok: false as const, error: "Synthetic stop." }));
    await startFullFiscalYearDownloadFlow(RECOVERY_SCOPE, deps, runSinglePeriod, {
      allowExistingLedgerResume: true,
    });
    expect(runSinglePeriod).toHaveBeenCalledTimes(1);
    expect(runSinglePeriod).toHaveBeenCalledWith(
      expect.objectContaining({ period: "April", returnType: "GSTR-3B" }),
      expect.anything(),
      {
        onPortalTabSelected: expect.any(Function),
        persistSinglePeriodSummary: false,
      },
    );
  });

  it("rebinds a prior browser tab pin before an explicitly validated retry acts", async () => {
    const ledger = makeCompletedRecoveryLedger("pending");
    storage.local.ledger = ledger;
    const preparation = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: ledger.ledgerId,
        targetId: ledger.targets[0]!.targetId,
        expectedRevision: ledger.revision!,
      },
      deps,
    );
    expect(preparation.ok).toBe(true);
    if (!preparation.ok) throw new Error("Expected canonical retry preparation.");
    storage.local.ledger = {
      ...preparation.ledger,
      portalTabId: 41,
      portalTabSessionId: "prior-browser-session",
    };
    const runSinglePeriod = vi.fn(async (_scope, _deps, options) => {
      expect(options?.requiredPortalTabId).toBeUndefined();
      expect(options?.requiredPortalTabSessionId).toBeUndefined();
      await options?.onPortalTabSelected?.(73, "current-browser-session");
      expect(storage.local.ledger).toMatchObject({
        portalTabId: 73,
        portalTabSessionId: "current-browser-session",
      });
      return { ok: false as const, error: "Synthetic stop." };
    });

    await startFullFiscalYearDownloadFlow(RECOVERY_SCOPE, deps, runSinglePeriod, {
      allowExistingLedgerResume: true,
    });

    expect(runSinglePeriod).toHaveBeenCalledTimes(1);
  });

  it.each(["ledger", "target", "revision", "running"] as const)(
    "preserves the %s retry guard",
    async (guard) => {
      const ledger = makeCompletedRecoveryLedger(guard === "running" ? "running" : "pending");
      storage.local.ledger = ledger;
      const response = await prepareFullFiscalYearTargetRetry(
        {
          ledgerId: guard === "ledger" ? "full-fiscal-year-00000021" : ledger.ledgerId,
          targetId: guard === "target" ? "GSTR-3B:2025-26:Unknown" : ledger.targets[0]!.targetId,
          expectedRevision: guard === "revision" ? ledger.revision! + 1 : ledger.revision!,
        },
        deps,
      );
      expect(response.ok).toBe(false);
      expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
      expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    },
  );

  it("keeps interrupted-target refusal when another pending target was current", async () => {
    const ledger = makeCompletedRecoveryLedger("running");
    ledger.status = "running";
    const other = ledger.targets[1]!;
    Object.assign(
      other,
      { status: "pending", attempts: 0 },
      canonicalDurableTargetStatus(other, "pending", []),
    );
    ledger.currentTargetId = other.targetId;
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    storage.local.ledger = ledger;
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    const recovery = summary.fullFiscalYearRecovery!;
    const response = await prepareFullFiscalYearTargetRetry(recovery, deps);
    expect(response.ok).toBe(false);
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
  });

  it("records manual observation only for the period named by the mixed-target warning", async () => {
    const ledger = makeCompletedRecoveryLedger("download-unconfirmed");
    const other = ledger.targets[1]!;
    Object.assign(
      other,
      { status: "pending", attempts: 0 },
      canonicalDurableTargetStatus(other, "pending", []),
    );
    ledger.currentTargetId = other.targetId;
    const originalOther = structuredClone(other);
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    storage.local.ledger = ledger;
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    expect(summary.flowStep.safeMessage).toContain("for April");
    await resolveFullFiscalYearTarget(summary.fullFiscalYearRecovery!, "manually-observed", deps);
    expect(storage.local.ledger).toMatchObject({
      revision: ledger.revision! + 1,
      targets: [
        expect.objectContaining({ period: "April", status: "manually-observed" }),
        originalOther,
        ...ledger.targets.slice(2),
      ],
    });
    expect(isFullFiscalYearLedger(storage.local.ledger)).toBe(true);
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
  });

  it("keeps a multi-running retry refusal period-neutral and side-effect-free", async () => {
    const ledger = makeCompletedRecoveryLedger("running");
    const current = ledger.targets[1]!;
    Object.assign(
      current,
      { status: "running", attempts: 1 },
      canonicalDurableTargetStatus(current, "running", []),
    );
    ledger.currentTargetId = current.targetId;
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    storage.local.ledger = ledger;
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    expect(summary.currentPeriod).toBe("May");
    const result = await prepareFullFiscalYearTargetRetry(summary.fullFiscalYearRecovery!, deps);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Interrupted retry must remain refused.");
    expect(result.response).toMatchObject({
      flowStep: {
        safeMessage:
          "Pack cannot safely retry an interrupted period because a staged file may exist without its final ledger checkpoint. Discard this saved run before starting again.",
      },
      flowSummary: {
        currentPeriod: "April",
        fullFiscalYearRecovery: {
          targetId: ledger.targets[0]!.targetId,
          targetStatus: "running",
          expectedRevision: ledger.revision,
        },
      },
    });
    expect(browserMocks.storage.local.set).not.toHaveBeenCalled();
    expect(browserMocks.storage.local.remove).not.toHaveBeenCalled();
    expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
  });
});
