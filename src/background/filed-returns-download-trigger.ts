import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { FULL_FISCAL_YEAR_PERIOD } from "../core/filed-returns-scope";
import { type FiledReturnsConcreteArtifactType } from "../core/filed-returns-artifacts";
import { filedReturnDescriptor } from "../connectors/gst/filed-returns-return-descriptors";
import {
  shouldFallBackToPortalClick,
  targetBoundPortalClickObservationTimeoutMs,
} from "../connectors/gst/filed-returns-download-fallback";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  mergeFlowStepWithDownloadObservation,
  observeNextBrowserDownload,
} from "./download-observer";
import { suggestNextBrowserDownloadFilename } from "./download-filename-suggester";
import {
  startCapturedFiledReturnDownload,
  startMainWorldCapturedFiledReturnDownload,
} from "./filed-returns-captured-download";
import { triggerDirectFiledReturnDownload } from "./filed-returns-direct-download-trigger";
import { targetUrlSubstrings } from "./filed-returns-direct-download-review";
import { expectedDownloadForScope } from "./filed-returns-download-expectations";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import {
  targetReviewScope,
  withArtifactDownloadMessage,
  withDownloadedArtifactSignal,
} from "./filed-returns-download-result";
import {
  armFiledReturnsAction,
  bindFiledReturnsActionDownload,
  settleFiledReturnsAction,
} from "./filed-returns-action-journal";
import {
  runDownloadTriggerOnce,
  type FiledReturnsFlowMessagingDeps,
} from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";

type FlowStepResponse = Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>;

export async function triggerAndObserveFiledReturnDownload({
  activePeriod,
  artifactType = "PDF",
  deps,
  forceDirectDownload = false,
  forcePortalClick = false,
  scope,
  tabId,
  targetOverride,
}: {
  activePeriod: string | null;
  artifactType?: FiledReturnsConcreteArtifactType;
  deps: FiledReturnsFlowMessagingDeps;
  forceDirectDownload?: boolean;
  forcePortalClick?: boolean;
  scope: FiledReturnsDownloadScope;
  tabId: number;
  targetOverride?: FiledReturnsDownloadTarget;
}): Promise<PackMessageResponse> {
  const initialTarget = targetOverride ?? createDownloadTarget(scope, artifactType);
  if (!initialTarget) return unverifiedPeriodResponse(scope);
  let target = forcePortalClick ? { ...initialTarget, forcePortalClick: true } : initialTarget;
  const shouldAttemptDirectDownload =
    artifactType === "PDF" &&
    !target.forcePortalClick &&
    (forceDirectDownload || deps.preferDirectDownload) &&
    filedReturnDescriptor(scope.returnType).supportsDirectDownload;

  if (shouldAttemptDirectDownload) {
    const directDownloadResponse = await triggerDirectFiledReturnDownload({
      activePeriod,
      deps,
      scope,
      tabId,
      target,
    });
    if (
      directDownloadResponse &&
      (forceDirectDownload || !shouldFallBackToPortalClick(directDownloadResponse))
    ) {
      if (
        forceDirectDownload &&
        deps.persistTargetReview !== false &&
        directDownloadResponse.ok &&
        "flowStep" in directDownloadResponse
      ) {
        const flowSummary = await persistFiledReturnsTargetReview(
          targetReviewScope(scope, artifactType),
          directDownloadResponse.flowStep,
          deps,
        );
        if (flowSummary) return { ...directDownloadResponse, flowSummary };
      }
      return directDownloadResponse;
    }
    if (forceDirectDownload) {
      const unavailableResponse = directDownloadUnavailableResponse(activePeriod, scope, target);
      if (deps.persistTargetReview !== false) {
        const flowSummary = await persistFiledReturnsTargetReview(
          targetReviewScope(scope, artifactType),
          unavailableResponse.flowStep,
          deps,
        );
        if (flowSummary) return { ...unavailableResponse, flowSummary };
      }
      return unavailableResponse;
    }
    if (directDownloadResponse) target = { ...target, actionId: createActionId() };
  }

  const armedAt = new Date();
  const usesBrowserDownloadJournal =
    deps.storageKeys.actionJournal !== undefined && deps.stageCapturedDownloads === undefined;
  if (usesBrowserDownloadJournal) {
    const journalState = await armFiledReturnsAction(
      deps.storageKeys.actionJournal,
      {
        actionId: target.actionId,
        artifactType,
        targetId: journalTargetId(target, artifactType),
      },
      armedAt,
    );
    if (journalState !== "armed") return actionJournalReviewResponse(scope, target);
  }
  const filename = safeFiledReturnDownloadFilename(scope, artifactType);
  const trustedDownloadIds = new Set<number>();
  // Portal-click downloads receive no extension-owned download ID. Only the
  // reviewed GSTR-3B endpoint and its selected return-period marker can bind
  // a native Save completion to this armed action. These values remain in
  // memory and are never persisted with the target-review record.
  const expectedUrlSubstrings = targetUrlSubstrings(scope);
  const observationContext = {
    ...expectedDownloadForScope(scope, artifactType),
    armedAt,
    expectedUrlSubstrings,
    ignoredFilenames: [filename],
    trustedDownloadIds,
  };
  const detailDownloadFilenameSuggestion = suggestNextBrowserDownloadFilename(
    browser.downloads,
    observationContext,
    filename,
  );
  const detailDownloadObservation = canObserveNativeSaveCompletion(
    target,
    expectedUrlSubstrings,
  )
    ? observeFiledReturnDownload(observationContext, targetBoundPortalClickObservationTimeoutMs())
    : observeFiledReturnDownload(observationContext);
  const observedDownloadPromise = detailDownloadObservation.promise.finally(() => {
    detailDownloadFilenameSuggestion.stop();
  });
  const triggerResponse = await runDownloadTriggerOnce(deps, tabId, target);
  if (triggerResponse.ok && "capturedDownloadRequest" in triggerResponse) {
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
    return startCapturedFiledReturnDownload({
      activePeriod,
      armedAt,
      artifactType,
      capturedDownloadRequest: triggerResponse.capturedDownloadRequest,
      deps,
      scope,
      target,
      triggerStep: triggerResponse.downloadTrigger,
    });
  }
  if (triggerResponse.ok && "mainWorldCaptureRequest" in triggerResponse) {
    const captureResponse = await startMainWorldCapturedFiledReturnDownload({
      activePeriod,
      armedAt,
      artifactType,
      deps,
      mainWorldCaptureRequest: triggerResponse.mainWorldCaptureRequest,
      scope,
      tabId,
      target,
      triggerStep: triggerResponse.downloadTrigger,
    });
    if (canReconcileNativeSaveCompletion(captureResponse, deps, expectedUrlSubstrings)) {
      const observedDownload = await observedDownloadPromise;
      return reconcileNativeSaveCompletion({
        activePeriod,
        artifactType,
        captureResponse,
        deps,
        observedDownload,
        scope,
        target,
        triggerStep: triggerResponse.downloadTrigger,
        usesBrowserDownloadJournal,
      });
    }
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
    if (usesBrowserDownloadJournal && captureResponse.ok && "flowStep" in captureResponse) {
      if (captureResponse.flowStep.state !== "downloaded") {
        await settleFiledReturnsAction(
          deps.storageKeys.actionJournal,
          target.actionId,
          "review-required",
        );
      }
    }
    const captureTimedOut =
      captureResponse.ok &&
      "flowStep" in captureResponse &&
      captureResponse.flowStep.safeSignals.some((signal) =>
        signal.endsWith("-main-world-capture-timeout"),
      );
    if (usesBrowserDownloadJournal || deps.stageCapturedDownloads || captureTimedOut) {
      if (
        (!deps.stageCapturedDownloads ||
          (deps.stageCapturedDownloads.bundleKind === "single-period" && captureTimedOut)) &&
        deps.persistTargetReview !== false &&
        captureResponse.ok &&
        "flowStep" in captureResponse
      ) {
        const stagedSelectionTimedOut =
          deps.stageCapturedDownloads?.bundleKind === "single-period" && captureTimedOut;
        const reviewStep = stagedSelectionTimedOut
          ? {
              ...captureResponse.flowStep,
              safeSignals: [
                ...captureResponse.flowStep.safeSignals,
                "single-period-zip-incomplete",
              ],
            }
          : captureResponse.flowStep;
        const flowSummary = await persistFiledReturnsTargetReview(
          stagedSelectionTimedOut ? scope : targetReviewScope(scope, artifactType),
          reviewStep,
          deps,
        );
        if (flowSummary) return { ...captureResponse, flowSummary };
      }
    }
    return captureResponse;
  }

  const triggerFlowResponse = toTriggerFlowResponse(triggerResponse, activePeriod);
  if (!triggerFlowResponse.ok || !("flowStep" in triggerFlowResponse)) {
    if (usesBrowserDownloadJournal) {
      await settleFiledReturnsAction(
        deps.storageKeys.actionJournal,
        target.actionId,
        "review-required",
      );
    }
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
    return triggerFlowResponse;
  }

  if (!shouldAwaitDownloadObservation(triggerFlowResponse.flowStep)) {
    if (usesBrowserDownloadJournal) {
      await settleFiledReturnsAction(deps.storageKeys.actionJournal, target.actionId, "failed");
    }
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
    return {
      ...triggerFlowResponse,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: shouldAttemptDirectDownload
          ? "portal-click-after-direct-fallback"
          : "portal-click",
        flowStep: triggerFlowResponse.flowStep,
        target,
      }),
    };
  }

  const observedDownload = await observedDownloadPromise;
  if (
    usesBrowserDownloadJournal &&
    !(await settleObservedPortalAction(
      deps.storageKeys.actionJournal,
      target.actionId,
      observedDownload,
      canObserveNativeSaveCompletion(target, expectedUrlSubstrings),
    ))
  ) {
    return actionJournalReviewResponse(scope, target);
  }
  const flowStep = withFiledReturnsDownloadDiagnostic({
    attemptClass: shouldAttemptDirectDownload
      ? "portal-click-after-direct-fallback"
      : "portal-click",
    flowStep: withArtifactDownloadMessage(
      withDownloadedArtifactSignal(
        normaliseAmbiguousTriggerDownloadResult(
          triggerFlowResponse.flowStep,
          mergeFlowStepWithDownloadObservation(triggerFlowResponse.flowStep, observedDownload),
        ),
        artifactType,
      ),
      scope,
      artifactType,
    ),
    safeEvidence: observedDownload.safeEvidence,
    target,
  });
  let flowSummary: FiledReturnsFlowSummary | null = null;
  if (deps.persistTargetReview !== false) {
    flowSummary = await persistFiledReturnsTargetReview(
      targetReviewScope(scope, artifactType),
      flowStep,
      deps,
    );
  }
  return {
    ...triggerFlowResponse,
    flowStep,
    ...(flowSummary ? { flowSummary } : {}),
  };
}

function canObserveNativeSaveCompletion(
  target: FiledReturnsDownloadTarget,
  expectedUrlSubstrings: readonly string[],
): boolean {
  return (
    target.returnType === "GSTR-3B" &&
    target.artifactType === "PDF" &&
    expectedUrlSubstrings.length > 0
  );
}

function canReconcileNativeSaveCompletion(
  response: PackMessageResponse,
  deps: FiledReturnsFlowMessagingDeps,
  expectedUrlSubstrings: readonly string[],
): response is Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }> {
  return Boolean(
    !deps.stageCapturedDownloads &&
      expectedUrlSubstrings.length > 0 &&
      response.ok &&
      "flowStep" in response &&
      response.flowStep.safeSignals.some((signal) => signal.endsWith("-main-world-capture-timeout")),
  );
}

async function reconcileNativeSaveCompletion({
  activePeriod,
  artifactType,
  captureResponse,
  deps,
  observedDownload,
  scope,
  target,
  triggerStep,
  usesBrowserDownloadJournal,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  captureResponse: Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>;
  deps: FiledReturnsFlowMessagingDeps;
  observedDownload: Awaited<ReturnType<typeof observeFiledReturnDownload>["promise"]>;
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
  usesBrowserDownloadJournal: boolean;
}): Promise<PackMessageResponse> {
  if (
    usesBrowserDownloadJournal &&
    !(await settleVerifiedObservedPortalAction(
      deps.storageKeys.actionJournal,
      target.actionId,
      observedDownload,
    ))
  ) {
    return actionJournalReviewResponse(scope, target);
  }

  const flowStep = withFiledReturnsDownloadDiagnostic({
    attemptClass: "portal-click",
    flowStep: withArtifactDownloadMessage(
      withDownloadedArtifactSignal(
        mergeFlowStepWithDownloadObservation(
          {
            ...triggerStep,
            safeSignals: Array.from(
              new Set([
                ...triggerStep.safeSignals,
                ...captureResponse.flowStep.safeSignals.filter(
                  (signal) =>
                    !signal.endsWith("-main-world-capture-timeout") &&
                    !signal.endsWith("-blob-capture-failed"),
                ),
                "filed-return-native-save-capture-fallback",
                "filed-return-native-save-completion-observed",
                ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
              ]),
            ),
            safeMessage:
              "Pack could not capture the portal-generated file locally, so it waited for the browser to complete the target-bound portal download.",
          },
          observedDownload,
        ),
        artifactType,
      ),
      scope,
      artifactType,
    ),
    safeEvidence: observedDownload.safeEvidence,
    target,
  });
  const flowSummary =
    deps.persistTargetReview === false
      ? null
      : await persistFiledReturnsTargetReview(targetReviewScope(scope, artifactType), flowStep, deps);
  return { ok: true, flowStep, ...(flowSummary ? { flowSummary } : {}) };
}

async function settleVerifiedObservedPortalAction(
  actionJournalKey: string | undefined,
  actionId: string,
  observedDownload: Awaited<ReturnType<typeof observeFiledReturnDownload>["promise"]>,
): Promise<boolean> {
  if (observedDownload.state !== "completed") {
    return settleFiledReturnsAction(
      actionJournalKey,
      actionId,
      observedDownload.state === "failed" ? "failed" : "review-required",
    );
  }

  const downloadId = observedDownload.safeEvidence?.downloadId;
  if (!isPersistableBrowserDownloadId(downloadId)) {
    return settleFiledReturnsAction(actionJournalKey, actionId, "review-required");
  }
  if (!(await bindFiledReturnsActionDownload(actionJournalKey, actionId, downloadId))) return false;
  return settleFiledReturnsAction(actionJournalKey, actionId, "verified");
}

function isPersistableBrowserDownloadId(downloadId: unknown): downloadId is number {
  return Number.isInteger(downloadId) && downloadId > 0 && downloadId <= 1_000_000;
}

async function settleObservedPortalAction(
  actionJournalKey: string | undefined,
  actionId: string,
  observedDownload: Awaited<ReturnType<typeof observeFiledReturnDownload>["promise"]>,
  canVerifyTargetBoundDownload: boolean,
): Promise<boolean> {
  if (!canVerifyTargetBoundDownload) {
    return settleFiledReturnsAction(actionJournalKey, actionId, "review-required");
  }
  return settleVerifiedObservedPortalAction(actionJournalKey, actionId, observedDownload);
}

function journalTargetId(
  target: FiledReturnsDownloadTarget,
  artifactType: FiledReturnsConcreteArtifactType,
): string {
  return `${target.returnType}:${target.financialYear}:${target.period}:${artifactType}`;
}

function actionJournalReviewResponse(
  scope: FiledReturnsDownloadScope,
  target: FiledReturnsDownloadTarget,
): FlowStepResponse {
  return {
    ok: true,
    flowStep: withFiledReturnsDownloadDiagnostic({
      attemptClass: "portal-click",
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId(scope.returnType),
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-action-journal-review-required"],
        safeMessage:
          "Pack found an unresolved local portal-download action and will not click again automatically. Review browser Downloads before starting a new attempt.",
      },
      target,
    }),
  };
}

function createDownloadTarget(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsDownloadTarget | null {
  if (scope.period === "ALL" || scope.period === FULL_FISCAL_YEAR_PERIOD) return null;
  return {
    actionId: createActionId(),
    artifactType,
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
  };
}

function toTriggerFlowResponse(
  response: PackMessageResponse,
  activePeriod: string | null,
): PackMessageResponse {
  if (!response.ok || "flowStep" in response) return response;
  if ("downloadTrigger" in response) {
    return {
      ...response,
      flowStep: {
        ...response.downloadTrigger,
        safeSignals: [
          ...response.downloadTrigger.safeSignals,
          ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
        ],
      },
    };
  }
  return response;
}

function shouldAwaitDownloadObservation(step: PortalFlowStepResult): boolean {
  if (step.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous")) return true;
  if (step.state !== "clicked") return false;
  return (
    step.safeSignals.includes("filed-return-download-clicked") ||
    step.safeSignals.includes("gstr2b-download-clicked") ||
    step.safeSignals.includes("filed-gstr3b-download-clicked") ||
    step.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous")
  );
}

function normaliseAmbiguousTriggerDownloadResult(
  triggerStep: PortalFlowStepResult,
  mergedStep: PortalFlowStepResult,
): PortalFlowStepResult {
  if (
    !triggerStep.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous") ||
    mergedStep.state !== "downloaded"
  ) {
    return mergedStep;
  }

  return {
    ...mergedStep,
    state: "download-unconfirmed",
    safeMessage:
      "Pack saw a matching GST PDF download, but could not confirm that Pack delivered the download click. It will not mark this target as downloaded without a confirmed click.",
    ...(triggerStep.userAction ? { userAction: triggerStep.userAction } : {}),
  };
}

function unverifiedPeriodResponse(scope: FiledReturnsDownloadScope): FlowStepResponse {
  const descriptor = filedReturnDescriptor(scope.returnType);
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId(scope.returnType),
      state: "user-action-required",
      safeSignals: ["filed-return-detail-period-unverified"],
      safeMessage: `Pack could not verify which ${descriptor.label} period is open, so it did not click the download control.`,
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: `Open the filed ${descriptor.label} detail page for one period, then start Pack again.`,
        canResume: true,
      },
    },
  };
}

function directDownloadUnavailableResponse(
  activePeriod: string | null,
  scope: FiledReturnsDownloadScope,
  target: FiledReturnsDownloadTarget,
): FlowStepResponse {
  return {
    ok: true,
    flowStep: withFiledReturnsDownloadDiagnostic({
      attemptClass: "extension-direct",
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId(scope.returnType),
        state: "blocked",
        safeSignals: [
          "filed-gstr3b-direct-download-unavailable",
          ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
        ],
        safeMessage:
          "Pack could not obtain a reviewed GSTR-3B download request. It did not start a portal download.",
      },
      target,
    }),
  };
}

export function observeFiledReturnDownload(
  context = {
    ...expectedDownloadForScope({ returnType: "GSTR-3B" }, "PDF"),
    armedAt: new Date(),
    expectedUrlSubstrings: [],
  },
  timeoutMs?: number,
) {
  return timeoutMs === undefined
    ? observeNextBrowserDownload(browser.downloads, context)
    : observeNextBrowserDownload(browser.downloads, context, timeoutMs);
}

function createActionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
