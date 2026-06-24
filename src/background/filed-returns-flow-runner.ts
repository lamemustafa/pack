import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import { pickSupportedGstPortalTab } from "../connectors/gst/hosts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessage, PackMessageResponse } from "../core/messages";
import {
  mergeFlowStepWithDownloadObservation,
  observeNextBrowserDownload,
} from "./download-observer";
import { unverifiedPeriodAfterDownloadStep } from "./filed-returns-flow-guards";
import { runDownloadStepWithRetry, runDownloadTriggerOnce } from "./filed-returns-flow-messaging";
import { persistFiledReturnsCompletionSummary } from "./filed-returns-flow-summary";

const GST_LOGIN_URL = "https://services.gst.gov.in/services/login";
const FLOW_STEP_SETTLE_MS = 1_600;
const RESULT_ROW_NAVIGATION_SETTLE_MS = 4_500;
const MAX_FLOW_STEPS = 6;
const MAX_FINANCIAL_YEAR_FLOW_STEPS = 80;
const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const EXPECTED_FILED_RETURN_DOWNLOAD = {
  expectedFileExtensions: [".pdf"],
  expectedMimeTypes: ["application/pdf"],
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

export type ActiveGstTab = Browser.tabs.Tab & { id: number };

export interface FiledReturnsFlowRunnerDeps {
  getActiveGstTab: () => Promise<ActiveGstTab | null>;
  sendMessageToTabWithInjection: (
    tabId: number,
    message: Extract<
      PackMessage,
      {
        type: "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP" | "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD";
      }
    >,
  ) => Promise<PackMessageResponse>;
  storageKeys: {
    completion: string;
    observation: string;
  };
}

export async function startFiledReturnsDownloadFlow(
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
  const completedPeriods = new Set(scope.completedPeriods ?? []);
  const maxAttempts = isEntireFinancialYearScope(scope)
    ? MAX_FINANCIAL_YEAR_FLOW_STEPS
    : MAX_FLOW_STEPS;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const downloadObservation = observeFiledReturnDownload();
    const stepScope = isEntireFinancialYearScope(scope)
      ? { ...scope, completedPeriods: [...completedPeriods] }
      : scope;
    const response = await runScopedDownloadStepWithRetry(deps, activeTab.tab.id, stepScope);
    if (!response.ok || !("flowStep" in response)) {
      downloadObservation.stop();
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;
    const completionSummary = await persistCompletionSummaryIfComplete(
      scope,
      completedPeriods,
      lastStep,
      deps,
    );
    if (completionSummary) return { ...response, flowSummary: completionSummary };

    if (lastStep.safeSignals.includes("filed-return-result-view-clicked")) {
      downloadObservation.stop();
      await delay(RESULT_ROW_NAVIGATION_SETTLE_MS);

      const detailDownloadObservation = observeFiledReturnDownload();
      const triggerResponse = await runDownloadTriggerOnce(deps, activeTab.tab.id);
      if (!triggerResponse.ok || !("downloadTrigger" in triggerResponse)) {
        detailDownloadObservation.stop();
        return triggerResponse;
      }

      const triggerStep: PortalFlowStepResult = {
        ...triggerResponse.downloadTrigger,
        safeSignals: [
          ...triggerResponse.downloadTrigger.safeSignals,
          ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
        ],
      };
      const triggerFlowResponse = {
        ...triggerResponse,
        flowStep: triggerStep,
      };
      await persistFlowResponse(triggerFlowResponse, deps);
      lastStep = triggerStep;
      const detailCompletionSummary = await persistCompletionSummaryIfComplete(
        scope,
        completedPeriods,
        lastStep,
        deps,
      );
      if (detailCompletionSummary) {
        return { ...triggerFlowResponse, flowSummary: detailCompletionSummary };
      }

      if (!lastStep.safeSignals.includes("filed-gstr3b-download-clicked")) {
        detailDownloadObservation.stop();
        return triggerFlowResponse;
      }

      const observedDownload = await detailDownloadObservation.promise;
      const mergedResponse = {
        ...triggerFlowResponse,
        flowStep: mergeFlowStepWithDownloadObservation(lastStep, observedDownload),
      };
      if (!isEntireFinancialYearScope(scope)) return mergedResponse;
      if (mergedResponse.flowStep.state !== "downloaded") return mergedResponse;
      if (!activePeriod) {
        return {
          ...mergedResponse,
          flowStep: unverifiedPeriodAfterDownloadStep(mergedResponse.flowStep),
        };
      }

      completedPeriods.add(activePeriod);
      activePeriod = null;
      await delay(FLOW_STEP_SETTLE_MS);
      lastStep = mergedResponse.flowStep;
      continue;
    }

    if (lastStep.safeSignals.includes("filed-gstr3b-download-clicked")) {
      const observedDownload = await downloadObservation.promise;
      const mergedResponse = {
        ...response,
        flowStep: mergeFlowStepWithDownloadObservation(lastStep, observedDownload),
      };
      if (!isEntireFinancialYearScope(scope)) return mergedResponse;
      if (mergedResponse.flowStep.state !== "downloaded") return mergedResponse;
      if (!activePeriod) {
        return {
          ...mergedResponse,
          flowStep: unverifiedPeriodAfterDownloadStep(mergedResponse.flowStep),
        };
      }

      completedPeriods.add(activePeriod);
      activePeriod = null;
      await delay(FLOW_STEP_SETTLE_MS);
      lastStep = mergedResponse.flowStep;
      continue;
    }

    downloadObservation.stop();
    if (!shouldContinueFlow(lastStep)) return response;
    await delay(getFlowStepSettleMs(lastStep));
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

function observeFiledReturnDownload() {
  return observeNextBrowserDownload(browser.downloads, {
    ...EXPECTED_FILED_RETURN_DOWNLOAD,
    armedAt: new Date(),
  });
}

async function persistCompletionSummaryIfComplete(
  scope: FiledReturnsDownloadScope,
  completedPeriods: ReadonlySet<string>,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<FiledReturnsFlowSummary | null> {
  if (!isEntireFinancialYearScope(scope)) return null;
  if (!flowStep.safeSignals.includes("filed-return-financial-year-complete")) return null;
  return persistFiledReturnsCompletionSummary(
    deps.storageKeys.completion,
    scope,
    completedPeriods,
    flowStep,
  );
}

function runScopedDownloadStepWithRetry(
  deps: FiledReturnsFlowRunnerDeps,
  tabId: number,
  scope: FiledReturnsDownloadScope,
): Promise<PackMessageResponse> {
  return runDownloadStepWithRetry(deps, tabId, {
    type: "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP",
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

  const existingTab = pickSupportedGstPortalTab<Browser.tabs.Tab>(await browser.tabs.query({}));
  if (existingTab) {
    await focusTab(existingTab);
    return { tab: existingTab, openedForLogin: false };
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
  return step.state === "clicked" && !step.safeSignals.includes("filed-gstr3b-download-clicked");
}

function getFlowStepSettleMs(step: PortalFlowStepResult): number {
  return step.safeSignals.includes("filed-return-result-view-clicked")
    ? RESULT_ROW_NAVIGATION_SETTLE_MS
    : FLOW_STEP_SETTLE_MS;
}

function extractActivePeriod(step: PortalFlowStepResult): string | null {
  const prefixes = ["filed-return-result-period:", "filed-return-detail-period:"];
  for (const prefix of prefixes) {
    const signal = step.safeSignals.find((candidate) => candidate.startsWith(prefix));
    if (signal) return signal.slice(prefix.length);
  }
  return null;
}

function isEntireFinancialYearScope(scope: FiledReturnsDownloadScope): boolean {
  return scope.period === "ALL";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
