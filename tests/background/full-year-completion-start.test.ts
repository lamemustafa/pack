import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import {
  type SinglePeriodRunner,
  startFullFiscalYearDownloadFlow,
} from "../../src/background/filed-returns-full-fiscal-year";
import {
  prepareFullFiscalYearTargetRetry,
  resolveFullFiscalYearTarget,
} from "../../src/background/filed-returns-full-fiscal-year-recovery";
import { responseForExistingLedger } from "../../src/background/filed-returns-full-fiscal-year-run-state";
import {
  fullFiscalYearTargetFlowStep,
  summariseFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-summary";
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

  it("refuses a prior browser tab pin instead of rebinding it for a validated retry", async () => {
    // A pin from an earlier browser session cannot show that the same GST account is still signed
    // in, so the retry stops with that reason rather than rebinding to whichever tab is active.
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
    const runSinglePeriod = vi.fn(async () => ({ ok: false as const, error: "Synthetic stop." }));

    const response = await startFullFiscalYearDownloadFlow(RECOVERY_SCOPE, deps, runSinglePeriod, {
      allowExistingLedgerResume: true,
    });

    expect(runSinglePeriod).not.toHaveBeenCalled();
    expect(storage.local.ledger).toMatchObject({
      portalTabId: 41,
      portalTabSessionId: "prior-browser-session",
    });
    expect(response).toMatchObject({
      flowStep: {
        state: "blocked",
        safeSignals: ["full-fiscal-year-restart-account-unverified"],
      },
      flowSummary: { status: "blocked" },
    });
  });

  it("keeps a matching-session tab pin during an explicitly validated retry", async () => {
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
      portalTabSessionId: "current-browser-session",
    };
    storage.session["pack:full-fiscal-year-tab-session"] = "current-browser-session";
    const runSinglePeriod = vi.fn(async (_scope, _deps, options) => {
      expect(options?.requiredPortalTabId).toBe(41);
      expect(options?.requiredPortalTabSessionId).toBe("current-browser-session");
      await options?.onPortalTabSelected?.(73, "current-browser-session");
      expect(storage.local.ledger).toMatchObject({
        portalTabId: 41,
        portalTabSessionId: "current-browser-session",
      });
      return { ok: false as const, error: "Synthetic stop." };
    });

    await startFullFiscalYearDownloadFlow(RECOVERY_SCOPE, deps, runSinglePeriod, {
      allowExistingLedgerResume: true,
    });

    expect(runSinglePeriod).toHaveBeenCalledTimes(1);
  });

  it("preserves an unrelated blocked reason despite retained staging", () => {
    const step = {
      connectorId: "gst" as const,
      scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
      state: "login-required" as const,
      safeSignals: ["full-fiscal-year-opfs-staged:PDF", "portal-blocked-or-session-expired"],
      safeMessage: "Synthetic session boundary requires the reader's attention.",
    };
    expect(fullFiscalYearTargetFlowStep(step, "GSTR-2B")).toEqual(step);
    expect(
      canonicalDurableTargetStatus(
        { ...RECOVERY_SCOPE, returnType: "GSTR-2B" },
        "blocked",
        step.safeSignals,
      ).safeMessage,
    ).not.toContain("retained a captured artifact");
  });

  it.each(["filed-gstr2b-not-generated", "artifact-filed-gstr2b-not-generated"])(
    "stops a fresh ordinary year run when staged output conflicts with %s",
    async (refusal) => {
      const scope = {
        ...RECOVERY_SCOPE,
        returnType: "GSTR-2B" as const,
        artifactType: "PDF_AND_EXCEL" as const,
      };
      zipMocks.exportFullFiscalYearZip.mockResolvedValue({
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
        state: "blocked",
        safeSignals: ["full-fiscal-year-zip-export-failed"],
        safeMessage: "Synthetic unexpected ZIP export.",
      });
      const runner = vi.fn<SinglePeriodRunner>(async (_scope, childDeps) => {
        expect(childDeps.stageCapturedDownloads).toMatchObject({
          bundleKind: "full-fiscal-year",
          ledgerId: expect.any(String),
        });
        return {
          ok: true as const,
          flowStep: {
            connectorId: "gst" as const,
            scopeId: "gst-filed-returns-gstr2b-pdf-private-v0",
            state: "candidate-not-found" as const,
            safeSignals: [
              "filed-return-artifact-downloaded:PDF",
              "full-fiscal-year-opfs-staged:PDF",
              refusal,
              "gstr2b-summary-route-verified",
              "gstr2b-visible-period-verified",
            ],
            safeMessage: "Synthetic later-format refusal.",
          },
        };
      });
      const response = await startFullFiscalYearDownloadFlow(scope, deps, runner);
      expect(runner).toHaveBeenCalledOnce();
      expect(isFullFiscalYearLedger(storage.local.ledger)).toBe(true);
      if (!isFullFiscalYearLedger(storage.local.ledger)) throw new Error("Expected valid ledger.");
      const ledger = structuredClone(storage.local.ledger);
      const target = ledger.targets[0]!;
      expect(target).toMatchObject({
        status: "blocked",
        safeMessage: expect.stringContaining("retained a captured artifact"),
        safeSignals: expect.arrayContaining([
          "full-fiscal-year-opfs-staged:PDF",
          "filed-return-artifact-downloaded:PDF",
          refusal,
        ]),
      });
      expect(ledger.targets.slice(1).every((item) => item.status === "pending")).toBe(true);
      expect(ledger.zipPhase).toBeUndefined();
      expect(response).toMatchObject({
        flowStep: { state: "blocked", safeMessage: target.safeMessage },
      });
      expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();

      runner.mockClear();
      const reopened = await startFullFiscalYearDownloadFlow(scope, deps, runner);
      expect(reopened).toMatchObject({
        flowStep: { state: "blocked", safeMessage: target.safeMessage },
      });
      expect(runner).not.toHaveBeenCalled();
      expect(storage.local.ledger).toEqual(ledger);
      expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
      expect(zipMocks.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    },
  );

  it("blocks an ordinary active retry after staged evidence and does not export", async () => {
    const scope = { ...RECOVERY_SCOPE, returnType: "GSTR-2B" as const };
    const ledger = makeCompletedRecoveryLedger("blocked", {
      stagedPositive: true,
      positiveFirst: true,
      returnType: "GSTR-2B",
      stagedRecovery: true,
    });
    storage.local.ledger = ledger;
    const target = ledger.targets[1]!;
    const preparation = await prepareFullFiscalYearTargetRetry(
      { ledgerId: ledger.ledgerId, targetId: target.targetId, expectedRevision: ledger.revision! },
      deps,
    );
    expect(preparation.ok).toBe(true);
    if (!preparation.ok) throw new Error("Expected retry preparation.");
    storage.local.ledger = preparation.ledger;
    const runSinglePeriod = vi.fn(async () => ({
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
    const response = await startFullFiscalYearDownloadFlow(scope, deps, runSinglePeriod, {
      allowExistingLedgerResume: true,
    });
    expect(response).toMatchObject({ flowSummary: { status: "blocked" } });
    expect(runSinglePeriod).toHaveBeenCalledOnce();
    expect(zipMocks.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(storage.local.ledger).toMatchObject({
      status: "blocked",
      targets: expect.arrayContaining([
        expect.objectContaining({
          status: "downloaded",
          safeSignals: expect.arrayContaining(["full-fiscal-year-opfs-staged:PDF"]),
        }),
        expect.objectContaining({
          status: "blocked",
          safeMessage: expect.stringContaining("retained a captured artifact"),
        }),
      ]),
    });
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
