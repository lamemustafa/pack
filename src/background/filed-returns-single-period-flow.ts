import type {
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { delay } from "../core/time";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { concreteFiledReturnsArtifactTypesForSelection } from "../connectors/gst/filed-returns-artifacts";
import { canonicalDurableSummaryMessage } from "../connectors/gst/filed-returns-durable-status";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  focusRequiredGstTab,
  getFullFiscalYearTabSessionId,
  getRequiredGstTab,
} from "./filed-returns-active-tab";
import {
  clickReturnsDashboardAnchorFromTab,
  verifyCurrentContentScriptFromTab,
} from "./gst-tab-context";
import { runDownloadStepWithRetry } from "./filed-returns-flow-messaging";
import {
  extractActiveFinancialYear,
  extractActivePeriod,
  flowStepDeadlineMs,
  getFlowStepSettleMs,
  getResultRowNavigationSettleMs,
  isFiledReturnDownloadReady,
  persistFlowResponse,
  shouldContinueFlow,
} from "./filed-returns-flow-runner-utils";
import {
  preflightSelectedArtifactsRecovery,
  triggerSelectedArtifacts,
} from "./filed-returns-selected-artifacts";
import {
  detailStepLimitReachedMessage,
  searchStepLimitReachedMessage,
  toStepLimitReachedFlowStep,
} from "./filed-returns-step-limit";
import { withPersistedSinglePeriodSummary } from "./filed-returns-single-period-summary";
import { reconcileArtifactAcquisitionCheckpoint } from "./artifact-acquisition-state";
import {
  explainIncompleteGstr1PeriodMismatchRecovery,
  pendingGstr1PeriodMismatchRecoveryStep,
  stopNonConvergingReturnTypeMismatchRecovery,
  stopNonConvergingGstr1PeriodMismatchRecovery,
  updateReturnTypeMismatchRecovery,
  updateGstr1PeriodMismatchRecovery,
  type Gstr1PeriodMismatchRecovery,
  type ReturnTypeMismatchRecovery,
} from "./filed-returns-gstr1-period-mismatch-recovery";

// The deadline is the product bound. This only stops a broken zero-delay response loop.
const ZERO_DELAY_RUNAWAY_STEP_LIMIT = 10_000;

const MAIN_WORLD_FILTER_SEARCH_SETTLE_MS = 1_000;

export async function startSinglePeriodFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  options: {
    onPortalTabSelected?: (tabId: number, tabSessionId: string) => Promise<void>;
    persistSinglePeriodSummary?: boolean;
    requiredPortalTabId?: number;
    requiredPortalTabSessionId?: string;
  } = {},
): Promise<PackMessageResponse> {
  const shouldPersistSinglePeriodSummary = options.persistSinglePeriodSummary !== false;
  // Every direct-artifact return type checkpoints its acquisition, so every one
  // of them must reconcile that checkpoint before starting again. Limiting this
  // to GSTR-3B let a GSTR-1 or GSTR-2B start overwrite a live checkpoint with a
  // fresh intent and repeat a download that may already have succeeded.
  // Checkpoints are keyed per concrete artifact type, so a composite selection
  // has to reconcile each one rather than the composite scope.
  const concreteArtifactTypes = concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
  );
  for (const artifactType of concreteArtifactTypes) {
    const concreteScope = {
      artifactType,
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
    } as const;
    const acquisitionRecovery = await reconcileArtifactAcquisitionCheckpoint(concreteScope);
    if (acquisitionRecovery.state === "needs-review") {
      // A composite selection has independent browser actions. Surface the
      // first retained concrete artifact, rather than assigning PDF/Excel/JSON
      // evidence to the selected-file ZIP scope.
      const flowStep: PortalFlowStepResult = {
        connectorId: "gst",
        scopeId: filedReturnScopeId(scope.returnType),
        state: "blocked",
        safeSignals: Array.from(
          new Set([
            "artifact-acquisition-download-unreconciled",
            ...acquisitionRecovery.safeSignals,
          ]),
        ),
        safeMessage:
          "Pack retained unresolved artifact download recovery and will not repeat the target automatically.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Review or cancel this target before starting another portal action.",
          canResume: true,
        },
      };
      const flowSummary = await persistFiledReturnsTargetReview(concreteScope, flowStep, deps);
      return flowSummary
        ? { ok: true, flowStep: flowSummary.flowStep, flowSummary }
        : { ok: true, flowStep };
    }
  }
  const recoveryResponse = await preflightSelectedArtifactsRecovery({ deps, scope });
  if (recoveryResponse) {
    return recoveryResponse.ok && "flowStep" in recoveryResponse
      ? withPersistedSinglePeriodSummary(
          scope,
          recoveryResponse,
          deps,
          shouldPersistSinglePeriodSummary,
        )
      : recoveryResponse;
  }
  const requiredTab = await getRequiredGstTab(
    deps.getActiveGstTab,
    options.requiredPortalTabId,
    options.requiredPortalTabSessionId,
    options.onPortalTabSelected === undefined,
  );
  if (requiredTab.state !== "ready") {
    if (requiredTab.state === "tab-focus-unavailable") {
      return tabFocusUnavailableResponse(scope, deps, shouldPersistSinglePeriodSummary);
    }
    if (requiredTab.state === "tab-session-unavailable") {
      return tabSessionUnavailableResponse(scope, deps, shouldPersistSinglePeriodSummary);
    }
    if (
      options.requiredPortalTabId !== undefined ||
      options.requiredPortalTabSessionId !== undefined
    ) {
      return withPersistedSinglePeriodSummary(
        scope,
        {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnScopeId(scope.returnType),
            state: "blocked",
            safeSignals: ["full-fiscal-year-pinned-gst-tab-unavailable"],
            safeMessage: canonicalDurableSummaryMessage(scope, "blocked", [
              "full-fiscal-year-pinned-gst-tab-unavailable",
            ]),
            userAction: {
              type: "RETRY_PORTAL_GENERATION",
              message: "Discard this saved plan before using a different GST Portal tab.",
              canResume: false,
            },
          },
        },
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
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
  const activeTab = requiredTab;
  if (options.onPortalTabSelected) {
    const tabSessionId = await getFullFiscalYearTabSessionId();
    if (!tabSessionId) {
      return tabSessionUnavailableResponse(scope, deps, shouldPersistSinglePeriodSummary);
    }
    await options.onPortalTabSelected(activeTab.tab.id, tabSessionId);
    try {
      await focusRequiredGstTab(activeTab.tab);
    } catch {
      return tabFocusUnavailableResponse(scope, deps, shouldPersistSinglePeriodSummary);
    }
  }

  if (scope.returnType === "GSTR-3B" && !isReturnsOrigin(activeTab.tab.url)) {
    const portalNavigation = await (
      deps.openReturnsDashboardWithPortalAnchor ?? clickReturnsDashboardAnchorFromTab
    )(activeTab.tab.id);
    if (!portalNavigation) {
      return blockedWrongOriginResponse(
        scope,
        deps,
        shouldPersistSinglePeriodSummary,
        "unavailable",
      );
    }
    if (portalNavigation !== "clicked") {
      return blockedWrongOriginResponse(
        scope,
        deps,
        shouldPersistSinglePeriodSummary,
        portalNavigation,
      );
    }
    if (!(await waitForReturnsOrigin(activeTab.tab.id, deps))) {
      return blockedWrongOriginResponse(scope, deps, shouldPersistSinglePeriodSummary, "timeout");
    }
    const contentScriptReady = await (
      deps.verifyReturnsOriginContentScript ?? verifyCurrentContentScriptFromTab
    )(activeTab.tab.id);
    if (!contentScriptReady) {
      return blockedWrongOriginResponse(
        scope,
        deps,
        shouldPersistSinglePeriodSummary,
        "unavailable",
      );
    }
  }

  return runSinglePeriodSteps(
    scope,
    { ...deps, portalTabIncognito: activeTab.tab.incognito === true },
    activeTab.tab.id,
    shouldPersistSinglePeriodSummary,
  );
}

function tabSessionUnavailableResponse(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  shouldPersistSinglePeriodSummary: boolean,
): Promise<PackMessageResponse> {
  return withPersistedSinglePeriodSummary(
    scope,
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId(scope.returnType),
        state: "blocked",
        safeSignals: ["full-fiscal-year-gst-tab-session-unavailable"],
        safeMessage: canonicalDurableSummaryMessage(scope, "blocked", [
          "full-fiscal-year-gst-tab-session-unavailable",
        ]),
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Try again with the GST Portal tab open in the foreground.",
          canResume: true,
        },
      },
    },
    deps,
    shouldPersistSinglePeriodSummary,
  );
}

function tabFocusUnavailableResponse(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  shouldPersistSinglePeriodSummary: boolean,
): Promise<PackMessageResponse> {
  return withPersistedSinglePeriodSummary(
    scope,
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId(scope.returnType),
        state: "blocked",
        safeSignals: ["filed-returns-gst-tab-focus-unavailable"],
        safeMessage: canonicalDurableSummaryMessage(scope, "blocked", [
          "filed-returns-gst-tab-focus-unavailable",
        ]),
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Try again with the GST Portal tab open in the foreground.",
          canResume: true,
        },
      },
    },
    deps,
    shouldPersistSinglePeriodSummary,
  );
}

async function blockedWrongOriginResponse(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  shouldPersistSinglePeriodSummary: boolean,
  reason: "ambiguous" | "not-found" | "timeout" | "unavailable",
): Promise<PackMessageResponse> {
  return withPersistedSinglePeriodSummary(
    scope,
    {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId("GSTR-3B"),
        state: "blocked",
        safeSignals: ["wrong-origin-open-returns-dashboard", `returns-dashboard-anchor-${reason}`],
        safeMessage:
          reason === "ambiguous"
            ? "Pack found more than one matching Returns Dashboard link and will not choose one."
            : reason === "timeout"
              ? "Pack clicked the GST Portal Returns Dashboard link but the portal did not finish opening it in time."
              : "Pack needs the GST Portal Returns Dashboard before it can acquire filed GSTR-3B.",
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message:
            "Open Services > Returns > Returns Dashboard in the GST Portal, then press Start again.",
          canResume: true,
        },
      },
    },
    deps,
    shouldPersistSinglePeriodSummary,
  );
}

async function waitForReturnsOrigin(
  tabId: number,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<boolean> {
  const timeoutMs = deps.timings?.returnsDashboardNavigationTimeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activeTab = await getRequiredGstTab(deps.getActiveGstTab);
    if (
      activeTab.state === "ready" &&
      activeTab.tab.id === tabId &&
      isReturnsOrigin(activeTab.tab.url)
    ) {
      return true;
    }
    await delay(250);
  }
  return false;
}

function isReturnsOrigin(url: string | undefined): boolean {
  try {
    return new URL(url ?? "").origin === "https://return.gst.gov.in";
  } catch {
    return false;
  }
}

async function runSinglePeriodSteps(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  tabId: number,
  shouldPersistSinglePeriodSummary: boolean,
): Promise<PackMessageResponse> {
  let lastStep: PortalFlowStepResult | null = null;
  let activePeriod: string | null = null;
  let activeFinancialYear: string | null = null;
  let mainWorldFilterAttempted = false;
  let mismatchRecovery: Gstr1PeriodMismatchRecovery | null = null;
  let returnTypeMismatchRecovery: ReturnTypeMismatchRecovery | null = null;
  // Wall clock is the real bound; the step count is only a runaway backstop.
  // Pack observed `filed-returns-page-settling` -- its own word for a page still
  // rendering -- and stopped anyway, because twelve steps at a 150ms settle is
  // under two seconds of patience.
  const stepStartedAt = (deps.now?.() ?? new Date()).getTime();
  const stepDeadlineAt = stepStartedAt + flowStepDeadlineMs(deps);
  for (
    let attempt = 0;
    attempt < ZERO_DELAY_RUNAWAY_STEP_LIMIT &&
    (deps.now?.() ?? new Date()).getTime() < stepDeadlineAt;
    attempt += 1
  ) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;
    activeFinancialYear = extractActiveFinancialYear(lastStep) ?? activeFinancialYear;
    mismatchRecovery = updateGstr1PeriodMismatchRecovery(mismatchRecovery, scope, lastStep);
    const mismatchRecoveryStop = stopNonConvergingGstr1PeriodMismatchRecovery(
      scope,
      response,
      mismatchRecovery,
    );
    if (mismatchRecoveryStop) {
      return withPersistedSinglePeriodSummary(
        scope,
        mismatchRecoveryStop,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    returnTypeMismatchRecovery = updateReturnTypeMismatchRecovery(
      returnTypeMismatchRecovery,
      scope,
      lastStep,
    );
    const returnTypeMismatchRecoveryStop = stopNonConvergingReturnTypeMismatchRecovery(
      scope,
      response,
      returnTypeMismatchRecovery,
    );
    if (returnTypeMismatchRecoveryStop) {
      return withPersistedSinglePeriodSummary(
        scope,
        returnTypeMismatchRecoveryStop,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }

    if (lastStep.safeSignals.includes("filed-return-api-result-posted")) {
      return waitForDetailReadyThenTrigger({
        activePeriod,
        activeFinancialYear,
        deps,
        mismatchRecovery,
        returnTypeMismatchRecovery,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (
      lastStep.safeSignals.includes("filed-return-result-view-clicked") ||
      lastStep.safeSignals.includes("gstr1-dashboard-view-clicked") ||
      lastStep.safeSignals.includes("gstr2b-dashboard-view-clicked")
    ) {
      if (shouldWaitForDetailReadyAfterResultNavigation(scope, deps)) {
        return waitForDetailReadyThenTrigger({
          activePeriod,
          activeFinancialYear,
          deps,
          mismatchRecovery,
          returnTypeMismatchRecovery,
          shouldPersistSinglePeriodSummary,
          scope,
          tabId,
        });
      }

      await delay(getResultRowNavigationSettleMs(deps));

      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        activeFinancialYear,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        activeFinancialYear,
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

    const mismatchRecoveryPending = pendingGstr1PeriodMismatchRecoveryStep(
      scope,
      lastStep,
      mismatchRecovery,
    );
    if (mismatchRecoveryPending) {
      lastStep = mismatchRecoveryPending;
      await delay(getFlowStepSettleMs(lastStep, deps));
      continue;
    }

    if (!shouldContinueFlow(lastStep)) {
      return withPersistedSinglePeriodSummary(
        scope,
        explainIncompleteGstr1PeriodMismatchRecovery(scope, response, mismatchRecovery),
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  const stepLimitResponse: Extract<
    PackMessageResponse,
    { ok: true; flowStep: PortalFlowStepResult }
  > = {
    ok: true,
    flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
      safeSignal: "flow-step-limit-reached",
      safeMessage: searchStepLimitReachedMessage(
        scope,
        (deps.now?.() ?? new Date()).getTime() - stepStartedAt,
      ),
      userActionMessage:
        "Wait for the GST Portal result page to finish loading, then click Start download again.",
    }),
  };
  return withPersistedSinglePeriodSummary(
    scope,
    explainIncompleteGstr1PeriodMismatchRecovery(scope, stepLimitResponse, mismatchRecovery),
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
  activeFinancialYear,
  deps,
  mismatchRecovery: initialMismatchRecovery,
  returnTypeMismatchRecovery: initialReturnTypeMismatchRecovery,
  shouldPersistSinglePeriodSummary,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  activeFinancialYear: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  mismatchRecovery: Gstr1PeriodMismatchRecovery | null;
  returnTypeMismatchRecovery: ReturnTypeMismatchRecovery | null;
  shouldPersistSinglePeriodSummary: boolean;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  let lastStep: PortalFlowStepResult | null = null;
  let mismatchRecovery = initialMismatchRecovery;
  let returnTypeMismatchRecovery = initialReturnTypeMismatchRecovery;

  // Wall clock is the real bound; the step count is only a runaway backstop.
  // Pack observed `filed-returns-page-settling` -- its own word for a page still
  // rendering -- and stopped anyway, because twelve steps at a 150ms settle is
  // under two seconds of patience.
  const stepStartedAt = (deps.now?.() ?? new Date()).getTime();
  const stepDeadlineAt = stepStartedAt + flowStepDeadlineMs(deps);
  for (
    let attempt = 0;
    attempt < ZERO_DELAY_RUNAWAY_STEP_LIMIT &&
    (deps.now?.() ?? new Date()).getTime() < stepDeadlineAt;
    attempt += 1
  ) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;
    activeFinancialYear = extractActiveFinancialYear(lastStep) ?? activeFinancialYear;
    mismatchRecovery = updateGstr1PeriodMismatchRecovery(mismatchRecovery, scope, lastStep);
    const mismatchRecoveryStop = stopNonConvergingGstr1PeriodMismatchRecovery(
      scope,
      response,
      mismatchRecovery,
    );
    if (mismatchRecoveryStop) {
      return withPersistedSinglePeriodSummary(
        scope,
        mismatchRecoveryStop,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    returnTypeMismatchRecovery = updateReturnTypeMismatchRecovery(
      returnTypeMismatchRecovery,
      scope,
      lastStep,
    );
    const returnTypeMismatchRecoveryStop = stopNonConvergingReturnTypeMismatchRecovery(
      scope,
      response,
      returnTypeMismatchRecovery,
    );
    if (returnTypeMismatchRecoveryStop) {
      return withPersistedSinglePeriodSummary(
        scope,
        returnTypeMismatchRecoveryStop,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        activeFinancialYear,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    const mismatchRecoveryPending = pendingGstr1PeriodMismatchRecoveryStep(
      scope,
      lastStep,
      mismatchRecovery,
    );
    if (mismatchRecoveryPending) {
      lastStep = mismatchRecoveryPending;
      await delay(getFlowStepSettleMs(lastStep, deps));
      continue;
    }

    if (!shouldContinueFlow(lastStep)) {
      return withPersistedSinglePeriodSummary(
        scope,
        explainIncompleteGstr1PeriodMismatchRecovery(scope, response, mismatchRecovery),
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  const stepLimitResponse: Extract<
    PackMessageResponse,
    { ok: true; flowStep: PortalFlowStepResult }
  > = {
    ok: true,
    flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
      safeSignal: "detail-ready-step-limit-reached",
      safeMessage: detailStepLimitReachedMessage(
        scope,
        (deps.now?.() ?? new Date()).getTime() - stepStartedAt,
      ),
      userActionMessage:
        "Wait for the filed-return detail page to finish loading, then click Start download again.",
    }),
  };
  return withPersistedSinglePeriodSummary(
    scope,
    explainIncompleteGstr1PeriodMismatchRecovery(scope, stepLimitResponse, mismatchRecovery),
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
  activeFinancialYear,
  deps,
  shouldPersistSinglePeriodSummary,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  activeFinancialYear: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  shouldPersistSinglePeriodSummary: boolean;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  const response = await triggerSelectedArtifacts({
    activePeriod,
    activeFinancialYear,
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

function shouldWaitForDetailReadyAfterResultNavigation(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): boolean {
  return (
    deps.stageCapturedDownloads?.bundleKind === "full-fiscal-year" ||
    deps.stageCapturedDownloads?.bundleKind === "all-supported-full-fiscal-year" ||
    scope.returnType === "GSTR-1" ||
    scope.returnType === "GSTR-2B" ||
    scope.artifactType === "PDF_AND_EXCEL" ||
    scope.artifactType === "EXCEL"
  );
}
