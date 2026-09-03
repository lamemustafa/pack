import type {
  FiledReturnsAllSupportedFullFiscalYearRequest,
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { FULL_FISCAL_YEAR_PERIOD } from "../connectors/gst/filed-returns-scope";
import type {
  AllSupportedFullFiscalYearTargetRecoveryPayload,
  FullFiscalYearTargetRecoveryPayload,
  FiledReturnsFreshStartPayload,
  PackMessage,
  PackMessageResponse,
} from "../connectors/gst/messages";
import {
  getFiledReturnsFullFiscalYearPeriods,
  isFullFiscalYearScope,
} from "../connectors/gst/filed-returns-scope";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  acquireFiledReturnsRun,
  releaseFiledReturnsRun,
  startFiledReturnsRunLeaseRenewal,
} from "./filed-returns-active-run";
import type { ActiveGstTab } from "./filed-returns-active-tab";
import type { MainWorldFiledReturnsFilterSelectionOutcome } from "../connectors/gst/main-world-filed-returns-filter-selection";
import { startFullFiscalYearDownloadFlow } from "./filed-returns-full-fiscal-year";
import {
  restartCompletedAllSupportedFullFiscalYearPlan,
  retryAllSupportedFullFiscalYearTarget,
  startAllSupportedFullFiscalYearDownloadFlow,
} from "./filed-returns-all-supported-full-fiscal-year";
import {
  discardMalformedFullFiscalYearRunForFreshStart,
  prepareFullFiscalYearTargetRetry,
  readFullFiscalYearTargetRecoveryScope,
  resolveFullFiscalYearTarget,
} from "./filed-returns-full-fiscal-year-recovery";
import {
  canCompleteFullFiscalYearLedger,
  sameFiledReturnsScope,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  hasRetainedFullFiscalYearStaging,
  readMalformedLedgerState,
  readPlanLedgersStorageState,
  readRetainedPlanLedgers,
  responseForExistingLedger,
} from "./filed-returns-full-fiscal-year-run-state";
import { readAllSupportedPlanLedgersStorageState } from "./filed-returns-all-supported-full-fiscal-year-run-state";
import {
  clearFiledReturnsTargetReview,
  malformedTargetReviewResponse,
  noTargetReviewResponse,
  readFiledReturnsTargetReview,
  readCurrentFiledReturnsTargetReview,
  readCurrentFiledReturnsTargetReviewStorageState,
  reconcileRetainedArtifactAcquisition,
  retryCompletedSinglePeriodZipCleanup,
  resolveUnconfirmedFiledReturnsDownload,
  responseForFiledReturnsTargetReview,
  persistFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { startSinglePeriodFiledReturnsDownloadFlow } from "./filed-returns-single-period-flow";
import { reconcileFiledReturnsTargetDownload } from "./filed-returns-target-download-recovery";
import {
  createMalformedArtifactAcquisitionCheckpointReference,
  readArtifactAcquisitionCheckpoints,
  reconcileArtifactAcquisitionCheckpoint,
} from "./artifact-acquisition-state";

export type { ActiveGstTab } from "./filed-returns-active-tab";

export interface FiledReturnsFlowRunnerDeps {
  getActiveGstTab: () => Promise<ActiveGstTab | null>;
  sendMessageToTabWithInjection: (
    tabId: number,
    message: Extract<
      PackMessage,
      {
        type:
          | "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3"
          | "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3"
          | "PACK_CONTENT_CLEAR_FILED_RETURNS_SEARCH_PENDING_V3"
          | "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3"
          | "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34"
          | "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3";
      }
    >,
  ) => Promise<PackMessageResponse>;
  storageKeys: {
    activeRun?: string;
    allSupportedFullFiscalYearLedgerIndex?: string;
    completion: string;
    fullFiscalYearLedger: string;
    fullFiscalYearLedgerIndex?: string;
    observation: string;
    targetReview?: string;
  };
  now?: () => Date;
  openReturnsDashboardWithPortalAnchor?: (
    tabId: number,
  ) => Promise<"clicked" | "not-found" | "ambiguous" | null>;
  verifyReturnsOriginContentScript?: (tabId: number) => Promise<boolean>;
  portalTabIncognito?: boolean;
  /** Internal fixed projection; it never receives portal-derived flow data. */
  onFlowStepObservation?: (observation: FiledReturnsFlowStepObservation) => void;
  persistTargetReview?: boolean;
  selectFiltersInMainWorld?: (
    tabId: number,
    scope: FiledReturnsDownloadScope,
  ) => Promise<MainWorldFiledReturnsFilterSelectionOutcome>;
  stageCapturedDownloads?: {
    bundleKind?: "all-supported-full-fiscal-year" | "full-fiscal-year" | "single-period";
    ledgerId: string;
  };
  timings?: {
    contentMessageTimeoutMs?: number;
    detailSummaryModalSettleMs?: number;
    flowStepDeadlineMs?: number;
    flowStepSettleMs?: number;
    portalNavigationSettleMs?: number;
    returnsDashboardNavigationTimeoutMs?: number;
    resultRowNavigationSettleMs?: number;
    targetBoundPortalDownloadWaitMs?: number;
  };
}

export type FiledReturnsFlowStepCategory =
  "artifact-trigger" | "detail-navigation" | "other" | "portal-navigation";

export interface FiledReturnsFlowStepObservation {
  category: FiledReturnsFlowStepCategory;
  portalSystemError: boolean;
}

export async function startFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  let targetReviewState;
  try {
    targetReviewState = await readCurrentFiledReturnsTargetReviewStorageState(deps);
  } catch {
    return targetReviewStorageUnavailableResponse(scope, deps);
  }
  if (targetReviewState.state === "malformed") {
    return malformedTargetReviewResponse(scope, blockedScopeTotalPeriods(scope, deps));
  }
  if (targetReviewState.state === "valid") {
    return responseForFiledReturnsTargetReview(targetReviewState.review);
  }
  const allSupportedLock = await allSupportedPlanStartLockResponse(scope, deps);
  if (allSupportedLock) return allSupportedLock;

  const activeRun = await acquireFiledReturnsRun(scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    const retainedArtifactRecovery = await surfaceRetainedArtifactAcquisitionReview(scope, deps);
    if (retainedArtifactRecovery) return retainedArtifactRecovery;

    if (isFullFiscalYearScope(scope)) {
      const planLedgers = await readPlanLedgersStorageState(deps);
      if (planLedgers.state === "malformed") {
        const flowStep: PortalFlowStepResult = {
          connectorId: "gst",
          scopeId: "gst-filed-returns-private-v0",
          state: "blocked",
          safeSignals: ["full-fiscal-year-ledger-malformed", "full-fiscal-year-opfs-retained"],
          safeMessage:
            "Pack found damaged fiscal-year recovery metadata and cannot verify whether local staging remains.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message:
              "Use Clear local Pack data to remove the retained staging before starting again.",
            canResume: false,
          },
        };
        return {
          ok: true,
          flowStep,
          flowSummary: {
            scope,
            status: "blocked",
            completedPeriods: [],
            totalPeriods: blockedScopeTotalPeriods(scope, deps),
            flowStep,
          },
        };
      }
      const malformedLedger = await readMalformedLedgerState(deps.storageKeys.fullFiscalYearLedger);
      if (malformedLedger) {
        const flowStep: PortalFlowStepResult = {
          connectorId: "gst",
          scopeId: "gst-filed-returns-private-v0",
          state: "blocked",
          safeSignals: [
            "full-fiscal-year-ledger-malformed",
            ...(malformedLedger.recoverableLedgerId ? ["full-fiscal-year-opfs-retained"] : []),
          ],
          safeMessage:
            "Pack found damaged fiscal-year recovery metadata and cannot verify whether local staging remains.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message:
              "Use Clear local Pack data to remove the retained staging before starting again.",
            canResume: false,
          },
        };
        return {
          ok: true,
          flowStep,
          flowSummary: {
            scope,
            status: "blocked",
            completedPeriods: [],
            totalPeriods: blockedScopeTotalPeriods(scope, deps),
            flowStep,
          },
        };
      }
      for (const existingLedger of await readRetainedPlanLedgers(deps)) {
        const replaceableCompletedLedger =
          existingLedger.status === "complete" &&
          canCompleteFullFiscalYearLedger(existingLedger) &&
          !existingLedger.zipDownloadAttempt &&
          !hasRetainedFullFiscalYearStaging(existingLedger);
        if (!sameFiledReturnsScope(existingLedger.scope, scope) && !replaceableCompletedLedger) {
          const existingLedgerResponse = responseForExistingLedger(
            existingLedger,
            deps.now?.() ?? new Date(),
            { blockRetainedStaging: true },
          );
          if (existingLedgerResponse) return existingLedgerResponse;
        }
      }
    }
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

async function allSupportedPlanStartLockResponse(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  resumableRoot?: FiledReturnsAllSupportedFullFiscalYearRequest,
): Promise<PackMessageResponse | null> {
  if (!deps.storageKeys.allSupportedFullFiscalYearLedgerIndex) return null;
  const state = await readAllSupportedPlanLedgersStorageState(deps);
  if (state.state !== "valid") {
    const unavailable = state.state === "provenance-unavailable";
    const removalPending = state.state === "removal-pending";
    return {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId(scope.returnType),
        state: "blocked",
        safeSignals: [
          unavailable
            ? "all-supported-full-fiscal-year-plan-provenance-unavailable"
            : removalPending
              ? "all-supported-full-fiscal-year-plan-removal-recovery-pending"
              : "all-supported-full-fiscal-year-plan-index-malformed",
        ],
        safeMessage: unavailable
          ? "Pack cannot verify an existing saved fiscal-year plan before starting another return."
          : removalPending
            ? "Pack is finishing removal of a saved fiscal-year plan before starting another return."
            : "Pack could not verify the saved all-supported fiscal-year plan index before starting another return.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: unavailable
            ? "Clear local Pack data before starting another return."
            : "Retry after Pack finishes the saved-plan recovery.",
          canResume: false,
        },
      },
    };
  }
  if (
    !state.ledgers.some(
      (ledger) =>
        ledger.status !== "complete" &&
        ledger.status !== "cancelled" &&
        (!resumableRoot ||
          ledger.planRoot.kind !== resumableRoot.kind ||
          ledger.planRoot.financialYear !== resumableRoot.financialYear),
    )
  ) {
    return null;
  }
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId(scope.returnType),
      state: "blocked",
      safeSignals: ["all-supported-full-fiscal-year-run-needs-action"],
      safeMessage:
        "Pack retained an all-supported fiscal-year plan and will not start overlapping return work.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message:
          "Discard the saved all-supported fiscal-year plan from its run summary before starting another return.",
        canResume: false,
      },
    },
  };
}

/**
 * Starts the separate all-supported-returns root under the same durable
 * operation lease as every other filed-return action. The lease is anchored to
 * one derived atomic full-year scope only because the existing lease record is
 * a concurrency guard; the all-returns ledger remains the authoritative root
 * plan and target state.
 */
export async function startAllSupportedFiledReturnsFullFiscalYearDownloadFlow(
  request: FiledReturnsAllSupportedFullFiscalYearRequest,
  deps: FiledReturnsFlowRunnerDeps,
  options: { discardCompletedPlanRoot?: boolean } = {},
): Promise<PackMessageResponse> {
  const leaseScope = allSupportedLeaseScope(request);
  if (!leaseScope) {
    return startAllSupportedFullFiscalYearDownloadFlow(
      request,
      deps as never,
      startSinglePeriodFiledReturnsDownloadFlow,
    );
  }
  const existingRecovery = await allSupportedRecoveryPreflight(leaseScope, deps);
  if (existingRecovery) return existingRecovery;
  const allSupportedLock = await allSupportedPlanStartLockResponse(leaseScope, deps, request);
  if (allSupportedLock) return allSupportedLock;

  const activeRun = await acquireFiledReturnsRun(leaseScope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    const retainedArtifactRecovery = await surfaceRetainedArtifactAcquisitionReview(
      leaseScope,
      deps,
    );
    if (retainedArtifactRecovery) return retainedArtifactRecovery;
    if (options.discardCompletedPlanRoot) {
      return restartCompletedAllSupportedFullFiscalYearPlan(
        request,
        deps as never,
        startSinglePeriodFiledReturnsDownloadFlow,
      );
    }
    const planRoot = { kind: request.kind, financialYear: request.financialYear };
    return startAllSupportedFullFiscalYearDownloadFlow(
      planRoot,
      deps as never,
      startSinglePeriodFiledReturnsDownloadFlow,
    );
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

/** Runs an explicitly reviewed all-supported child under the normal durable lease. */
export async function retryAllSupportedFiledReturnsFullFiscalYearTarget(
  payload: AllSupportedFullFiscalYearTargetRecoveryPayload,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const planRoot: FiledReturnsAllSupportedFullFiscalYearRequest = {
    kind: "all-supported-returns-full-fiscal-year",
    financialYear: payload.financialYear,
  };
  const leaseScope = allSupportedLeaseScope(planRoot);
  if (!leaseScope) {
    return retryAllSupportedFullFiscalYearTarget(
      payload,
      deps as never,
      startSinglePeriodFiledReturnsDownloadFlow,
    );
  }
  const existingRecovery = await allSupportedRecoveryPreflight(leaseScope, deps);
  if (existingRecovery) return existingRecovery;
  const allSupportedLock = await allSupportedPlanStartLockResponse(leaseScope, deps, planRoot);
  if (allSupportedLock) return allSupportedLock;
  const activeRun = await acquireFiledReturnsRun(leaseScope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    // Recovery may be persisted after the first preflight and before this retry
    // obtains the shared lease. Re-read it while holding the lease so a newly
    // durable review is surfaced instead of replaying a portal action.
    const concurrentRecovery = await allSupportedRecoveryPreflight(leaseScope, deps);
    if (concurrentRecovery) return concurrentRecovery;
    const concurrentAllSupportedLock = await allSupportedPlanStartLockResponse(
      leaseScope,
      deps,
      planRoot,
    );
    if (concurrentAllSupportedLock) return concurrentAllSupportedLock;
    const retainedArtifactRecovery = await surfaceRetainedArtifactAcquisitionReview(
      leaseScope,
      deps,
    );
    if (retainedArtifactRecovery) return retainedArtifactRecovery;
    return retryAllSupportedFullFiscalYearTarget(
      payload,
      deps as never,
      startSinglePeriodFiledReturnsDownloadFlow,
    );
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

async function allSupportedRecoveryPreflight(
  leaseScope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse | null> {
  let targetReviewState;
  try {
    targetReviewState = await readCurrentFiledReturnsTargetReviewStorageState(deps);
  } catch {
    return targetReviewStorageUnavailableResponse(leaseScope, deps);
  }
  if (targetReviewState.state === "malformed") {
    return malformedTargetReviewResponse(leaseScope, blockedScopeTotalPeriods(leaseScope, deps));
  }
  if (targetReviewState.state === "valid") {
    return responseForFiledReturnsTargetReview(targetReviewState.review);
  }
  const retainedPlans = await readPlanLedgersStorageState(deps);
  if (retainedPlans.state === "malformed")
    return retainedFullFiscalYearPlanLockResponse(leaseScope);
  for (const ledger of await readRetainedPlanLedgers(deps)) {
    const replaceable =
      ledger.status === "complete" &&
      canCompleteFullFiscalYearLedger(ledger) &&
      !ledger.zipDownloadAttempt &&
      !hasRetainedFullFiscalYearStaging(ledger);
    if (!replaceable) {
      const response = responseForExistingLedger(ledger, deps.now?.() ?? new Date(), {
        blockRetainedStaging: true,
      });
      if (response) return response;
    }
  }
  return null;
}

function retainedFullFiscalYearPlanLockResponse(
  scope: FiledReturnsDownloadScope,
): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId(scope.returnType),
      state: "blocked",
      safeSignals: ["full-fiscal-year-ledger-malformed", "full-fiscal-year-opfs-retained"],
      safeMessage:
        "Pack could not verify retained fiscal-year recovery before starting the all-supported plan.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Clear local Pack data before starting another return.",
        canResume: false,
      },
    },
  };
}

function allSupportedLeaseScope(
  request: FiledReturnsAllSupportedFullFiscalYearRequest,
): FiledReturnsDownloadScope | null {
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  const first = expansion.ok ? expansion.targets[0] : undefined;
  if (!first) return null;
  return {
    financialYear: request.financialYear,
    period: FULL_FISCAL_YEAR_PERIOD,
    returnType: first.returnType,
    artifactType: first.artifactType,
  };
}

function targetReviewStorageUnavailableResponse(
  scope: FiledReturnsDownloadScope,
  deps: Pick<FiledReturnsFlowRunnerDeps, "now">,
): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: "gst-filed-returns-private-v0",
    state: "blocked",
    safeSignals: ["filed-returns-target-review-storage-unavailable"],
    safeMessage:
      "Pack could not read saved target recovery and will not start another portal action.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Try again after local recovery state is available.",
      canResume: true,
    },
  };
  return {
    ok: true,
    flowStep,
    flowSummary: {
      scope,
      status: "blocked",
      completedPeriods: [],
      currentPeriod: scope.period,
      totalPeriods: blockedScopeTotalPeriods(scope, deps),
      flowStep,
    },
  };
}

export async function retryFullFiscalYearTargetDownloadFlow(
  payload: FullFiscalYearTargetRecoveryPayload,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const recoveryScope = await readFullFiscalYearTargetRecoveryScope(payload, deps);
  if ("response" in recoveryScope) return recoveryScope.response;

  const targetReview = await readCurrentFiledReturnsTargetReview(deps);
  if (targetReview && targetReview.targetId !== payload.targetId) {
    return responseForFiledReturnsTargetReview(targetReview);
  }

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

export async function retryFiledReturnsTargetDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const initialTargetReview = await readFiledReturnsTargetReview(scope, deps);
  if (!initialTargetReview) return noTargetReviewResponse(scope);

  const activeRun = await acquireFiledReturnsRun(scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    const targetReview = await readFiledReturnsTargetReview(scope, deps);
    if (!targetReview) {
      const currentState = await readCurrentFiledReturnsTargetReviewStorageState(deps);
      if (currentState.state === "malformed") {
        return malformedTargetReviewResponse(scope, blockedScopeTotalPeriods(scope, deps));
      }
      return currentState.state === "valid"
        ? responseForFiledReturnsTargetReview(currentState.review)
        : noTargetReviewResponse(scope);
    }
    const cleanupResponse = await retryCompletedSinglePeriodZipCleanup(scope, deps);
    if (cleanupResponse) return cleanupResponse;
    const artifactAcquisitionResponse = await reconcileRetainedArtifactAcquisition(scope, deps);
    if (artifactAcquisitionResponse) return artifactAcquisitionResponse;
    const reconciliation = await reconcileFiledReturnsTargetDownload(targetReview, deps);
    if (reconciliation.state === "handled") return reconciliation.response;
    const retrySafeReview = await readFiledReturnsTargetReview(scope, deps);
    if (retrySafeReview) {
      const cleared = await clearFiledReturnsTargetReview(
        scope,
        deps,
        retrySafeReview.revision ?? 1,
      );
      if (!cleared) {
        const currentState = await readCurrentFiledReturnsTargetReviewStorageState(deps);
        if (currentState.state === "malformed") {
          return malformedTargetReviewResponse(scope, blockedScopeTotalPeriods(scope, deps));
        }
        if (currentState.state === "valid") {
          return responseForFiledReturnsTargetReview(currentState.review);
        }
      }
    } else {
      const currentState = await readCurrentFiledReturnsTargetReviewStorageState(deps);
      if (currentState.state === "malformed") {
        return malformedTargetReviewResponse(scope, blockedScopeTotalPeriods(scope, deps));
      }
      if (currentState.state === "valid") {
        return responseForFiledReturnsTargetReview(currentState.review);
      }
    }
    return startSinglePeriodFiledReturnsDownloadFlow(scope, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

async function surfaceRetainedArtifactAcquisitionReview(
  requestedScope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse | null> {
  let checkpoints;
  try {
    checkpoints = await readArtifactAcquisitionCheckpoints();
  } catch {
    return blockedRetainedArtifactAcquisitionResponse(
      requestedScope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "blocked",
        safeSignals: ["artifact-acquisition-checkpoint-storage-unavailable"],
        safeMessage:
          "Pack could not read retained local artifact recovery and will not start another portal action.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Try again after local recovery state is available.",
          canResume: true,
        },
      },
      deps,
    );
  }
  for (const checkpoint of checkpoints) {
    if (checkpoint.state === "malformed") continue;
    const { target } = checkpoint;
    const inspection = await reconcileArtifactAcquisitionCheckpoint(target);
    if (inspection.state !== "needs-review") continue;
    const flowStep: PortalFlowStepResult = {
      connectorId: "gst",
      scopeId: filedReturnScopeId(target.returnType),
      state: "blocked",
      safeSignals: ["artifact-acquisition-download-unreconciled", ...inspection.safeSignals],
      safeMessage:
        "Pack retained an exact browser download for a different target and will not start another portal action until it is resolved.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Review or cancel the saved target before starting another portal action.",
        canResume: true,
      },
    };
    const summary = await persistFiledReturnsTargetReview(target, flowStep, deps);
    return summary
      ? { ok: true, flowStep: summary.flowStep, flowSummary: summary }
      : blockedRetainedArtifactAcquisitionResponse(requestedScope, flowStep, deps);
  }
  const malformedCheckpoint = checkpoints.find((checkpoint) => checkpoint.state === "malformed");
  if (!malformedCheckpoint || malformedCheckpoint.state !== "malformed") return null;
  const malformedCheckpointReference = await createMalformedArtifactAcquisitionCheckpointReference(
    malformedCheckpoint.key,
  );
  if (!malformedCheckpointReference) {
    return blockedRetainedArtifactAcquisitionResponse(
      requestedScope,
      {
        connectorId: "gst",
        scopeId: "gst-filed-returns-private-v0",
        state: "blocked",
        safeSignals: ["artifact-acquisition-malformed-reference-unavailable"],
        safeMessage:
          "Pack found malformed retained artifact recovery but could not prepare its local review safely.",
      },
      deps,
    );
  }
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: "gst-filed-returns-private-v0",
    state: "blocked",
    safeSignals: ["artifact-acquisition-checkpoint-malformed"],
    safeMessage:
      "Pack found malformed retained artifact recovery and will not start another portal action until you cancel it.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Cancel the saved recovery before starting another portal action.",
      canResume: true,
    },
  };
  const summary = await persistFiledReturnsTargetReview(requestedScope, flowStep, deps, {
    artifactAcquisitionMalformedCheckpointReference: malformedCheckpointReference,
  });
  return summary
    ? { ok: true, flowStep: summary.flowStep, flowSummary: summary }
    : blockedRetainedArtifactAcquisitionResponse(requestedScope, flowStep, deps);
}

function blockedRetainedArtifactAcquisitionResponse(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): PackMessageResponse {
  const flowSummary: FiledReturnsFlowSummary = {
    scope,
    status: "blocked",
    completedPeriods: [],
    currentPeriod: scope.period,
    totalPeriods: isFullFiscalYearScope(scope)
      ? getFiledReturnsFullFiscalYearPeriods(scope.financialYear, deps.now?.() ?? new Date()).length
      : 1,
    flowStep,
  };
  return { ok: true, flowStep, flowSummary };
}

function blockedScopeTotalPeriods(
  scope: FiledReturnsDownloadScope,
  deps: Pick<FiledReturnsFlowRunnerDeps, "now">,
): number {
  return isFullFiscalYearScope(scope)
    ? getFiledReturnsFullFiscalYearPeriods(scope.financialYear, deps.now?.() ?? new Date()).length
    : 1;
}

export async function resolveUnconfirmedFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  resolution: "manually-observed" | "cancelled",
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const activeRun = await acquireFiledReturnsRun(scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    return resolveUnconfirmedFiledReturnsDownload(scope, resolution, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

export async function resolveFullFiscalYearTargetFlow(
  payload: FullFiscalYearTargetRecoveryPayload,
  resolution: "manually-observed" | "cancelled",
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const recoveryScope = await readFullFiscalYearTargetRecoveryScope(payload, deps);
  if ("response" in recoveryScope) return recoveryScope.response;

  const activeRun = await acquireFiledReturnsRun(recoveryScope.scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    return resolveFullFiscalYearTarget(payload, resolution, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

export async function startFreshFiledReturnsDownloadFlow(
  payload: FiledReturnsFreshStartPayload,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const allSupportedLock = await allSupportedPlanStartLockResponse(payload.scope, deps);
  if (allSupportedLock) return allSupportedLock;
  let fullFiscalYearRecoveryFailure: PackMessageResponse | null = null;
  if (payload.recovery.kind === "target-review") {
    const targetReview = await readFiledReturnsTargetReview(payload.recovery.scope, deps);
    if (!targetReview) return noTargetReviewResponse(payload.recovery.scope);
  } else {
    const recoveryScope = await readFullFiscalYearTargetRecoveryScope(payload.recovery, deps);
    if ("response" in recoveryScope) fullFiscalYearRecoveryFailure = recoveryScope.response;
  }

  const activeRun = await acquireFiledReturnsRun(payload.scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    if (payload.recovery.kind === "full-fiscal-year" && fullFiscalYearRecoveryFailure) {
      const discardedMalformedLedger = await discardMalformedFullFiscalYearRunForFreshStart(
        { ledgerId: payload.recovery.ledgerId, scope: payload.scope },
        deps,
      );
      if (discardedMalformedLedger.state === "blocked") return discardedMalformedLedger.response;
      if (discardedMalformedLedger.state !== "discarded") return fullFiscalYearRecoveryFailure;
    }
    if (payload.recovery.kind === "target-review") {
      const targetReview = await readFiledReturnsTargetReview(payload.recovery.scope, deps);
      if (!targetReview) return noTargetReviewResponse(payload.recovery.scope);
      if (targetReview.downloadAttempt) {
        const reconciliation = await reconcileFiledReturnsTargetDownload(targetReview, deps);
        if (reconciliation.state === "handled") return reconciliation.response;
      }
    }
    const discarded =
      payload.recovery.kind === "target-review"
        ? await resolveUnconfirmedFiledReturnsDownload(payload.recovery.scope, "cancelled", deps)
        : fullFiscalYearRecoveryFailure
          ? null
          : await resolveFullFiscalYearTarget(payload.recovery, "cancelled", deps);
    if (discarded && !isRecoveryDiscarded(discarded)) return discarded;
    if (payload.recovery.kind === "full-fiscal-year") {
      const remainingTargetReview = await readCurrentFiledReturnsTargetReview(deps);
      if (remainingTargetReview) return responseForFiledReturnsTargetReview(remainingTargetReview);
    }

    const retainedArtifactRecovery = await surfaceRetainedArtifactAcquisitionReview(
      payload.scope,
      deps,
    );
    if (retainedArtifactRecovery) return retainedArtifactRecovery;

    if (isFullFiscalYearScope(payload.scope)) {
      return startFullFiscalYearDownloadFlow(
        payload.scope,
        deps,
        startSinglePeriodFiledReturnsDownloadFlow,
      );
    }
    return startSinglePeriodFiledReturnsDownloadFlow(payload.scope, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

function isRecoveryDiscarded(response: PackMessageResponse): boolean {
  if (!response.ok || !("flowStep" in response)) return false;
  return response.flowStep.safeSignals.some((signal) =>
    ["filed-returns-target-cancelled", "full-fiscal-year-run-discarded"].includes(signal),
  );
}
