import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import { getRequiredGstTab } from "./filed-returns-active-tab";
import { runDownloadStepWithRetry } from "./filed-returns-flow-messaging";
import {
  delay,
  extractActivePeriod,
  getFlowStepSettleMs,
  getResultRowNavigationSettleMs,
  isFiledReturnDownloadReady,
  maxFlowStepsFor,
  persistFlowResponse,
  shouldAttemptDirectDownloadFromDetailRoute,
  shouldContinueFlow,
} from "./filed-returns-flow-runner-utils";
import { triggerSelectedArtifacts } from "./filed-returns-selected-artifacts";
import {
  detailStepLimitReachedMessage,
  searchStepLimitReachedMessage,
  toStepLimitReachedFlowStep,
} from "./filed-returns-step-limit";
import { withPersistedSinglePeriodSummary } from "./filed-returns-single-period-summary";

export async function startSinglePeriodFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  options: { persistSinglePeriodSummary?: boolean } = {},
): Promise<PackMessageResponse> {
  const shouldPersistSinglePeriodSummary = options.persistSinglePeriodSummary !== false;
  const activeTab = await getRequiredGstTab(deps.getActiveGstTab);
  if (!activeTab) {
    return withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnScopeId(scope.returnType),
          state: "login-required",
          safeSignals: ["gst-portal-tab-required"],
          safeMessage:
            "Open a signed-in GST Portal return dashboard or return page, then click Start download again.",
          userAction: {
            type: "LOGIN",
            message:
              "Sign in to the GST Portal and keep the return dashboard or selected return page open.",
            canResume: true,
          },
        },
      },
      deps,
      shouldPersistSinglePeriodSummary,
    );
  }

  return runSinglePeriodSteps(scope, deps, activeTab.tab.id, shouldPersistSinglePeriodSummary);
}

async function runSinglePeriodSteps(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  tabId: number,
  shouldPersistSinglePeriodSummary: boolean,
): Promise<PackMessageResponse> {
  let lastStep: PortalFlowStepResult | null = null;
  let activePeriod: string | null = null;
  for (let attempt = 0; attempt < maxFlowStepsFor(scope); attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;

    if (lastStep.safeSignals.includes("filed-return-api-result-posted")) {
      return waitForDetailReadyThenTrigger({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (
      lastStep.safeSignals.includes("filed-return-result-view-clicked") ||
      lastStep.safeSignals.includes("gstr2b-dashboard-view-clicked")
    ) {
      if (shouldWaitForDetailReadyAfterResultNavigation(scope)) {
        return waitForDetailReadyThenTrigger({
          activePeriod,
          deps,
          shouldPersistSinglePeriodSummary,
          scope,
          tabId,
        });
      }

      await delay(getResultRowNavigationSettleMs(deps));

      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (!shouldContinueFlow(lastStep)) {
      return withPersistedSinglePeriodSummary(
        scope,
        response,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return withPersistedSinglePeriodSummary(
    scope,
    {
      ok: true,
      flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
        safeSignal: "flow-step-limit-reached",
        safeMessage: searchStepLimitReachedMessage(scope),
        userActionMessage:
          "Wait for the GST Portal result page to finish loading, then click Start download again.",
      }),
    },
    deps,
    shouldPersistSinglePeriodSummary,
  );
}

async function waitForDetailReadyThenTrigger({
  activePeriod,
  deps,
  shouldPersistSinglePeriodSummary,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  shouldPersistSinglePeriodSummary: boolean;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  let lastStep: PortalFlowStepResult | null = null;

  for (let attempt = 0; attempt < maxFlowStepsFor(scope); attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (shouldAttemptDirectDownloadFromDetailRoute(lastStep, scope, deps)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (!shouldContinueFlow(lastStep)) {
      return withPersistedSinglePeriodSummary(
        scope,
        response,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return withPersistedSinglePeriodSummary(
    scope,
    {
      ok: true,
      flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
        safeSignal: "detail-ready-step-limit-reached",
        safeMessage: detailStepLimitReachedMessage(scope),
        userActionMessage:
          "Wait for the filed-return detail page to finish loading, then click Start download again.",
      }),
    },
    deps,
    shouldPersistSinglePeriodSummary,
  );
}

function runScopedDownloadStepWithRetry(
  deps: FiledReturnsFlowRunnerDeps,
  tabId: number,
  scope: FiledReturnsDownloadScope,
): Promise<PackMessageResponse> {
  return runDownloadStepWithRetry(deps, tabId, {
    type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
    payload: scope,
  });
}

async function triggerSinglePeriodDownloadAndPersistSummary({
  activePeriod,
  deps,
  shouldPersistSinglePeriodSummary,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  shouldPersistSinglePeriodSummary: boolean;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  const response = await triggerSelectedArtifacts({
    activePeriod,
    deps,
    scope,
    tabId,
  });
  if (shouldPersistSinglePeriodSummary && response.ok && "flowStep" in response) {
    return withPersistedSinglePeriodSummary(
      scope,
      response,
      deps,
      shouldPersistSinglePeriodSummary,
    );
  }
  return response;
}

function shouldWaitForDetailReadyAfterResultNavigation(scope: FiledReturnsDownloadScope): boolean {
  return (
    scope.returnType === "GSTR-1" ||
    scope.returnType === "GSTR-2B" ||
    scope.artifactType === "PDF_AND_EXCEL" ||
    scope.artifactType === "EXCEL"
  );
}
