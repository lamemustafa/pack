import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
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
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";

const stored = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
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
  stored.values = {};
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
    const runner = vi.fn<SinglePeriodRunner>(async () => notFiledStep());

    const first = await startAllSupportedFullFiscalYearDownloadFlow(request, deps, runner);

    expect(first).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "blocked" },
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

  it("resumes a stale interrupted target without replaying its completed predecessor", async () => {
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
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
    expect(runner).toHaveBeenCalledTimes(interrupted.targets.length - 1);
    expect(attemptedScopes).not.toContain(
      `${interrupted.targets[0]!.returnType}:${interrupted.targets[0]!.period}`,
    );
    expect(savedLedger().targets[0]).toMatchObject({ status: "not-filed", attempts: 0 });
    expect(savedLedger().targets[1]).toMatchObject({ status: "not-filed", attempts: 2 });
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
