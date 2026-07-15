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

const MAIN_WORLD_FILTER_SEARCH_SETTLE_MS = 1_000;

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
  let mainWorldFilterAttempted = false;
  for (let attempt = 0; attempt < maxFlowStepsFor(scope); attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;

    if (
      lastStep.safeSignals.includes("filed-gstr1-result-view-user-action-required") &&
      deps.clickGstr1ResultViewWithDebugger
    ) {
      const debuggerStep = await deps.clickGstr1ResultViewWithDebugger(tabId, scope);
      const debuggerResponse = { ok: true as const, flowStep: debuggerStep };
      await persistFlowResponse(debuggerResponse, deps);
      lastStep = debuggerStep;
      if (!shouldContinueFlow(debuggerStep)) {
        return withPersistedSinglePeriodSummary(
          scope,
          debuggerResponse,
          deps,
          shouldPersistSinglePeriodSummary,
        );
      }
      await delay(getFlowStepSettleMs(debuggerStep, deps));
      continue;
    }

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

    if (
      !mainWorldFilterAttempted &&
      lastStep.state === "candidate-not-found" &&
      lastStep.safeSignals.includes("filed-return-filter-candidate-not-found") &&
      deps.selectFiltersInMainWorld
    ) {
      mainWorldFilterAttempted = true;
      try {
        await deps.sendMessageToTabWithInjection(tabId, {
          type: "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3",
          payload: scope,
        });
      } catch {
        // Without the isolated-world marker, later filter-bound row matching stays disabled.
      }
      let mainWorldSelection: Awaited<
        ReturnType<NonNullable<FiledReturnsFlowRunnerDeps["selectFiltersInMainWorld"]>>
      >;
      try {
        mainWorldSelection = await deps.selectFiltersInMainWorld(tabId, scope);
      } catch (error) {
        await clearUnsubmittedMainWorldSearch(deps, tabId, scope);
        throw error;
      }
      if (mainWorldSelection.state === "searched") {
        await delay(MAIN_WORLD_FILTER_SEARCH_SETTLE_MS);
        continue;
      }
      await clearUnsubmittedMainWorldSearch(deps, tabId, scope);
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

async function clearUnsubmittedMainWorldSearch(
  deps: FiledReturnsFlowRunnerDeps,
  tabId: number,
  scope: FiledReturnsDownloadScope,
): Promise<void> {
  try {
    await deps.sendMessageToTabWithInjection(tabId, {
      type: "PACK_CONTENT_CLEAR_FILED_RETURNS_SEARCH_PENDING_V3",
      payload: scope,
    });
  } catch {
    // A failed best-effort clear cannot make an unsubmitted search target-bound.
  }
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
