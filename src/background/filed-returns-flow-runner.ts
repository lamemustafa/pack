import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../core/contracts";
import type {
  FullFiscalYearTargetRecoveryPayload,
  PackMessage,
  PackMessageResponse,
} from "../core/messages";
import { isFullFiscalYearScope } from "../core/filed-returns-scope";
import {
  acquireFiledReturnsRun,
  releaseFiledReturnsRun,
  startFiledReturnsRunLeaseRenewal,
} from "./filed-returns-active-run";
import { triggerAndObserveFiledReturnDownload } from "./filed-returns-download-trigger";
import { startFullFiscalYearDownloadFlow } from "./filed-returns-full-fiscal-year";
import { runDownloadStepWithRetry } from "./filed-returns-flow-messaging";
import {
  prepareFullFiscalYearTargetRetry,
  readFullFiscalYearTargetRecoveryScope,
} from "./filed-returns-full-fiscal-year-recovery";
import {
  readFiledReturnsTargetReview,
  responseForFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";

const GST_SERVICES_ORIGIN = GST_CONNECTOR_DESCRIPTOR.supportedOrigins[1] ?? "";
const GST_LOGIN_URL = new URL("/services/login", GST_SERVICES_ORIGIN).href;
const FLOW_STEP_SETTLE_MS = 1_600;
const RESULT_ROW_NAVIGATION_SETTLE_MS = 4_500;
const MAX_FLOW_STEPS = 6;
const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";

export type ActiveGstTab = Browser.tabs.Tab & { id: number };

export interface FiledReturnsFlowRunnerDeps {
  getActiveGstTab: () => Promise<ActiveGstTab | null>;
  sendMessageToTabWithInjection: (
    tabId: number,
    message: Extract<
      PackMessage,
      {
        type:
          | "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2"
          | "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V2"
          | "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V2";
      }
    >,
  ) => Promise<PackMessageResponse>;
  storageKeys: {
    activeRun?: string;
    completion: string;
    fullFiscalYearLedger: string;
    observation: string;
    targetReview?: string;
  };
  now?: () => Date;
  persistTargetReview?: boolean;
  timings?: {
    contentMessageTimeoutMs?: number;
    flowStepSettleMs?: number;
    resultRowNavigationSettleMs?: number;
  };
}

export async function startFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  if (!isFullFiscalYearScope(scope)) {
    const targetReview = await readFiledReturnsTargetReview(scope, deps);
    if (targetReview) return responseForFiledReturnsTargetReview(targetReview);
  }

  const activeRun = await acquireFiledReturnsRun(scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    if (isFullFiscalYearScope(scope)) {
      return startFullFiscalYearDownloadFlow(
        scope,
        deps,
        startSinglePeriodFiledReturnsDownloadFlow,
      );
    }
    return startSinglePeriodFiledReturnsDownloadFlow(scope, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

export async function retryFullFiscalYearTargetDownloadFlow(
  payload: FullFiscalYearTargetRecoveryPayload,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const recoveryScope = await readFullFiscalYearTargetRecoveryScope(payload, deps);
  if ("response" in recoveryScope) return recoveryScope.response;

  const activeRun = await acquireFiledReturnsRun(recoveryScope.scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    const recovery = await prepareFullFiscalYearTargetRetry(payload, deps);
    if (!recovery.ok) return recovery.response;
    return startFullFiscalYearDownloadFlow(
      recovery.ledger.scope,
      deps,
      startSinglePeriodFiledReturnsDownloadFlow,
      { allowExistingLedgerResume: true },
    );
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

async function startSinglePeriodFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const activeTab = await getOrOpenGstTab(deps.getActiveGstTab);
  if (activeTab.openedForLogin) {
    return {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "login-required",
        safeSignals: ["gst-login-tab-opened"],
        safeMessage: "Pack opened the GST Portal login page. Sign in, then click Start download.",
        userAction: {
          type: "LOGIN",
          message: "Sign in to the GST Portal. Pack will resume after you click Start download.",
          canResume: true,
        },
      },
    };
  }

  let lastStep: PortalFlowStepResult | null = null;
  let activePeriod: string | null = null;
  for (let attempt = 0; attempt < MAX_FLOW_STEPS; attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, activeTab.tab.id, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;

    if (lastStep.safeSignals.includes("filed-return-api-result-posted")) {
      await delay(getResultRowNavigationSettleMs(deps));

      return waitForDetailReadyThenTrigger({
        activePeriod,
        deps,
        scope,
        tabId: activeTab.tab.id,
      });
    }

    if (lastStep.safeSignals.includes("filed-return-result-view-clicked")) {
      await delay(getResultRowNavigationSettleMs(deps));

      return triggerAndObserveFiledReturnDownload({
        activePeriod,
        deps,
        scope,
        tabId: activeTab.tab.id,
      });
    }

    if (lastStep.safeSignals.includes("filed-gstr3b-download-ready")) {
      return triggerAndObserveFiledReturnDownload({
        activePeriod,
        deps,
        scope,
        tabId: activeTab.tab.id,
      });
    }

    if (!shouldContinueFlow(lastStep)) return response;
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return {
    ok: true,
    flowStep: lastStep ?? {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: ["flow-step-limit-reached"],
      safeMessage:
        "Pack started the filed-return flow but did not reach the download step yet. Wait for the GST portal to finish loading, then click Start download again.",
    },
  };
}

async function waitForDetailReadyThenTrigger({
  activePeriod,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  let lastStep: PortalFlowStepResult | null = null;

  for (let attempt = 0; attempt < MAX_FLOW_STEPS; attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;

    if (lastStep.safeSignals.includes("filed-gstr3b-download-ready")) {
      return triggerAndObserveFiledReturnDownload({
        activePeriod,
        deps,
        scope,
        tabId,
      });
    }

    if (!shouldContinueFlow(lastStep)) return response;
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return {
    ok: true,
    flowStep: lastStep ?? {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: ["detail-ready-step-limit-reached"],
      safeMessage:
        "Pack opened the filed GSTR-3B detail page but did not see the final download control yet. Wait for the GST portal to finish loading, then click Start download again.",
    },
  };
}

function runScopedDownloadStepWithRetry(
  deps: FiledReturnsFlowRunnerDeps,
  tabId: number,
  scope: FiledReturnsDownloadScope,
): Promise<PackMessageResponse> {
  return runDownloadStepWithRetry(deps, tabId, {
    type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V2",
    payload: scope,
  });
}

async function getOrOpenGstTab(
  getActiveGstTab: () => Promise<ActiveGstTab | null>,
): Promise<{ tab: ActiveGstTab; openedForLogin: false } | { openedForLogin: true }> {
  const activeTab = await getActiveGstTab();
  if (activeTab) {
    await focusTab(activeTab);
    return { tab: activeTab, openedForLogin: false };
  }

  await browser.tabs.create({ active: true, url: GST_LOGIN_URL });
  return { openedForLogin: true };
}

async function focusTab(tab: ActiveGstTab): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await browser.windows.update(tab.windowId, { focused: true });
  }
}

async function persistFlowResponse(
  response: Extract<PackMessageResponse, { ok: true }>,
  deps: FiledReturnsFlowRunnerDeps,
) {
  if ("observation" in response && response.observation) {
    await browser.storage.session.set({
      [deps.storageKeys.observation]: response.observation,
    });
  }
}

function shouldContinueFlow(step: PortalFlowStepResult): boolean {
  if (step.safeSignals.includes("filed-gstr3b-download-clicked")) return false;
  return step.state === "clicked" || step.safeSignals.includes("detail-summary-modal");
}

function isFiledReturnDetailNavigationStep(step: PortalFlowStepResult): boolean {
  return (
    step.safeSignals.includes("filed-return-result-view-clicked") ||
    step.safeSignals.includes("filed-return-api-result-posted")
  );
}

function getResultRowNavigationSettleMs(deps: FiledReturnsFlowRunnerDeps): number {
  return deps.timings?.resultRowNavigationSettleMs ?? RESULT_ROW_NAVIGATION_SETTLE_MS;
}

function getFlowStepSettleMs(step: PortalFlowStepResult, deps: FiledReturnsFlowRunnerDeps): number {
  if (isFiledReturnDetailNavigationStep(step)) {
    return deps.timings?.resultRowNavigationSettleMs ?? RESULT_ROW_NAVIGATION_SETTLE_MS;
  }
  return deps.timings?.flowStepSettleMs ?? FLOW_STEP_SETTLE_MS;
}

function extractActivePeriod(step: PortalFlowStepResult): string | null {
  const prefixes = ["filed-return-result-period:", "filed-return-detail-period:"];
  for (const prefix of prefixes) {
    const signal = step.safeSignals.find((candidate) => candidate.startsWith(prefix));
    if (signal) return signal.slice(prefix.length);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
