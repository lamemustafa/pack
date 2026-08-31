import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  restartCompletedAllSupportedFullFiscalYearPlan,
  reconcilePendingAllSupportedFullFiscalYearZipDownload,
  reconcilePersistedAllSupportedFullFiscalYearZipDownload,
  startAllSupportedFullFiscalYearDownloadFlow,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year";
import type { SinglePeriodRunner } from "../../src/background/filed-returns-full-fiscal-year";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import { isAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";
import type { PackMessageResponse } from "../../src/connectors/gst/messages";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import {
  createAllSupportedFullFiscalYearLedger,
  markAllSupportedFullFiscalYearTargetRunning,
  markAllSupportedFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import { persistAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-run-state";
import {
  FILED_RETURNS_MONTHS,
  getFiledReturnsFullFiscalYearPeriods,
} from "../../src/connectors/gst/filed-returns-scope";

const stored = vi.hoisted(() => ({
  failReplacementSet: false,
  values: {} as Record<string, unknown>,
}));
const zip = vi.hoisted(() => ({
  discard: vi.fn(async () => ["all-supported-full-fiscal-year-opfs-cleared"]),
  export: vi.fn(),
  reconcile: vi.fn(),
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

const NOW = new Date("2026-07-15T00:00:00.000Z");
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
      schemaVersion: "1.0",
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

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "running" },
      flowStep: {
        state: "user-action-required",
        safeSignals: ["all-supported-full-fiscal-year-run-interrupted"],
      },
    });
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

  it("creates a new completed plan when the current eligible period has advanced", async () => {
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);
    const completedPlan = savedLedger();
    const completedCallCount = runner.mock.calls.length;
    deps.now = () => new Date("2026-08-15T00:00:00.000Z");

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(savedLedger().ledgerId).not.toBe(completedPlan.ledgerId);
    expect(savedLedger().targetPlan.length).toBeGreaterThan(completedPlan.targetPlan.length);
    expect(runner.mock.calls.length).toBeGreaterThan(completedCallCount);
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

  it("surfaces a malformed saved-plan index without starting portal work", async () => {
    stored.values["all-supported-index"] = { schemaVersion: "2.0", ledgerIdsByPlanRoot: {} };
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

  it("blocks a saved target when the current catalogue no longer matches its artifact snapshot", async () => {
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
    checkpoint.targets = checkpoint.targets.map((target) =>
      target.returnType === snapshotTarget.returnType
        ? { ...target, concreteArtifactTypes: changedSnapshot }
        : target,
    );
    await persistAllSupportedFullFiscalYearLedger(deps, checkpoint);
    const attemptedScopes: string[] = [];
    const runner = vi.fn<SinglePeriodRunner>(async (scope) => {
      attemptedScopes.push(`${scope.returnType}:${scope.period}:${scope.artifactType}`);
      return notFiledStep();
    });

    const response = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "blocked" },
      flowStep: {
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-artifact-snapshot-mismatch"],
      },
    });
    expect(attemptedScopes).not.toContain(
      `${snapshotTarget.returnType}:${snapshotTarget.period}:${snapshotTarget.artifactType}`,
    );
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
