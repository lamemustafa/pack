import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import { FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND } from "../../src/connectors/gst/filed-returns-contracts";
import {
  retryAllSupportedFullFiscalYearTarget,
  startAllSupportedFullFiscalYearDownloadFlow,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year";
import type * as ArtifactAcquisitionState from "../../src/background/artifact-acquisition-state";
import {
  startFullFiscalYearDownloadFlow,
  type SinglePeriodRunner,
} from "../../src/background/filed-returns-full-fiscal-year";
import type { FiledReturnsFlowRunnerDeps } from "../../src/background/filed-returns-flow-runner";
import {
  type ActiveGstTab,
  getFullFiscalYearTabSessionId,
  getRequiredGstTab,
} from "../../src/background/filed-returns-active-tab";
import { isAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";
import { prepareFullFiscalYearTargetRetry } from "../../src/background/filed-returns-full-fiscal-year-recovery";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { canonicalDurableSummaryMessage } from "../../src/connectors/gst/filed-returns-durable-status";
import { getRecoveryFlowAvailability } from "../../src/entrypoints/popup/recovery-flow-availability";
import { concreteFiledReturnsArtifactTypesForSelection } from "../../src/connectors/gst/filed-returns-artifacts";

/**
 * A saved plan's ZIP is one taxpayer's record, so resuming it must not continue across a different
 * signed-in account.
 *
 * Each staged file is labelled with the account open in the portal tab, so a test can see whose
 * files a plan holds. The runner calls the real `getRequiredGstTab` and
 * `getFullFiscalYearTabSessionId` in the order `startSinglePeriodFiledReturnsDownloadFlow` does, and
 * replaces only the portal click that follows with a labelled staged file.
 */

const TAB_ID = 9;
const PORTAL_TAB_URL = "https://services.gst.gov.in/services/auth/dashboard";

const portal = vi.hoisted(() => ({
  signedInAccount: "first-account" as string,
  staged: new Map<string, string[]>(),
}));
const stored = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
  sessionReadFails: false,
}));
const fullYearZip = vi.hoisted(() => ({
  discardFullFiscalYearFiledReturnsZip: vi.fn(async () => ["full-fiscal-year-opfs-cleared"]),
  exportFullFiscalYearZip: vi.fn(),
  reconcileFullFiscalYearZipDownload: vi.fn(),
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
          if (typeof key === "string") return { [key]: structuredClone(stored.local[key]) };
          return structuredClone(stored.local);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored.local[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(stored.local, structuredClone(values));
        }),
      },
      session: {
        get: vi.fn(async (key: string) => {
          if (stored.sessionReadFails) throw new Error("synthetic session storage failure");
          return { [key]: stored.session[key] };
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored.session[key];
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(stored.session, values);
        }),
      },
    },
    tabs: {
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        incognito: false,
        url: PORTAL_TAB_URL,
        windowId: 3,
      })),
      update: vi.fn(async () => undefined),
    },
    windows: { update: vi.fn(async () => undefined) },
  },
}));

vi.mock("../../src/background/artifact-acquisition-state", async (importOriginal) => ({
  ...(await importOriginal<typeof ArtifactAcquisitionState>()),
  readArtifactAcquisitionCheckpoints: vi.fn(async () => []),
}));

vi.mock("../../src/background/filed-returns-full-fiscal-year-zip", () => fullYearZip);

vi.mock("../../src/background/filed-returns-all-supported-full-fiscal-year-zip", () => ({
  discardAllSupportedFullFiscalYearFiledReturnsZip: zip.discard,
  exportAllSupportedFullFiscalYearZip: zip.export,
  reconcileAllSupportedFullFiscalYearZipDownload: zip.reconcile,
}));

const NOW = new Date("2026-07-25T00:00:00.000Z");
const SINGLE_RETURN_SCOPE = {
  artifactType: "PDF",
  financialYear: "2026-27",
  period: FULL_FISCAL_YEAR_PERIOD,
  returnType: "GSTR-3B",
} as const satisfies FiledReturnsDownloadScope;
const RESUMED_AT = new Date("2026-07-25T00:10:00.000Z");
const request = {
  kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  financialYear: "2026-27",
} as const;
const deps = {
  getActiveGstTab: vi.fn(
    async () =>
      ({ id: TAB_ID, incognito: false, url: PORTAL_TAB_URL, windowId: 3 }) as ActiveGstTab,
  ),
  sendMessageToTabWithInjection: vi.fn(),
  storageKeys: {
    allSupportedFullFiscalYearLedgerIndex: "all-supported-index",
    completion: "completion",
    fullFiscalYearLedger: "legacy-ledger",
    observation: "observation",
  },
  now: () => NOW,
} as FiledReturnsFlowRunnerDeps & {
  storageKeys: FiledReturnsFlowRunnerDeps["storageKeys"] & {
    allSupportedFullFiscalYearLedgerIndex: string;
  };
};

/** The binding half of the real single-period flow, then a portal click that stages a file. */
const portalRunner: SinglePeriodRunner = async (scope, runDeps, options = {}) => {
  const required = await getRequiredGstTab(
    runDeps.getActiveGstTab,
    options.requiredPortalTabId,
    options.requiredPortalTabSessionId,
    options.onPortalTabSelected === undefined,
  );
  if (required.state !== "ready") {
    // The refusals `startSinglePeriodFiledReturnsDownloadFlow` returns, signal and copy.
    if (
      required.state === "tab-session-unavailable" ||
      required.state === "tab-focus-unavailable"
    ) {
      const signal =
        required.state === "tab-session-unavailable"
          ? "full-fiscal-year-gst-tab-session-unavailable"
          : "filed-returns-gst-tab-focus-unavailable";
      return {
        ok: true,
        flowStep: {
          ...step("blocked", [signal]),
          safeMessage: canonicalDurableSummaryMessage(scope, "blocked", [signal]),
        },
      };
    }
    if (
      options.requiredPortalTabId !== undefined ||
      options.requiredPortalTabSessionId !== undefined
    ) {
      const signal = "full-fiscal-year-pinned-gst-tab-unavailable";
      return {
        ok: true,
        flowStep: {
          ...step("blocked", [signal]),
          safeMessage: canonicalDurableSummaryMessage(scope, "blocked", [signal]),
        },
      };
    }
    return {
      ok: true,
      flowStep: {
        ...step("login-required", ["gst-portal-tab-required"]),
        userAction: { type: "LOGIN", message: "Sign in to the GST Portal.", canResume: true },
      },
    };
  }
  if (options.onPortalTabSelected) {
    const tabSessionId = await getFullFiscalYearTabSessionId();
    if (!tabSessionId) return { ok: true, flowStep: step("blocked", ["synthetic-no-session"]) };
    await options.onPortalTabSelected(required.tab.id, tabSessionId);
  }
  const bundle = runDeps.stageCapturedDownloads;
  if (!bundle) throw new Error("expected a staged fiscal-year child run");
  const { bundleKind, ledgerId } = bundle;
  if (bundleKind !== "all-supported-full-fiscal-year" && bundleKind !== "full-fiscal-year") {
    throw new Error("expected a fiscal-year bundle");
  }
  const staged = portal.staged.get(ledgerId) ?? [];
  staged.push(portal.signedInAccount);
  portal.staged.set(ledgerId, staged);
  return { ok: true, flowStep: stagedTargetStep(scope, bundleKind) };
};

beforeEach(async () => {
  vi.clearAllMocks();
  deps.now = () => NOW;
  stored.local = {};
  stored.session = {};
  stored.sessionReadFails = false;
  portal.signedInAccount = "first-account";
  portal.staged = new Map();
  fullYearZip.exportFullFiscalYearZip.mockImplementation(async (_ledger, _step, checkpoints) => {
    await checkpoints?.onBeforeDownloadStart?.(NOW, { lifecycle: "intent", safeSignals: [] });
    await checkpoints?.onDownloadStarted?.(42);
    return step("downloaded", ["full-fiscal-year-zip-downloaded"]);
  });
  zip.export.mockImplementation(async (_ledger, _step, checkpoints) => {
    await checkpoints.onBeforeDownloadStart(NOW, { lifecycle: "intent", safeSignals: [] });
    await checkpoints.onDownloadStarted(41);
    return step("downloaded", ["all-supported-full-fiscal-year-zip-downloaded"]);
  });
});

describe("resuming an all-returns plan", () => {
  it("still resumes when the same account is signed in", async () => {
    const interrupted = await savePlanInterruptedDuringSecondTarget();

    const response = await resumeAbandonedTarget(interrupted);

    expect(new Set(portal.staged.get(interrupted.ledgerId))).toEqual(new Set(["first-account"]));
    expect(zip.export).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
  });

  it("already refuses portal work after a browser restart, offering only the discard", async () => {
    // Characterises today's behaviour, which the fix must keep: a restart clears storage.session,
    // the saved browser-session marker no longer matches, and the pinned tab is refused.
    const interrupted = await savePlanInterruptedDuringSecondTarget();
    stored.session = {};

    const response = await resumeAbandonedTarget(interrupted);

    expect(portal.staged.get(interrupted.ledgerId)).toEqual(["first-account"]);
    expect(zip.export).not.toHaveBeenCalled();
    const summary =
      "allSupportedFullFiscalYearFlowSummary" in response
        ? response.allSupportedFullFiscalYearFlowSummary
        : undefined;
    expect(summary).toMatchObject({
      status: "blocked",
      recoveryWithheld: true,
      resumeAvailable: false,
    });
    expect(summary?.flowStep.safeMessage).toContain("discard");
  });
});

describe("resuming a single-return full-year plan", () => {
  it("never stages another account's file after a restart", async () => {
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();

    // A restart clears storage.session, so the saved tab-session marker no longer matches.
    stored.session = {};
    portal.signedInAccount = "second-account";
    const response = await retrySingleReturnTarget(stopped);

    expect(new Set(portal.staged.get(stopped.ledgerId))).toEqual(new Set(["first-account"]));
    expect(fullYearZip.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(response).toHaveProperty("flowStep.safeMessage", expect.stringMatching(/\S/));
  });

  it("still resumes when the same account is signed in", async () => {
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();

    await retrySingleReturnTarget(stopped);

    expect(new Set(portal.staged.get(stopped.ledgerId))).toEqual(new Set(["first-account"]));
    expect(portal.staged.get(stopped.ledgerId)!.length).toBeGreaterThan(1);
    expect(fullYearZip.exportFullFiscalYearZip).toHaveBeenCalledOnce();
  });
});

/**
 * Runs a single-return plan for real until the portal session ends at its second period: the first
 * period is staged, the plan is pinned, and the second period is blocked with a sign-in request.
 * Signing in again and pressing retry is the route the panel offers.
 */
async function saveSingleReturnPlanStoppedAtSecondPeriod(): Promise<{
  ledgerId: string;
  targetId: string;
  revision: number;
}> {
  let calls = 0;
  const expiringRunner: SinglePeriodRunner = async (...args) => {
    calls += 1;
    if (calls === 2) {
      return {
        ok: true,
        flowStep: {
          ...step("login-required", ["gst-portal-tab-required"]),
          userAction: { type: "LOGIN", message: "Sign in again.", canResume: true },
        },
      };
    }
    return portalRunner(...args);
  };
  await startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, expiringRunner);
  const ledger = stored.local[deps.storageKeys.fullFiscalYearLedger];
  if (!isFullFiscalYearLedger(ledger)) throw new Error("expected a saved single-return plan");
  expect(ledger.targets[0]?.status).toBe("downloaded");
  expect(ledger.portalTabId).toBe(TAB_ID);
  const stopped = ledger.targets[1];
  if (!stopped || stopped.status === "pending" || stopped.status === "running") {
    throw new Error(`expected a stopped second period, found ${stopped?.status}`);
  }
  return { ledgerId: ledger.ledgerId, targetId: stopped.targetId, revision: ledger.revision ?? 1 };
}

/**
 * The restart refusal. After a restart the tab-session marker differs and tab ids do not survive,
 * so the run refuses rather than binding to another tab, whichever account is open, and the
 * refusal must not be offered back as a retry that can only refuse again.
 */
describe("a single-return full-year plan after a browser restart", () => {
  it("refuses to continue even with the same account open, and says why", async () => {
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();

    stored.session = {};
    const response = await retrySingleReturnTarget(stopped);

    expect(portal.staged.get(stopped.ledgerId)).toEqual(["first-account"]);
    expect(fullYearZip.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(fullYearZip.discardFullFiscalYearFiledReturnsZip).not.toHaveBeenCalled();
    expect(response).toHaveProperty("flowStep.state", "blocked");
    expect(response).toHaveProperty("flowStep.safeMessage", expect.stringMatching(/GST account/i));
  });

  it("refuses a retry the reader approved before the restart", async () => {
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();
    const approved = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: stopped.ledgerId,
        targetId: stopped.targetId,
        expectedRevision: stopped.revision,
      },
      deps,
    );
    if (!approved.ok) throw new Error("expected the retry to be approved before the restart");

    // The worker stops before the approved retry runs; after the restart the panel offers
    // "Resume saved run", which makes the same two calls.
    stored.session = {};
    const response = await retrySingleReturnTarget({
      ...stopped,
      revision: approved.ledger.revision ?? 1,
    });

    expect(portal.staged.get(stopped.ledgerId)).toEqual(["first-account"]);
    expect(fullYearZip.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(response).toHaveProperty("flowStep.safeMessage", expect.stringMatching(/GST account/i));
  });

  // The guard refuses portal work only. Once every target is staged, finishing the ZIP touches no
  // portal tab and stages nothing, so the account question does not arise and a restart must not
  // strand the year's files.
  it.each([
    {
      phase: "export-pending",
      how: "the worker stops during the export",
      stopBeforeRestart: async () => {
        fullYearZip.exportFullFiscalYearZip.mockRejectedValueOnce(new WorkerStopped());
        await expect(
          startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, portalRunner),
        ).rejects.toBeInstanceOf(WorkerStopped);
      },
    },
    {
      phase: "export-retry-pending",
      how: "the export fails once",
      stopBeforeRestart: async () => {
        fullYearZip.exportFullFiscalYearZip.mockResolvedValueOnce(
          step("blocked", ["full-fiscal-year-zip-export-failed"]),
        );
        await startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, portalRunner);
      },
    },
    {
      phase: "download-observing",
      how: "the worker stops after the browser download started",
      stopBeforeRestart: async () => {
        fullYearZip.exportFullFiscalYearZip.mockImplementationOnce(
          async (_ledger, _step, checkpoints) => {
            await checkpoints?.onBeforeDownloadStart?.(NOW, {
              lifecycle: "intent",
              safeSignals: [],
            });
            await checkpoints?.onDownloadStarted?.(42);
            throw new WorkerStopped();
          },
        );
        await expect(
          startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, portalRunner),
        ).rejects.toBeInstanceOf(WorkerStopped);
      },
    },
    {
      phase: "downloaded-cleanup-pending",
      how: "the ZIP downloaded but local cleanup failed",
      stopBeforeRestart: async () => {
        fullYearZip.discardFullFiscalYearFiledReturnsZip.mockResolvedValueOnce([]);
        await startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, portalRunner);
      },
    },
  ] as const)(
    "still finishes a fully staged year at $phase ($how)",
    async ({ phase, stopBeforeRestart }) => {
      fullYearZip.reconcileFullFiscalYearZipDownload.mockResolvedValue(
        step("downloaded", ["full-fiscal-year-zip-downloaded"]),
      );
      await stopBeforeRestart();
      const saved = stored.local[deps.storageKeys.fullFiscalYearLedger];
      if (!isFullFiscalYearLedger(saved)) throw new Error("expected a saved single-return plan");
      expect(saved.zipPhase).toBe(phase);
      const stagedBeforeRestart = [...(portal.staged.get(saved.ledgerId) ?? [])];
      expect(stagedBeforeRestart.length).toBe(saved.targets.length);

      stored.session = {};
      const runner = vi.fn<SinglePeriodRunner>(portalRunner);
      const response = await startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, runner);

      expect(runner).not.toHaveBeenCalled();
      expect(portal.staged.get(saved.ledgerId)).toEqual(stagedBeforeRestart);
      // Only the export phases build the ZIP again; a recorded download or a finished one must not.
      expect(fullYearZip.exportFullFiscalYearZip).toHaveBeenCalledTimes(
        phase === "export-pending" || phase === "export-retry-pending" ? 2 : 1,
      );
      expect(response).toHaveProperty("flowSummary.status", "complete");
    },
  );

  it("stays refused on every later attempt, changing nothing", async () => {
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();
    stored.session = {};
    await retrySingleReturnTarget(stopped);
    const refused = structuredClone(stored.local[deps.storageKeys.fullFiscalYearLedger]);
    if (!isFullFiscalYearLedger(refused)) throw new Error("expected the refused plan to be saved");
    const runner = vi.fn<SinglePeriodRunner>(portalRunner);

    const retried = await prepareFullFiscalYearTargetRetry(
      {
        ledgerId: refused.ledgerId,
        targetId: stopped.targetId,
        expectedRevision: refused.revision ?? 1,
      },
      deps,
    );
    const restarted = await startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, runner, {
      allowExistingLedgerResume: true,
    });
    await startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, runner);

    expect(retried.ok).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    expect(portal.staged.get(stopped.ledgerId)).toEqual(["first-account"]);
    expect(stored.local[deps.storageKeys.fullFiscalYearLedger]).toEqual(refused);
    expect(restarted).toHaveProperty("flowStep.state", "blocked");
  });

  it("fails closed when the tab-session marker cannot be read", async () => {
    // Not a restart, just unreadable session storage: the pre-check cannot compare, so the pinned
    // child run must refuse on its own named reason rather than proceed.
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();
    stored.sessionReadFails = true;

    const response = await retrySingleReturnTarget(stopped);

    expect(portal.staged.get(stopped.ledgerId)).toEqual(["first-account"]);
    expect(fullYearZip.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(response).toHaveProperty("flowStep.state", "blocked");
    expect(response).toHaveProperty(
      "flowStep.safeSignals",
      expect.arrayContaining(["full-fiscal-year-gst-tab-session-unavailable"]),
    );
  });

  it("offers only the discard, never a retry that would refuse again", async () => {
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();

    stored.session = {};
    const response = await retrySingleReturnTarget(stopped);
    const summary = "flowSummary" in response ? response.flowSummary : undefined;
    if (!summary) throw new Error("expected the refusal to carry a flow summary");
    const offer = getRecoveryFlowAvailability(summary, true);

    expect(offer.availableActions).not.toContain("continue-saved-full-year-run");
    expect(offer.availableActions).toContain("cancel-saved-full-year-run");
    for (const action of offer.mentionedActions) {
      expect(offer.availableActions).toContain(action);
    }
  });
});

/**
 * A saved plan with no recorded tab pin -- for example one saved by an earlier build -- has nothing
 * to compare, so once it holds a portal outcome it refuses rather than binding to another tab. A
 * plan whose first period stopped before any tab was pinned has done no portal work, and runs.
 */
describe("a saved plan with no recorded tab pin", () => {
  it("refuses a single-return plan that already holds a portal outcome", async () => {
    const stopped = await saveSingleReturnPlanStoppedAtSecondPeriod();
    const key = deps.storageKeys.fullFiscalYearLedger;
    stored.local[key] = withoutPin(stored.local[key]);

    const response = await retrySingleReturnTarget(stopped);
    const summary = "flowSummary" in response ? response.flowSummary : undefined;

    expect(portal.staged.get(stopped.ledgerId)).toEqual(["first-account"]);
    expect(fullYearZip.exportFullFiscalYearZip).not.toHaveBeenCalled();
    expect(response).toHaveProperty(
      "flowStep.safeSignals",
      expect.arrayContaining(["full-fiscal-year-unbound-run-unverified"]),
    );
    expect(response).toHaveProperty("flowStep.safeMessage", expect.stringMatching(/GST account/i));
    if (!summary) throw new Error("expected the refusal to carry a flow summary");
    expect(getRecoveryFlowAvailability(summary, true).availableActions).not.toContain(
      "continue-saved-full-year-run",
    );
  });

  it("refuses an all-returns plan that already holds a portal outcome", async () => {
    const interrupted = await savePlanInterruptedDuringSecondTarget();
    const [key] = savedLedgerEntry();
    stored.local[key] = withoutPin(stored.local[key]);

    const response = await resumeAbandonedTarget(interrupted);

    expect(portal.staged.get(interrupted.ledgerId)).toEqual(["first-account"]);
    expect(zip.export).not.toHaveBeenCalled();
    const summary =
      "allSupportedFullFiscalYearFlowSummary" in response
        ? response.allSupportedFullFiscalYearFlowSummary
        : undefined;
    expect(summary).toMatchObject({ status: "blocked", resumeAvailable: false });
    expect(summary?.flowStep.safeSignals).toContain("full-fiscal-year-unbound-run-unverified");
  });

  it("still runs a single-return plan whose first period stopped before a tab was pinned", async () => {
    vi.mocked(deps.getActiveGstTab).mockResolvedValueOnce(null);
    await startFullFiscalYearDownloadFlow(SINGLE_RETURN_SCOPE, deps, portalRunner);
    const saved = stored.local[deps.storageKeys.fullFiscalYearLedger];
    if (!isFullFiscalYearLedger(saved)) throw new Error("expected a saved single-return plan");
    expect(saved.portalTabId).toBeUndefined();
    const first = saved.targets[0]!;
    expect(first.status).not.toBe("pending");

    await retrySingleReturnTarget({
      ledgerId: saved.ledgerId,
      targetId: first.targetId,
      revision: saved.revision ?? 1,
    });

    expect(portal.staged.get(saved.ledgerId)?.length).toBe(saved.targets.length);
    expect(fullYearZip.exportFullFiscalYearZip).toHaveBeenCalledOnce();
  });

  it("still runs an all-returns plan whose first target stopped before a tab was pinned", async () => {
    vi.mocked(deps.getActiveGstTab).mockResolvedValueOnce(null);
    await startAllSupportedFullFiscalYearDownloadFlow(request, deps, portalRunner);
    const saved = savedLedger();
    expect(saved.portalTabId).toBeUndefined();
    expect(saved.targets[0]?.status).toBe("blocked");

    const response = await retryAllSupportedFullFiscalYearTarget(
      {
        financialYear: request.financialYear,
        ledgerId: saved.ledgerId,
        targetId: saved.targets[0]!.targetId,
        expectedRevision: saved.revision,
      },
      deps,
      portalRunner,
    );

    expect(portal.staged.get(saved.ledgerId)?.length).toBe(saved.targets.length);
    expect(response).toMatchObject({
      allSupportedFullFiscalYearFlowSummary: { status: "complete" },
    });
  });
});

async function retrySingleReturnTarget(stopped: {
  ledgerId: string;
  targetId: string;
  revision: number;
}) {
  // The same two calls `retryFullFiscalYearTargetDownloadFlow` makes inside its run lease.
  const preparation = await prepareFullFiscalYearTargetRetry(
    { ledgerId: stopped.ledgerId, targetId: stopped.targetId, expectedRevision: stopped.revision },
    deps,
  );
  if (!preparation.ok) return preparation.response;
  return startFullFiscalYearDownloadFlow(preparation.ledger.scope, deps, portalRunner, {
    allowExistingLedgerResume: true,
  });
}

function resumeAbandonedTarget(interrupted: {
  ledgerId: string;
  abandonedTargetId: string;
  revision: number;
}) {
  // The worker stopped a while ago; a target is only offered for resume once its plan is stale.
  deps.now = () => RESUMED_AT;
  return retryAllSupportedFullFiscalYearTarget(
    {
      financialYear: request.financialYear,
      ledgerId: interrupted.ledgerId,
      targetId: interrupted.abandonedTargetId,
      expectedRevision: interrupted.revision,
    },
    deps,
    portalRunner,
  );
}

/**
 * Runs the plan for real until the worker stops part-way through its second target: the first
 * target is staged and terminal, the plan is pinned to the tab and browser session it ran in, and
 * the second target is left `running` with no live lease. That is the state the panel offers to
 * resume, through `retryAllSupportedFullFiscalYearTarget`.
 */
async function savePlanInterruptedDuringSecondTarget(): Promise<{
  ledgerId: string;
  abandonedTargetId: string;
  revision: number;
}> {
  let calls = 0;
  const stoppingRunner: SinglePeriodRunner = async (...args) => {
    calls += 1;
    if (calls === 2) throw new WorkerStopped();
    return portalRunner(...args);
  };
  await expect(
    startAllSupportedFullFiscalYearDownloadFlow(request, deps, stoppingRunner),
  ).rejects.toBeInstanceOf(WorkerStopped);
  const ledger = savedLedger();
  const abandoned = ledger.targets.find((target) => target.status === "running");
  if (!abandoned) throw new Error("expected an abandoned running target");
  expect(ledger.targets[0]?.status).toBe("downloaded");
  expect(ledger.portalTabId).toBe(TAB_ID);
  return {
    ledgerId: ledger.ledgerId,
    abandonedTargetId: abandoned.targetId,
    revision: ledger.revision,
  };
}

class WorkerStopped extends Error {}

function withoutPin(ledger: unknown): unknown {
  const copy = structuredClone(ledger) as Record<string, unknown>;
  delete copy.portalTabId;
  delete copy.portalTabSessionId;
  return copy;
}

function savedLedgerEntry(): [string, unknown] {
  const entries = Object.entries(stored.local).filter(([key]) =>
    key.startsWith("pack:filed-returns-all-supported-plan:"),
  );
  if (entries.length !== 1) throw new Error(`expected one saved plan, found ${entries.length}`);
  return entries[0]!;
}

function savedLedger() {
  const ledgers = Object.entries(stored.local)
    .filter(([key]) => key.startsWith("pack:filed-returns-all-supported-plan:"))
    .map(([, value]) => value)
    .filter(isAllSupportedFullFiscalYearLedger);
  if (ledgers.length !== 1) throw new Error(`expected one saved plan, found ${ledgers.length}`);
  return ledgers[0]!;
}

function step(state: PortalFlowStepResult["state"], safeSignals: string[]): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    state,
    safeSignals,
    safeMessage: "Synthetic step.",
  };
}

/** The step a real target-bound, staged download returns. Copied in shape from the ZIP suite. */
function stagedTargetStep(
  scope: FiledReturnsDownloadScope,
  bundleKind: "all-supported-full-fiscal-year" | "full-fiscal-year",
): PortalFlowStepResult {
  const artifactTypes = concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
  );
  const diagnostics: FiledReturnsDownloadDiagnostic[] = artifactTypes.map((artifactType) => ({
    actionId: `action-12345678-${artifactType.toLowerCase()}`,
    artifactType,
    byteCountClass: "non-empty" as const,
    downloadPathClass: "captured-portal-request-data" as const,
    endpointClass:
      scope.returnType === "GSTR-1"
        ? artifactType === "EXCEL"
          ? "gstr1-excel-portal-blob-captured-download"
          : "gstr1-pdf-portal-blob-captured-download"
        : scope.returnType === "GSTR-3B"
          ? artifactType === "JSON"
            ? "gstr3b-main-world-json-captured-download"
            : "gstr3b-portal-blob-captured-download"
          : artifactType === "JSON"
            ? "gstr2b-main-world-json-captured-download"
            : "gstr2b-portal-blob-captured-download",
    eventType: "filed-return-download-path" as const,
    financialYear: scope.financialYear,
    mimeClass:
      artifactType === "PDF"
        ? ("pdf" as const)
        : artifactType === "JSON"
          ? ("json" as const)
          : ("spreadsheet" as const),
    period: scope.period,
    returnType: scope.returnType,
    schemaVersion: "1.0" as const,
    status: "downloaded" as const,
  }));
  return {
    connectorId: "gst",
    downloadDiagnostic: diagnostics[diagnostics.length - 1]!,
    downloadDiagnostics: diagnostics,
    safeMessage: "Pack staged the target-bound artifact.",
    safeSignals: [
      ...artifactTypes.map((artifactType) => `filed-return-artifact-downloaded:${artifactType}`),
      `${bundleKind}-opfs-staged`,
      ...artifactTypes.map((artifactType) => `${bundleKind}-opfs-staged:${artifactType}`),
    ],
    scopeId: "gst-filed-returns-private-v0",
    state: "downloaded",
  };
}
