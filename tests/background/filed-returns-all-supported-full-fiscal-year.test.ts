import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  restartCompletedAllSupportedFullFiscalYearPlan,
  retryAllSupportedFullFiscalYearTarget,
  reconcilePendingAllSupportedFullFiscalYearZipDownload,
  reconcilePersistedAllSupportedFullFiscalYearZipDownload,
  startAllSupportedFullFiscalYearDownloadFlow,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year";
import { retryAllSupportedFiledReturnsFullFiscalYearTarget } from "../../src/background/filed-returns-flow-runner";
import type { SinglePeriodRunner } from "../../src/background/filed-returns-full-fiscal-year";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import { isAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";
import { readCurrentAllSupportedFullFiscalYearFlowSummary } from "../../src/background/filed-returns-all-supported-full-fiscal-year-summary";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { PACK_CLEAR_LOCAL_DATA_ACTION_LABEL } from "../../src/core/recovery-actions";
import * as AllSupportedPlanModule from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import type * as ArtifactAcquisitionState from "../../src/background/artifact-acquisition-state";
import {
  createAllSupportedFullFiscalYearLedger,
  markAllSupportedFullFiscalYearTargetRunning,
  markAllSupportedFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import {
  allSupportedFullFiscalYearPlanRootKey,
  allSupportedFullFiscalYearPlanStorageKey,
  persistAllSupportedFullFiscalYearLedger,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state";
import {
  FILED_RETURNS_MONTHS,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";

const stored = vi.hoisted(() => ({
  failReplacementSet: false,
  values: {} as Record<string, unknown>,
}));
const singlePeriod = vi.hoisted(() => ({
  run: vi.fn(),
}));
const zip = vi.hoisted(() => ({
  discard: vi.fn(async () => ["all-supported-full-fiscal-year-opfs-cleared"]),
  export: vi.fn(),
  reconcile: vi.fn(),
}));

// The child single-period flow is the one collaborator the real wrapper hard-wires rather than
// taking through `deps`. Stubbing it keeps these two tests about the wrapper's own lease and
// recovery handling; the child flow has its own suite.
vi.mock("../../src/background/filed-returns-single-period-flow", () => ({
  startSinglePeriodFiledReturnsDownloadFlow: singlePeriod.run,
}));

// Only the retained-artifact preflight is stubbed, and only because it reads OPFS directly rather
// than through `deps`. Everything else in the module stays real so the wrapper tests below exercise
// the production path.
vi.mock("../../src/background/artifact-acquisition-state", async (importOriginal) => ({
  ...(await importOriginal<typeof ArtifactAcquisitionState>()),
  readArtifactAcquisitionCheckpoints: vi.fn(async () => []),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key?: string | null) => {
          if (typeof key === "string") return { [key]: structuredClone(stored.values[key]) };
          return structuredClone(stored.values);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored.values[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          if (
            stored.failReplacementSet &&
            Object.values(values).some(
              (value) =>
                typeof value === "object" &&
                value !== null &&
                "ledgerId" in value &&
                typeof value.ledgerId === "string",
            )
          ) {
            stored.failReplacementSet = false;
            throw new Error("synthetic replacement persistence failure");
          }
          Object.assign(stored.values, structuredClone(values));
        }),
      },
    },
  },
}));

vi.mock("../../src/background/filed-returns-all-supported-full-fiscal-year-zip", () => ({
  discardAllSupportedFullFiscalYearFiledReturnsZip: zip.discard,
  exportAllSupportedFullFiscalYearZip: zip.export,
  reconcileAllSupportedFullFiscalYearZipDownload: zip.reconcile,
}));

const NOW = new Date("2026-07-25T00:00:00.000Z");
const request = {
  kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  financialYear: "2026-27",
} as const;
const deps: FiledReturnsFlowRunnerDeps & {
  storageKeys: FiledReturnsFlowRunnerDeps["storageKeys"] & {
    allSupportedFullFiscalYearLedgerIndex: string;
  };
} = {
  getActiveGstTab: vi.fn(async () => null),
  sendMessageToTabWithInjection: vi.fn(),
  storageKeys: {
    allSupportedFullFiscalYearLedgerIndex: "all-supported-index",
    completion: "completion",
    fullFiscalYearLedger: "legacy-ledger",
    observation: "observation",
  },
  now: () => NOW,
};

beforeEach(() => {
  stored.failReplacementSet = false;
  stored.values = {};
  deps.now = () => NOW;
  vi.clearAllMocks();
  singlePeriod.run.mockImplementation(async () => notFiledStep());
  zip.discard.mockResolvedValue(["all-supported-full-fiscal-year-opfs-cleared"]);
  zip.reconcile.mockResolvedValue(unconfirmedZipStep());
  zip.export.mockImplementation(async (_ledger, _step, checkpoints) => {
    await checkpoints.onBeforeDownloadStart(new Date("2026-07-15T00:01:00.000Z"), {
      lifecycle: "intent",
      safeSignals: [],
    });
    await checkpoints.onDownloadStarted(41);
    return downloadedZipStep();
  });
});

describe("all-supported full-fiscal-year worker", () => {
  it("fails closed with the real retry diagnostic when the canonical plan cannot expand", async () => {
    deps.storageKeys.activeRun = "active-run";
    stored.values["active-run"] = {
      schemaVersion: "1.0",
      runId: "filed-returns-run-m0abc123",
      revision: 1,
      scope: {
        artifactType: "PDF",
        financialYear: request.financialYear,
        period: "April",
        returnType: "GSTR-3B",
      },
      status: "running",
      leaseUpdatedAt: NOW.toISOString(),
    };
    const planExpansion = vi
      .spyOn(AllSupportedPlanModule, "expandAllSupportedFullFiscalYearTargetPlan")
      .mockReturnValueOnce({ ok: false, reason: "no-full-fiscal-year-returns" });

    try {
      const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
        {
          financialYear: request.financialYear,
          ledgerId: "full-fiscal-year-abc123de",
          targetId: "GSTR-3B:2026-27:June",
          expectedRevision: 4,
        },
        deps,
      );

      expect(response).toMatchObject({
        flowStep: {
          state: "user-action-required",
          safeSignals: ["all-supported-full-fiscal-year-recovery-stale"],
          safeMessage:
            "Pack found newer saved all-supported recovery state. Refresh the panel and review the current target.",
        },
      });
    } finally {
      planExpansion.mockRestore();
      delete deps.storageKeys.activeRun;
    }
  });

  it("blocks a restart when the saved-plan index is malformed", async () => {
    stored.values[deps.storageKeys.allSupportedFullFiscalYearLedgerIndex] = {
      schemaVersion: "invalid",
    };
    const runner = vi.fn<SinglePeriodRunner>();

    const response = await restartCompletedAllSupportedFullFiscalYearPlan(
      { ...request, ledgerId: "full-fiscal-year-abc123de" },
      deps,
      runner,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-plan-index-malformed"],
        safeMessage:
          "Pack could not verify the saved all-supported fiscal-year plan index. Open Pack's options and use \u201cClear local data and discard saved plans\u201d before starting another return.",
      },
    });
    expect(zip.discard).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it("blocks a restart whose reviewed saved plan no longer exists", async () => {
    const runner = vi.fn<SinglePeriodRunner>();

    const response = await restartCompletedAllSupportedFullFiscalYearPlan(
      { ...request, ledgerId: "full-fiscal-year-abc123de" },
      deps,
      runner,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-restart-plan-not-found"],
        safeMessage:
          "Pack could not find the saved fiscal-year plan to restart. Refresh this panel and try again.",
      },
    });
    expect(zip.discard).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it("replaces only the requested completed root with a durable fresh plan", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    const earlierRequest = { ...request, financialYear: "2025-26" } as const;
    await startAllSupportedFullFiscalYearDownloadFlow(earlierRequest, deps, runner);
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const earlierLedger = allSavedLedgers().find(
      (ledger) => ledger.planRoot.financialYear === earlierRequest.financialYear,
    );
    if (!earlierLedger) throw new Error("expected the earlier all-supported root");
    vi.clearAllMocks();
    zip.discard.mockResolvedValue(["all-supported-full-fiscal-year-opfs-cleared"]);

    await expect(
      restartCompletedAllSupportedFullFiscalYearPlan(
        { ...earlierRequest, ledgerId: earlierLedger.ledgerId },
        deps,
        runner,
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(zip.discard).toHaveBeenCalledWith(earlierLedger.ledgerId);
    expect(allSavedLedgers()).toHaveLength(2);
    expect(
      allSavedLedgers().find((ledger) => ledger.planRoot.financialYear === "2025-26")?.ledgerId,
    ).not.toBe(earlierLedger.ledgerId);
    expect(stored.values["all-supported-index"]).toEqual({
      schemaVersion: "2.0",
      ledgerIdsByPlanRoot: {
        "all-supported-returns-full-fiscal-year:2025-26": expect.any(String),
        "all-supported-returns-full-fiscal-year:2026-27": expect.any(String),
      },
    });
  });

  it("keeps the completed root when durable replacement persistence fails", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const completed = allSavedLedgers()[0];
    if (!completed) throw new Error("expected completed all-supported root");
    vi.clearAllMocks();
    zip.discard.mockResolvedValue(["all-supported-full-fiscal-year-opfs-cleared"]);
    stored.failReplacementSet = true;

    await expect(
      restartCompletedAllSupportedFullFiscalYearPlan(
        { ...request, ledgerId: completed.ledgerId },
        deps,
        runner,
      ),
    ).rejects.toThrow("synthetic replacement persistence failure");

    // Persistence is the point of no return: if it fails, the history shown
    // to the reader stays indexed and the fresh portal runner never starts.
    expect(allSavedLedgers()).toHaveLength(1);
    expect(allSavedLedgers()[0]?.ledgerId).toBe(completed.ledgerId);
    expect(runner).not.toHaveBeenCalled();
  });

  it("describes each target in an action response exactly as the reopened panel does", async () => {
    // Every runner action returns a summary, and the popup writes it into the same slot the polled
    // summary fills. Two builders produced them, and #359 corrected how a declined format reads in
    // only one -- so a year read one way straight after an action and another once reopened.
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected an expandable plan");
    let ledger = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      NOW,
    );
    const target = ledger.targets.find((candidate) => candidate.returnType === "GSTR-2B");
    if (!target) throw new Error("expected a GSTR-2B target");
    ledger = markAllSupportedFullFiscalYearTargetRunning(ledger, target.targetId, NOW);
    ledger = markAllSupportedFullFiscalYearTargetTerminal(
      ledger,
      target.targetId,
      "not-generated",
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
        state: "candidate-not-found",
        safeSignals: [
          "filed-gstr2b-not-generated",
          "gstr2b-summary-route-verified",
          "gstr2b-visible-period-verified",
          "filed-return-artifact-unavailable:PDF",
        ],
        safeMessage: "Synthetic not-generated result.",
      },
      NOW,
    );
    expect(isAllSupportedFullFiscalYearLedger(ledger)).toBe(true);
    await persistAllSupportedFullFiscalYearLedger(deps, ledger);
    vi.clearAllMocks();

    // A refused restart is the shortest action that returns a summary without running a target.
    const response = await restartCompletedAllSupportedFullFiscalYearPlan(
      { ...request, ledgerId: ledger.ledgerId },
      deps,
      vi.fn<SinglePeriodRunner>(),
    );
    const reopened = await readCurrentAllSupportedFullFiscalYearFlowSummary(deps);

    const actionEvidence =
      "allSupportedFullFiscalYearFlowSummary" in response
        ? response.allSupportedFullFiscalYearFlowSummary?.targetEvidence
        : undefined;
    expect(actionEvidence).toBeDefined();
    expect(actionEvidence).toEqual(reopened?.targetEvidence);
  });

  it("refuses to discard a root that has not finished, and leaves it saved", async () => {
    // The panel only offers this control on a completed card, so this guard is
    // the one that holds when the message arrives from a stale panel or an
    // MV3 worker that restarted mid-run. Removing it passed the whole suite.
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected an expandable plan");
    const started = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      NOW,
    );
    const running = markAllSupportedFullFiscalYearTargetRunning(
      started,
      started.targets[0]!.targetId,
      NOW,
    );
    expect(running.status).not.toBe("complete");
    await persistAllSupportedFullFiscalYearLedger(deps, running);
    vi.clearAllMocks();

    const response = await restartCompletedAllSupportedFullFiscalYearPlan(
      { ...request, ledgerId: running.ledgerId },
      deps,
      vi.fn<SinglePeriodRunner>(),
    );

    // The outcome that matters is that nothing was destroyed: the staging is
    // untouched, the ledger is still saved, and the reader is told why.
    expect(zip.discard).not.toHaveBeenCalled();
    expect(allSavedLedgers()).toHaveLength(1);
    expect(response).toMatchObject({
      flowStep: {
        safeMessage:
          "Pack will not discard this fiscal-year plan until its saved recovery work is complete.",
      },
    });
    expect(
      (response as { flowStep: { safeSignals: readonly string[] } }).flowStep.safeSignals,
    ).toContain("all-supported-full-fiscal-year-restart-plan-not-terminal");
  });

  it("refuses a restart naming a ledger the root no longer holds", async () => {
    // The reader authorises discarding the plan they were shown. If another
    // surface replaces or completes this root in between, the indexed ledger
    // is a different plan -- and this path removes it. The fiscal year alone
    // cannot tell those apart.
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const current = allSavedLedgers()[0];
    if (!current) throw new Error("expected a saved root");
    vi.clearAllMocks();
    zip.discard.mockResolvedValue(["all-supported-full-fiscal-year-opfs-cleared"]);

    const response = await restartCompletedAllSupportedFullFiscalYearPlan(
      { ...request, ledgerId: `${current.ledgerId}-superseded` },
      deps,
      runner,
    );

    expect(zip.discard).not.toHaveBeenCalled();
    expect(allSavedLedgers()).toHaveLength(1);
    expect(allSavedLedgers()[0]?.ledgerId).toBe(current.ledgerId);
    expect(
      (response as { flowStep: { safeSignals: readonly string[] } }).flowStep.safeSignals,
    ).toContain("all-supported-full-fiscal-year-restart-plan-superseded");
    expect((response as { flowStep: { safeMessage: string } }).flowStep.safeMessage).toBe(
      "This fiscal-year plan changed since Pack showed it. Refresh this panel and check it before discarding.",
    );

    // The same request naming the ledger actually held still succeeds, so the
    // guard rejects a mismatch rather than every restart.
    await expect(
      restartCompletedAllSupportedFullFiscalYearPlan(
        { ...request, ledgerId: current.ledgerId },
        deps,
        runner,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(allSavedLedgers()).toHaveLength(1);
    expect(allSavedLedgers()[0]?.ledgerId).not.toBe(current.ledgerId);
  });

  it("retains the completed root when its scoped local cleanup fails", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    vi.clearAllMocks();
    zip.discard.mockResolvedValue(["all-supported-full-fiscal-year-opfs-clear-failed"]);

    const current = allSavedLedgers()[0];
    if (!current) throw new Error("expected the completed all-supported root");
    const response = await restartCompletedAllSupportedFullFiscalYearPlan(
      { ...request, ledgerId: current.ledgerId },
      deps,
      runner,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeMessage:
          "Pack could not clear the retained local staging for this fiscal-year plan. The saved plan remains unchanged.",
      },
    });
    expect(allSavedLedgers()).toHaveLength(1);
    expect(stored.values["all-supported-index"]).toBeDefined();
  });

  it("persists every atomic target, pins one tab, and completes only after the exact ZIP handoff", async () => {
    const requiredTabIds: Array<number | undefined> = [];
    const runner = vi.fn<SinglePeriodRunner>(async (_scope, runDeps, options) => {
      requiredTabIds.push(options?.requiredPortalTabId);
      const ledger = savedLedger();
      expect(ledger.targets.some((target) => target.status === "running")).toBe(true);
      expect(runDeps.persistTargetReview).toBe(false);
      expect(runDeps.stageCapturedDownloads).toEqual({
        bundleKind: "all-supported-full-fiscal-year",
        ledgerId: ledger.ledgerId,
      });
      await options?.onPortalTabSelected?.(9, "synthetic-tab-session");
      return notFiledStep();
    });

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      ok: true,
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    const summary =
      "allSupportedFullFiscalYearFlowSummary" in response
        ? response.allSupportedFullFiscalYearFlowSummary
        : null;
    expect(summary?.completedTargetIds).toHaveLength(9);
    expect(runner).toHaveBeenCalledTimes(9);
    expect(requiredTabIds).toEqual([undefined, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect(zip.export).toHaveBeenCalledOnce();
    expect(zip.discard).toHaveBeenCalledOnce();
    expect(savedLedger()).toMatchObject({
      status: "complete",
      zipPhase: "cleaned-after-download",
      portalTabId: 9,
      portalTabSessionId: "synthetic-tab-session",
    });
    const reopened = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    expect(reopened).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(runner).toHaveBeenCalledTimes(9);
    expect(zip.export).toHaveBeenCalledOnce();
  });

  it("keeps every retained terminal root in a completed action response", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    await startAllSupportedFullFiscalYearDownloadFlow(
      { ...request, financialYear: "2025-26" },
      deps,
      runner,
    );

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: {
        terminalPlanRoots: [
          { financialYear: "2025-26", status: "complete", periodCount: 12 },
          {
            financialYear: "2026-27",
            status: "complete",
            periodCount: getFiledReturnsFullFiscalYearPeriods("2026-27", NOW).length,
          },
        ],
      },
    });

    // Each retained root names its own ledger. A restart control is rendered
    // per root, and a request that cannot name the plan the reader reviewed
    // cannot be refused when that root has been replaced since.
    const roots = (
      response as {
        allSupportedFullFiscalYearFlowSummary: {
          terminalPlanRoots: readonly { financialYear: string; ledgerId?: string }[];
        };
      }
    ).allSupportedFullFiscalYearFlowSummary.terminalPlanRoots;
    for (const root of roots) {
      const saved = allSavedLedgers().find(
        (ledger) => ledger.planRoot.financialYear === root.financialYear,
      );
      expect(root.ledgerId, `no ledger id on the ${root.financialYear} root`).toBe(saved?.ledgerId);
      expect(root.ledgerId).toBeTruthy();
    }
    expect(new Set(roots.map((root) => root.ledgerId)).size).toBe(roots.length);
  });

  it("stops at the first unresolved target and never starts a final ZIP", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => blockedStep());

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      ok: true,
      allSupportedFullFiscalYearFlowSummary: { status: "blocked" },
    });
    expect(runner).toHaveBeenCalledOnce();
    expect(zip.export).not.toHaveBeenCalled();
    expect(savedLedger().targets[0]).toMatchObject({ status: "blocked" });
    expect(
      savedLedger()
        .targets.slice(1)
        .every((target) => target.status === "pending"),
    ).toBe(true);
  });

  it("retries only retained local cleanup after a ZIP was already confirmed", async () => {
    zip.discard
      .mockResolvedValueOnce(["all-supported-full-fiscal-year-opfs-clear-failed"])
      .mockResolvedValueOnce(["all-supported-full-fiscal-year-opfs-cleared"]);
    const attemptedScopes: string[] = [];
    const runner = vi.fn<SinglePeriodRunner>(async (scope) => {
      attemptedScopes.push(`${scope.returnType}:${scope.period}:${scope.artifactType}`);
      return notFiledStep();
    });

    const first = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(first).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: {
        status: "blocked",
        resumeAvailable: true,
        resumeMode: "local-only",
      },
    });
    expect(savedLedger()).toMatchObject({ zipPhase: "downloaded-cleanup-pending" });
    const second = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(second).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(runner).toHaveBeenCalledTimes(9);
    expect(zip.export).toHaveBeenCalledOnce();
    expect(zip.discard).toHaveBeenCalledTimes(2);
  });

  it("finishes the no-artifact cleanup route without claiming a ZIP download", async () => {
    zip.export.mockImplementation(async () => noArtifactsZipStep());
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(savedLedger()).toMatchObject({
      status: "complete",
      zipPhase: "cleaned-without-export",
    });
    const step = "flowStep" in response ? response.flowStep : null;
    expect(step?.safeSignals).toContain("all-supported-full-fiscal-year-no-zip-artifacts");
    expect(step?.safeSignals).not.toContain("all-supported-full-fiscal-year-zip-downloaded");
  });

  it("records a settled not-filed target, completes later targets, and exposes its period in the completed evidence", async () => {
    const attemptedPeriods: string[] = [];
    const runner = vi.fn<SinglePeriodRunner>(async (scope) => {
      attemptedPeriods.push(`${scope.returnType}:${scope.period}`);
      return notFiledStep();
    });

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    if (!("allSupportedFullFiscalYearFlowSummary" in response)) {
      throw new Error("expected all-supported full-fiscal-year summary");
    }
    const summary = response.allSupportedFullFiscalYearFlowSummary;
    if (!summary) throw new Error("expected a completed all-supported summary");
    expect(summary).toMatchObject({ status: "complete" });
    expect(attemptedPeriods).toHaveLength(summary.totalTargets);
    expect(attemptedPeriods.slice(1)).not.toContain(attemptedPeriods[0]);
    expect(summary.allSupportedFullFiscalYearRecovery).toBeUndefined();
    expect(summary.targetEvidence[0]).toMatchObject({
      outcome: "not-filed",
      period: "April",
    });
    expect(summary.targetEvidence.slice(1).every(({ outcome }) => outcome === "not-filed")).toBe(
      true,
    );
  });

  it("turns a child-runner failure into the persisted safe blocked summary", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => ({
      ok: false as const,
      error: "synthetic child failure",
    }));

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      ok: true,
      allSupportedFullFiscalYearFlowSummary: { status: "blocked" },
    });
    expect(savedLedger().targets[0]).toMatchObject({ status: "failed" });
    expect(zip.export).not.toHaveBeenCalled();
  });

  // #366 end-to-end. The first attempt at this fix populated the summary so the recovery control
  // rendered, and stopped there -- the handler that actually mutates the ledger looked the target
  // up again without `interrupted` and refused it every time. A summary-layer test passed while
  // the button could never work. These exercise the handler.
  function interruptedRunLedger(interruptedAt: Date) {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported plan");
    const first = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      interruptedAt,
    );
    // Built through the real transitions rather than by hand: a `running` target that still holds
    // a previous outcome's signals is rejected by the ledger validator, which is how an earlier
    // hand-rolled fixture silently failed to load at all.
    return markAllSupportedFullFiscalYearTargetRunning(
      first,
      first.targets[0]!.targetId,
      interruptedAt,
    );
  }

  it("retries a target abandoned by a dead worker rather than only offering it", async () => {
    const interrupted = interruptedRunLedger(new Date("2026-07-14T23:58:00.000Z"));
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);
    const abandoned = interrupted.targets[0]!;
    expect(abandoned.status).toBe("running");

    const retryRunner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    const response = await retryAllSupportedFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: interrupted.ledgerId,
        targetId: abandoned.targetId,
        expectedRevision: interrupted.revision,
      },
      deps,
      retryRunner,
    );

    // The observable outcome, not the returned shape: the runner actually ran and the ledger
    // advanced. Before the handler fix this returned `-target-retry-unavailable` and the runner
    // was never called, for the very target the panel had just offered.
    expect(response).not.toMatchObject({
      flowStep: { safeSignals: ["all-supported-full-fiscal-year-target-retry-unavailable"] },
    });
    expect(retryRunner).toHaveBeenCalled();
    expect(savedLedger().targets[0]!.status).not.toBe("running");
    expect(savedLedger().revision).toBeGreaterThan(interrupted.revision);
  });

  it("refuses to retry an abandoned target while its run lease is still live", async () => {
    // The guard the fix must not weaken. A live lease means a worker is still behind the target,
    // and retrying would race it -- which is what the original `running` refusal protected.
    const interrupted = interruptedRunLedger(new Date("2026-07-14T23:58:00.000Z"));
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);
    deps.storageKeys.activeRun = "active-run";
    stored.values["active-run"] = {
      schemaVersion: "1.0",
      runId: "filed-returns-run-m0abc123",
      revision: 1,
      scope: {
        artifactType: "PDF",
        financialYear: request.financialYear,
        period: "April",
        returnType: "GSTR-3B",
      },
      status: "running",
      leaseUpdatedAt: NOW.toISOString(),
    };

    try {
      const retryRunner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
      const response = await retryAllSupportedFullFiscalYearTarget(
        {
          financialYear: request.financialYear,
          ledgerId: interrupted.ledgerId,
          targetId: interrupted.targets[0]!.targetId,
          expectedRevision: interrupted.revision,
        },
        deps,
        retryRunner,
      );

      expect(response).toMatchObject({
        flowStep: { safeSignals: ["all-supported-full-fiscal-year-target-retry-unavailable"] },
      });
      expect(retryRunner).not.toHaveBeenCalled();
    } finally {
      delete deps.storageKeys.activeRun;
    }
  });

  it("still holds the run lease while the delegated child flow is running", async () => {
    // `try { return delegate() } finally { release() }` releases in the `finally` as soon as the
    // return expression is evaluated -- that is, before the delegate's body past its first await
    // has run at all. Every lease-holding wrapper in the flow runner had that shape, so the guard
    // that is supposed to stop two overlapping portal actions was already gone by the time any
    // portal work started. Observable from inside the child: the lease record must still be there.
    const interrupted = interruptedRunLedger(new Date("2026-07-14T23:58:00.000Z"));
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);
    deps.storageKeys.activeRun = "active-run";
    const leaseDuringChild: unknown[] = [];
    singlePeriod.run.mockImplementation(async () => {
      leaseDuringChild.push(stored.values["active-run"]);
      return notFiledStep();
    });

    try {
      await retryAllSupportedFiledReturnsFullFiscalYearTarget(
        {
          financialYear: request.financialYear,
          ledgerId: interrupted.ledgerId,
          targetId: interrupted.targets[0]!.targetId,
          expectedRevision: interrupted.revision,
        },
        deps,
      );

      expect(leaseDuringChild.length).toBeGreaterThan(0);
      for (const lease of leaseDuringChild) expect(lease).toBeDefined();
      // And it is released once, on the way out.
      expect(stored.values["active-run"]).toBeUndefined();
    } finally {
      delete deps.storageKeys.activeRun;
    }
  });

  it("retries an abandoned target through the real handler, which holds the lease itself", async () => {
    // The wrapper `background.ts` actually registers acquires the shared run lease before
    // delegating, so the inner derivation read a live lease this very call had just written and
    // refused every retry. The two tests above both call the inner function directly and cannot
    // see it. A successful acquisition is itself the proof no other worker holds the plan.
    const interrupted = interruptedRunLedger(new Date("2026-07-14T23:58:00.000Z"));
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);
    const abandoned = interrupted.targets[0]!;
    expect(abandoned.status).toBe("running");
    deps.storageKeys.activeRun = "active-run";

    try {
      const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
        {
          financialYear: request.financialYear,
          ledgerId: interrupted.ledgerId,
          targetId: abandoned.targetId,
          expectedRevision: interrupted.revision,
        },
        deps,
      );

      expect(response).not.toMatchObject({
        flowStep: { safeSignals: ["all-supported-full-fiscal-year-target-retry-unavailable"] },
      });
      expect(singlePeriod.run).toHaveBeenCalled();
      expect(savedLedger().targets[0]!.status).not.toBe("running");
      expect(savedLedger().revision).toBeGreaterThan(interrupted.revision);
      // The lease this call took is its own, and it must not survive the call.
      expect(stored.values["active-run"]).toBeUndefined();
    } finally {
      delete deps.storageKeys.activeRun;
    }
  });

  it("retries through the real handler past a stale lease this plan's dead run left behind", async () => {
    // The live run behind #374: the worker died mid-target and its lease stayed in storage. Before
    // the fix the retry the plan offered went to `acquireFiledReturnsRun`, found that stale lease,
    // and refused -- so the only way forward was a separate "Reset stuck run" the reader had to find
    // first. The lease records this plan root as its owner, so the plan's retry takes it over.
    const interrupted = interruptedRunLedger(new Date("2026-07-14T23:58:00.000Z"));
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported plan");
    const first = expansion.targets[0]!;
    deps.storageKeys.activeRun = "active-run";
    stored.values["active-run"] = {
      schemaVersion: "1.0",
      runId: "filed-returns-run-m0abc123",
      revision: 3,
      scope: {
        financialYear: request.financialYear,
        period: "FULL_FISCAL_YEAR",
        returnType: first.returnType,
        artifactType: first.artifactType,
      },
      status: "running",
      leaseUpdatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      owner: allSupportedFullFiscalYearPlanRootKey(request),
    };

    try {
      const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
        {
          financialYear: request.financialYear,
          ledgerId: interrupted.ledgerId,
          targetId: interrupted.targets[0]!.targetId,
          expectedRevision: interrupted.revision,
        },
        deps,
      );

      expect(response).not.toMatchObject({
        flowStep: { safeSignals: ["filed-returns-run-needs-review"] },
      });
      expect(singlePeriod.run).toHaveBeenCalled();
      expect(savedLedger().targets[0]!.status).not.toBe("running");
      // One retry starts the retried target exactly once. A live run after this fix showed three
      // attempts on a target retried after a stopped worker, and the runner increments `attempts`
      // in one place -- each time it starts a target -- so this pins that the takeover path cannot
      // be the source of an extra portal attempt from a single click.
      expect(savedLedger().targets[0]!.attempts).toBe(interrupted.targets[0]!.attempts + 1);
      const retriedTargetScope = interrupted.targets[0]!;
      const startsOfRetriedTarget = singlePeriod.run.mock.calls.filter(([scope]) => {
        const s = scope as { returnType?: string; period?: string };
        return (
          s.returnType === retriedTargetScope.returnType && s.period === retriedTargetScope.period
        );
      });
      expect(startsOfRetriedTarget).toHaveLength(1);
      // Taken over, then released on the way out -- not left behind for the next action to trip on.
      expect(stored.values["active-run"]).toBeUndefined();
    } finally {
      delete deps.storageKeys.activeRun;
    }
  });

  it("refuses to take over another flow's stale lease that merely shares this plan's scope", async () => {
    // The adversarial-review Critical on #375, reproduced the way it was found. Every all-supported
    // plan anchors its lease to its first target -- GSTR-3B, PDF and JSON -- which is exactly the
    // scope of a plain single-return GSTR-3B full-year run. When that other run dies it leaves a
    // stale lease with no owner, and before owners existed a retry of ANY target in this plan took it
    // over and released it, erasing the only record that the GSTR-3B run was interrupted.
    //
    // Retrying a GSTR-1 target keeps the scenario honest: nothing about the target being retried
    // has anything to do with the GSTR-3B run whose evidence is at stake.
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported plan");
    const gstr1Index = expansion.targets.findIndex((target) => target.returnType === "GSTR-1");
    expect(gstr1Index).toBeGreaterThan(0);
    const startedAt = new Date("2026-07-14T23:58:00.000Z");
    const base = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      startedAt,
    );
    const gstr1Target = base.targets.find((target) => target.returnType === "GSTR-1")!;
    const interrupted = markAllSupportedFullFiscalYearTargetRunning(
      base,
      gstr1Target.targetId,
      startedAt,
    );
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);

    const first = expansion.targets[0]!;
    const otherFlowsLease = {
      schemaVersion: "1.0",
      runId: "filed-returns-run-m0stuck1",
      revision: 5,
      scope: {
        financialYear: request.financialYear,
        period: "FULL_FISCAL_YEAR",
        returnType: first.returnType,
        artifactType: first.artifactType,
      },
      status: "running",
      leaseUpdatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    deps.storageKeys.activeRun = "active-run";
    stored.values["active-run"] = structuredClone(otherFlowsLease);

    try {
      const response = await retryAllSupportedFiledReturnsFullFiscalYearTarget(
        {
          financialYear: request.financialYear,
          ledgerId: interrupted.ledgerId,
          targetId: gstr1Target.targetId,
          expectedRevision: interrupted.revision,
        },
        deps,
      );

      expect(response).toMatchObject({
        flowStep: { safeSignals: ["filed-returns-run-needs-review"] },
      });
      expect(singlePeriod.run).not.toHaveBeenCalled();
      // The observable outcome that matters: the other run's lease is exactly as it was left, so its
      // interruption is still there for someone to review.
      expect(stored.values["active-run"]).toEqual(otherFlowsLease);
    } finally {
      delete deps.storageKeys.activeRun;
    }
  });

  it("treats a stale run as active while its lease is live, and does not replay it", async () => {
    // The branch in `continueSavedAllSupportedFullFiscalYearRun` that the lease-aware derivation
    // changed, and which no test covered. A ledger past the 30s staleness window is NOT interrupted
    // while a worker still holds the lease -- an atomic child can legitimately outlive that window,
    // which is precisely why age alone was the wrong test.
    const interrupted = interruptedRunLedger(new Date("2026-07-14T23:58:00.000Z"));
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);
    deps.storageKeys.activeRun = "active-run";
    stored.values["active-run"] = {
      schemaVersion: "1.0",
      runId: "filed-returns-run-m0abc123",
      revision: 1,
      scope: {
        artifactType: "PDF",
        financialYear: request.financialYear,
        period: "April",
        returnType: "GSTR-3B",
      },
      status: "running",
      leaseUpdatedAt: NOW.toISOString(),
    };

    try {
      const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
      const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

      // Reported as still running, not interrupted, and still never replayed.
      expect(response).toMatchObject({
        allSupportedFullFiscalYearFlowSummary: { status: "running" },
      });
      expect(response).not.toMatchObject({
        flowStep: { safeSignals: ["all-supported-full-fiscal-year-run-interrupted"] },
      });
      expect(runner).not.toHaveBeenCalled();
    } finally {
      delete deps.storageKeys.activeRun;
    }
  });

  it("keeps a stale running target in explicit review without replaying it", async () => {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported plan");
    const interruptedAt = new Date("2026-07-14T23:58:00.000Z");
    const first = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      interruptedAt,
    );
    const completed = markAllSupportedFullFiscalYearTargetTerminal(
      first,
      first.targets[0]!.targetId,
      "not-filed",
      notFiledPortalStep(),
      interruptedAt,
    );
    const interrupted = markAllSupportedFullFiscalYearTargetRunning(
      completed,
      completed.targets[1]!.targetId,
      interruptedAt,
    );
    await persistAllSupportedFullFiscalYearLedger(deps, interrupted);
    const attemptedScopes: string[] = [];
    const runner = vi.fn<SinglePeriodRunner>(async (scope) => {
      attemptedScopes.push(`${scope.returnType}:${scope.period}`);
      return notFiledStep();
    });

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    // `blocked`, not `running`. This assertion previously read `running` and so froze a
    // disagreement: the flow step said the run was interrupted while the summary beside it still
    // reported it as running, because the two were derived from different facts. The polled
    // summary has always projected this state as `blocked`; the action response now agrees.
    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "blocked" },
      flowStep: {
        state: "user-action-required",
        safeSignals: ["all-supported-full-fiscal-year-run-interrupted"],
      },
    });
    // Unchanged and load-bearing: an interrupted run is never replayed on its own.
    expect(runner).not.toHaveBeenCalled();
    expect(attemptedScopes).toEqual([]);
    expect(savedLedger().targets[0]).toMatchObject({ status: "not-filed", attempts: 0 });
    expect(savedLedger().targets[1]).toMatchObject({ status: "running", attempts: 1 });
  });

  it("continues a partial checkpoint with only pending work against its original target plan", async () => {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported plan");
    const checkpoint = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      new Date("2026-07-14T23:58:00.000Z"),
    );
    const partialCheckpoint = { ...checkpoint, status: "partial" as const };
    expect(partialCheckpoint.status).toBe("partial");
    await persistAllSupportedFullFiscalYearLedger(deps, partialCheckpoint);
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(runner).toHaveBeenCalledTimes(partialCheckpoint.targets.length);
    expect(savedLedger().targetPlan).toEqual(partialCheckpoint.targetPlan);
  });

  it("retries only the current reviewed all-supported target after persisting its reset", async () => {
    const blockedRunner = vi.fn<SinglePeriodRunner>(async () => blockedStep());
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, blockedRunner);
    const blocked = savedLedger();
    const blockedTarget = blocked.targets[0];
    if (!blockedTarget) throw new Error("expected the first target to be blocked");
    expect(blockedTarget.status).toBe("blocked");
    expect(blocked.targets.slice(1).every((target) => target.status === "pending")).toBe(true);

    const staleRunner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    const staleResponse = await retryAllSupportedFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: blocked.ledgerId,
        targetId: blockedTarget.targetId,
        expectedRevision: blocked.revision + 1,
      },
      deps,
      staleRunner,
    );
    expect(staleResponse).toMatchObject({
      flowStep: { safeSignals: ["all-supported-full-fiscal-year-recovery-stale"] },
    });
    expect(staleRunner).not.toHaveBeenCalled();

    const retriedScopes: string[] = [];
    const retryRunner = vi.fn<SinglePeriodRunner>(async (scope) => {
      retriedScopes.push(`${scope.returnType}:${scope.period}:${scope.artifactType}`);
      return notFiledStep();
    });
    const response = await retryAllSupportedFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: blocked.ledgerId,
        targetId: blockedTarget.targetId,
        expectedRevision: blocked.revision,
      },
      deps,
      retryRunner,
    );

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(retriedScopes[0]).toBe(
      `${blockedTarget.returnType}:${blockedTarget.period}:${blockedTarget.artifactType}`,
    );
    expect(retriedScopes).toHaveLength(blocked.targets.length);
    expect(savedLedger().targets[0]).toMatchObject({ status: "not-filed", attempts: 2 });
    expect(savedLedger().revision).toBeGreaterThan(blocked.revision);
  });

  it.each(["filed-gstr2b-not-generated", "artifact-filed-gstr2b-not-generated"])(
    "stops a fresh all-supported run when staged output conflicts with %s",
    async (refusal) => {
      const runner = vi.fn<SinglePeriodRunner>(async (scope, childDeps) => {
        if (scope.returnType !== "GSTR-2B") return notFiledStep();
        expect(childDeps.stageCapturedDownloads).toMatchObject({
          bundleKind: "all-supported-full-fiscal-year",
          ledgerId: expect.any(String),
        });
        // The selected-artifact runner accumulates the first format's staging evidence
        // before returning the subsequent format's refusal to this active year loop.
        return {
          ok: true as const,
          flowStep: {
            connectorId: "gst" as const,
            scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
            state: "candidate-not-found" as const,
            safeSignals: [
              "filed-return-artifact-downloaded:PDF",
              "all-supported-full-fiscal-year-opfs-staged:PDF",
              refusal,
              "gstr2b-summary-route-verified",
              "gstr2b-visible-period-verified",
            ],
            safeMessage: "Synthetic later-format refusal.",
          },
        };
      });

      const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
      const ledger = savedLedger();
      const blockedIndex = ledger.targets.findIndex((target) => target.returnType === "GSTR-2B");
      expect(blockedIndex).toBeGreaterThanOrEqual(0);
      const target = ledger.targets[blockedIndex]!;
      expect(runner).toHaveBeenCalledTimes(blockedIndex + 1);
      expect(target).toMatchObject({
        status: "blocked",
        safeMessage: expect.stringContaining("retained a captured artifact"),
        safeSignals: expect.arrayContaining([
          "all-supported-full-fiscal-year-opfs-staged:PDF",
          "filed-return-artifact-downloaded:PDF",
          refusal,
        ]),
      });
      expect(
        ledger.targets.slice(blockedIndex + 1).every((item) => item.status === "pending"),
      ).toBe(true);
      expect(ledger.zipPhase).toBeUndefined();
      expect(isAllSupportedFullFiscalYearLedger(ledger)).toBe(true);
      expect(response).toMatchObject({
        flowStep: { state: "blocked", safeMessage: target.safeMessage },
      });
      expect(zip.export).not.toHaveBeenCalled();
      expect(zip.discard).not.toHaveBeenCalled();

      runner.mockClear();
      const reopened = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
      expect(reopened).toMatchObject({
        flowStep: { state: "blocked", safeMessage: target.safeMessage },
      });
      expect(runner).not.toHaveBeenCalled();
      expect(savedLedger()).toEqual(ledger);
      expect(zip.export).not.toHaveBeenCalled();
      expect(zip.discard).not.toHaveBeenCalled();
    },
  );

  it("blocks a later bound GSTR-2B refusal after a staged artifact without exporting again", async () => {
    const firstRunner = vi.fn<SinglePeriodRunner>(async (scope) =>
      scope.returnType === "GSTR-2B"
        ? {
            ok: true as const,
            flowStep: {
              connectorId: "gst" as const,
              scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
              state: "downloaded" as const,
              safeSignals: [
                "filed-return-artifact-downloaded:PDF",
                "all-supported-full-fiscal-year-opfs-staged:PDF",
              ],
              safeMessage: "Synthetic staged artifact.",
            },
          }
        : notFiledStep(),
    );
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, firstRunner);
    const checkpoint = savedLedger();
    const target = checkpoint.targets.find((candidate) => candidate.returnType === "GSTR-2B");
    if (!target) throw new Error("expected a GSTR-2B target");
    vi.clearAllMocks();
    const refusalRunner = vi.fn<SinglePeriodRunner>(async () => ({
      ok: true as const,
      flowStep: {
        connectorId: "gst" as const,
        scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
        state: "candidate-not-found" as const,
        safeSignals: [
          "filed-gstr2b-not-generated",
          "gstr2b-summary-route-verified",
          "gstr2b-visible-period-verified",
        ],
        safeMessage: "Synthetic bound refusal.",
      },
    }));

    const response = await retryAllSupportedFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: checkpoint.ledgerId,
        targetId: target.targetId,
        expectedRevision: checkpoint.revision,
      },
      deps,
      refusalRunner,
    );

    expect(response).toMatchObject({ flowStep: { state: "blocked" } });
    expect("flowStep" in response ? response.flowStep.safeMessage : "").toContain(
      "retained a captured artifact",
    );
    expect(refusalRunner).toHaveBeenCalledOnce();
    expect(zip.export).not.toHaveBeenCalled();
    const retained = savedLedger();
    expect(
      retained.targets.find((candidate) => candidate.targetId === target.targetId),
    ).toMatchObject({
      status: "blocked",
      safeSignals: expect.arrayContaining(["all-supported-full-fiscal-year-opfs-staged:PDF"]),
    });
  });

  it("refuses a retry that names a different reviewed target", async () => {
    const blockedRunner = vi.fn<SinglePeriodRunner>(async () => blockedStep());
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, blockedRunner);
    const blocked = savedLedger();
    const blockedSnapshot = structuredClone(blocked);
    const blockedTarget = blocked.targets[0];
    if (!blockedTarget) throw new Error("expected the first target to be blocked");
    const retryRunner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    const response = await retryAllSupportedFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: blocked.ledgerId,
        targetId: `${blockedTarget.targetId}-different`,
        expectedRevision: blocked.revision,
      },
      deps,
      retryRunner,
    );

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["all-supported-full-fiscal-year-target-retry-unavailable"],
      },
    });
    expect(retryRunner).not.toHaveBeenCalled();
    expect(savedLedger().targets[0]).toMatchObject({ status: "blocked", attempts: 1 });
    expect(savedLedger()).toEqual(blockedSnapshot);
  });

  it("preserves the final-ZIP refusal reason for a current reviewed ledger", async () => {
    zip.export.mockImplementation(async (_ledger, _step, checkpoints) => {
      await checkpoints.onBeforeDownloadStart(new Date("2026-07-15T00:01:00.000Z"), {
        lifecycle: "intent",
        safeSignals: [],
      });
      await checkpoints.onDownloadStarted(41);
      return unconfirmedZipStep();
    });
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const finalZipRecovery = savedLedger();
    const retryRunner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    expect(isAllSupportedFullFiscalYearLedger(finalZipRecovery)).toBe(true);
    expect(finalZipRecovery.zipPhase).toBe("download-observing");
    const response = await retryAllSupportedFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: finalZipRecovery.ledgerId,
        targetId: finalZipRecovery.targets[0]!.targetId,
        expectedRevision: finalZipRecovery.revision,
      },
      deps,
      retryRunner,
    );

    expect(response).toMatchObject({
      flowStep: {
        safeSignals: ["all-supported-full-fiscal-year-target-retry-final-zip"],
        safeMessage: "Pack cannot retry an individual target after it started final ZIP recovery.",
      },
    });
    expect(retryRunner).not.toHaveBeenCalled();
    expect(savedLedger()).toEqual(finalZipRecovery);
  });

  it("creates a new completed plan when the current eligible period has advanced", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const completedPlan = savedLedger();
    const completedCallCount = runner.mock.calls.length;
    deps.now = () => new Date("2026-10-25T00:00:00.000Z");

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(savedLedger().ledgerId).not.toBe(completedPlan.ledgerId);
    expect(savedLedger().targetPlan.length).toBeGreaterThan(completedPlan.targetPlan.length);
    expect(runner.mock.calls.length).toBeGreaterThan(completedCallCount);
  });

  it("records each return type's own current-year eligible periods", async () => {
    deps.now = () => new Date("2026-07-13T12:30:00.000Z");
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    const periodPlan = savedLedger().periodPlan;
    expect(periodPlan).toEqual([
      { returnType: "GSTR-3B", periods: ["April", "May"] },
      { returnType: "GSTR-1", periods: ["April", "May", "June"] },
      { returnType: "GSTR-2B", periods: ["April", "May"] },
    ]);
    expect(savedLedger().targetPlan.some((target) => target.returnType === "GSTR-1")).toBe(true);
  });

  it("does not replace a completed plan when clock correction narrows eligibility", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const completedPlan = savedLedger();
    const completedCallCount = runner.mock.calls.length;
    deps.now = () => new Date("2026-06-15T00:00:00.000Z");

    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(savedLedger().ledgerId).toBe(completedPlan.ledgerId);
    expect(runner).toHaveBeenCalledTimes(completedCallCount);
  });

  it("does not restart a completed plan when the selected year has no eligible periods", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const completedPlan = savedLedger();
    const completedCallCount = runner.mock.calls.length;
    deps.now = () => new Date("2026-04-01T00:00:00.000Z");

    const response = await restartCompletedAllSupportedFullFiscalYearPlan(
      { ...request, ledgerId: completedPlan.ledgerId },
      deps,
      runner,
    );

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-no-eligible-periods"],
        safeMessage:
          "No periods in FY 2026-27 have reached Pack's conservative availability-or-filing cut-off yet.",
      },
    });
    expect(zip.discard).toHaveBeenCalledWith(completedPlan.ledgerId);
    expect(runner).toHaveBeenCalledTimes(completedCallCount);
  });

  it("surfaces a malformed saved-plan index without starting portal work", async () => {
    stored.values["all-supported-index"] = { schemaVersion: "3.0", ledgerIdsByPlanRoot: {} };
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-plan-index-malformed"],
      },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("names unavailable provenance from a stored pre-change plan without starting portal work", async () => {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported plan");
    const ledger = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      NOW,
    );
    const legacyLedger = structuredClone(ledger) as unknown as Record<string, unknown>;
    delete legacyLedger.planProvenance;
    stored.values[allSupportedFullFiscalYearPlanStorageKey(ledger.ledgerId)] = {
      ...legacyLedger,
      schemaVersion: "1.0",
    };
    stored.values["all-supported-index"] = {
      schemaVersion: "1.0",
      ledgerIdsByPlanRoot: {
        "all-supported-returns-full-fiscal-year:2026-27": ledger.ledgerId,
      },
    };
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-plan-provenance-unavailable"],
        // Derived, not transcribed: a message naming a control the product does
        // not carry is an instruction the reader cannot follow, and this is the
        // only saved-plan state whose escape is Options rather than the panel.
        safeMessage: expect.stringContaining(PACK_CLEAR_LOCAL_DATA_ACTION_LABEL),
      },
    });
    expect(runner).not.toHaveBeenCalled();
    expect(stored.values["all-supported-index"]).toMatchObject({ schemaVersion: "2.0" });
  });

  it("rejects a ledger whose target plan and provenance agree on an untrusted artifact set", () => {
    const expansion = expandAllSupportedFullFiscalYearTargetPlan();
    if (!expansion.ok) throw new Error("expected all-supported plan");
    const checkpoint = createAllSupportedFullFiscalYearLedger(
      request,
      expansion.targets,
      FILED_RETURNS_MONTHS.slice(0, 3),
      new Date("2026-07-14T23:58:00.000Z"),
    );
    const snapshotTarget = checkpoint.targets.find(
      (target) => target.artifactType === "PDF_AND_EXCEL",
    );
    if (!snapshotTarget) throw new Error("expected composite artifact target");
    const changedSnapshot = ["PDF", "EXCEL", "JSON"] as const;
    checkpoint.targetPlan = checkpoint.targetPlan.map((target) =>
      target.returnType === snapshotTarget.returnType
        ? { ...target, concreteArtifactTypes: changedSnapshot }
        : target,
    );
    checkpoint.planProvenance = {
      ...checkpoint.planProvenance,
      returnPlan: checkpoint.planProvenance.returnPlan.map((target) =>
        target.returnType === snapshotTarget.returnType
          ? { ...target, concreteArtifactTypes: changedSnapshot }
          : target,
      ),
    };
    checkpoint.targets = checkpoint.targets.map((target) =>
      target.returnType === snapshotTarget.returnType
        ? { ...target, concreteArtifactTypes: changedSnapshot }
        : target,
    );
    expect(isAllSupportedFullFiscalYearLedger(checkpoint)).toBe(false);
  });

  it("reconciles only the exact persisted final ZIP ID after a worker restart", async () => {
    zip.export.mockImplementation(async (_ledger, _step, checkpoints) => {
      await checkpoints.onBeforeDownloadStart(new Date("2026-07-15T00:01:00.000Z"), {
        lifecycle: "intent",
        safeSignals: [],
      });
      await checkpoints.onDownloadStarted(41);
      return unconfirmedZipStep();
    });
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    expect(savedLedger()).toMatchObject({ zipPhase: "download-observing" });

    await expect(reconcilePendingAllSupportedFullFiscalYearZipDownload(42, deps)).resolves.toBe(
      false,
    );
    expect(zip.reconcile).not.toHaveBeenCalled();

    zip.reconcile.mockResolvedValueOnce(downloadedZipStep());
    await expect(reconcilePersistedAllSupportedFullFiscalYearZipDownload(deps)).resolves.toBe(true);

    expect(zip.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        ledgerId: savedLedger().ledgerId,
        zipDownloadAttempt: expect.objectContaining({ downloadId: 41 }),
      }),
      expect.anything(),
    );
    expect(savedLedger()).toMatchObject({ status: "complete", zipPhase: "cleaned-after-download" });
  });

  it("fails closed when two all-supported ledgers claim the same ZIP download ID", async () => {
    zip.export.mockImplementation(async (_ledger, _step, checkpoints) => {
      await checkpoints.onBeforeDownloadStart(new Date("2026-07-15T00:01:00.000Z"), {
        lifecycle: "intent",
        safeSignals: [],
      });
      await checkpoints.onDownloadStarted(41);
      return unconfirmedZipStep();
    });
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    await startAllSupportedFullFiscalYearDownloadFlow(
      { ...request, financialYear: "2025-26" },
      deps,
      runner,
    );

    await expect(reconcilePendingAllSupportedFullFiscalYearZipDownload(41, deps)).resolves.toBe(
      false,
    );
    await expect(reconcilePersistedAllSupportedFullFiscalYearZipDownload(deps)).resolves.toBe(
      false,
    );
    expect(zip.reconcile).not.toHaveBeenCalled();
    await expect(
      startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner),
    ).resolves.toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "blocked" },
    });
    expect(zip.reconcile).not.toHaveBeenCalled();
    expect(allSavedLedgers()).toHaveLength(2);
    expect(allSavedLedgers().every((ledger) => ledger.zipPhase === "download-observing")).toBe(
      true,
    );
  });
});

function savedLedger() {
  const ledger = allSavedLedgers()[0];
  if (!ledger) throw new Error("expected persisted all-supported ledger");
  return ledger;
}

function allSavedLedgers() {
  return Object.entries(stored.values)
    .filter(([key]) => key.startsWith("pack:filed-returns-all-supported-plan:"))
    .map(([, value]) => value)
    .filter(isAllSupportedFullFiscalYearLedger);
}

function notFiledStep(): PackMessageResponse {
  return {
    ok: true as const,
    flowStep: notFiledPortalStep(),
  };
}

function notFiledPortalStep(): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    state: "candidate-not-found",
    safeSignals: ["filed-return-positively-not-filed"],
    safeMessage: "Synthetic not-filed result.",
  };
}

function blockedStep(): PackMessageResponse {
  return {
    ok: true as const,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "blocked",
      safeSignals: ["no-filed-returns-candidate"],
      safeMessage: "Synthetic blocked result.",
    },
  };
}

function downloadedZipStep(): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    state: "downloaded",
    safeSignals: ["all-supported-full-fiscal-year-zip-downloaded"],
    safeMessage: "Synthetic ZIP download evidence.",
  };
}

function unconfirmedZipStep(): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    state: "download-unconfirmed",
    safeSignals: ["all-supported-full-fiscal-year-zip-download-unconfirmed"],
    safeMessage: "Synthetic ZIP review state.",
  };
}

function noArtifactsZipStep(): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    state: "downloaded",
    safeSignals: ["all-supported-full-fiscal-year-no-zip-artifacts"],
    safeMessage: "Synthetic no-artifact outcome.",
  };
}
