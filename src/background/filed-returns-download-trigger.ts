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
  shouldFallBackAfterCaptureFailure,
  shouldFallBackToPortalClick,
  targetBoundPortalClickObservationTimeoutMs,
  withCaptureFallbackSignal,
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
import { expectedDownloadForScope } from "./filed-returns-download-expectations";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import {
  targetReviewScope,
  withArtifactDownloadMessage,
  withDownloadedArtifactSignal,
} from "./filed-returns-download-result";
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
  scope,
  tabId,
  targetOverride,
}: {
  activePeriod: string | null;
  artifactType?: FiledReturnsConcreteArtifactType;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
  targetOverride?: FiledReturnsDownloadTarget;
}): Promise<PackMessageResponse> {
  const target = targetOverride ?? createDownloadTarget(scope, artifactType);
  if (!target) return unverifiedPeriodResponse(scope);
  const shouldAttemptDirectDownload =
    artifactType === "PDF" &&
    !target.forcePortalClick &&
    deps.preferDirectDownload &&
    filedReturnDescriptor(scope.returnType).supportsDirectDownload;

  if (shouldAttemptDirectDownload) {
    const directDownloadResponse = await triggerDirectFiledReturnDownload({
      activePeriod,
      deps,
      scope,
      tabId,
      target,
    });
    if (directDownloadResponse && !shouldFallBackToPortalClick(directDownloadResponse)) {
      return directDownloadResponse;
    }
  }

  const armedAt = new Date();
  const filename = safeFiledReturnDownloadFilename(scope, artifactType);
  const trustedDownloadIds = new Set<number>();
  const observationContext = {
    ...expectedDownloadForScope(scope, artifactType),
    armedAt,
    expectedUrlSubstrings: [],
    ignoredFilenames: [filename],
    trustedDownloadIds,
  };
  const detailDownloadFilenameSuggestion = suggestNextBrowserDownloadFilename(
    browser.downloads,
    observationContext,
    filename,
  );
  const detailDownloadObservation = target.forcePortalClick
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
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
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
    if (
      deps.stageCapturedDownloads ||
      !shouldFallBackAfterCaptureFailure(captureResponse, target)
    ) {
      return captureResponse;
    }
    return withCaptureFallbackSignal(
      await triggerAndObserveFiledReturnDownload({
        activePeriod,
        artifactType,
        deps,
        scope,
        tabId,
        targetOverride: { ...target, forcePortalClick: true },
      }),
      target,
    );
  }

  const triggerFlowResponse = toTriggerFlowResponse(triggerResponse, activePeriod);
  if (!triggerFlowResponse.ok || !("flowStep" in triggerFlowResponse)) {
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
    return triggerFlowResponse;
  }

  if (!shouldAwaitDownloadObservation(triggerFlowResponse.flowStep)) {
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

export function observeFiledReturnDownload(
  context = { ...expectedDownloadForScope({ returnType: "GSTR-3B" }, "PDF"), armedAt: new Date() },
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
