import type {
  BrowserDownloadSafeEvidence,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import {
  mergeFlowStepWithDownloadObservation,
  type SafeDownloadObservation,
} from "./download-observer";
import { withValidatedCapturedArtifactMime } from "./filed-returns-captured-evidence";
import {
  type DownloadAttemptClass,
  withFiledReturnsDownloadDiagnostic,
} from "./filed-returns-download-diagnostics";
import {
  targetReviewScope,
  withArtifactDownloadMessage,
  withDownloadedArtifactSignal,
} from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import {
  clearFiledReturnsTargetReview,
  persistFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { persistCanonicalSinglePeriodCompletion } from "./filed-returns-session-summary";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";

export async function finalizeObservedSingleArtifactDownload({
  activePeriod,
  artifactType,
  attemptClass,
  deps,
  observedDownload,
  pendingSafeEvidence,
  scope,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  attemptClass: Extract<
    DownloadAttemptClass,
    "captured-portal-request" | "extension-direct" | "target-bound-portal-click"
  >;
  deps: FiledReturnsFlowMessagingDeps;
  observedDownload: SafeDownloadObservation;
  pendingSafeEvidence?: BrowserDownloadSafeEvidence | undefined;
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): Promise<PackMessageResponse> {
  const safeEvidence =
    attemptClass === "captured-portal-request"
      ? withValidatedCapturedArtifactMime(observedDownload.safeEvidence, artifactType)
      : (observedDownload.safeEvidence ??
        validPendingTargetBoundEvidence(pendingSafeEvidence, artifactType, target));
  const flowStep = withFiledReturnsDownloadDiagnostic({
    attemptClass,
    flowStep: withArtifactDownloadMessage(
      withDownloadedArtifactSignal(
        mergeFlowStepWithDownloadObservation(
          {
            ...triggerStep,
            safeSignals: Array.from(
              new Set([
                ...triggerStep.safeSignals,
                ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
              ]),
            ),
          },
          observedDownload,
        ),
        artifactType,
      ),
      scope,
      artifactType,
    ),
    safeEvidence,
    target,
  });

  if (deps.persistTargetReview === false) return { ok: true, flowStep };

  const reviewScope = targetReviewScope(scope, artifactType);
  const checkpointDeps = {
    ...deps,
    storageKeys: {
      ...deps.storageKeys,
      targetReview: deps.storageKeys.targetReview ?? PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  };
  let flowSummary: FiledReturnsFlowSummary | null = null;
  if (flowStep.state === "downloaded") {
    flowSummary = await persistCanonicalSinglePeriodCompletion(
      checkpointDeps.storageKeys.completion,
      reviewScope,
      flowStep,
      deps.now?.() ?? new Date(),
    );
    if (!flowSummary) {
      const unconfirmedStep = durableCompletionFailureStep(flowStep);
      flowSummary = await persistFiledReturnsTargetReview(
        reviewScope,
        unconfirmedStep,
        checkpointDeps,
      );
      return { ok: true, flowStep: unconfirmedStep, ...(flowSummary ? { flowSummary } : {}) };
    }
    try {
      const reviewCleared = await clearFiledReturnsTargetReview(reviewScope, checkpointDeps);
      if (!reviewCleared) throw new Error("target-review cleanup rejected");
    } catch {
      const unconfirmedStep = targetReviewCleanupFailureStep(flowStep);
      flowSummary = await persistFiledReturnsTargetReview(
        reviewScope,
        unconfirmedStep,
        checkpointDeps,
      );
      return { ok: true, flowStep: unconfirmedStep, ...(flowSummary ? { flowSummary } : {}) };
    }
  } else {
    flowSummary = await persistFiledReturnsTargetReview(reviewScope, flowStep, checkpointDeps);
  }
  return { ok: true, flowStep, ...(flowSummary ? { flowSummary } : {}) };
}

function validPendingTargetBoundEvidence(
  evidence: BrowserDownloadSafeEvidence | undefined,
  artifactType: FiledReturnsConcreteArtifactType,
  target: FiledReturnsDownloadTarget,
): BrowserDownloadSafeEvidence | undefined {
  return evidence &&
    target.returnType === "GSTR-3B" &&
    artifactType === "PDF" &&
    target.artifactType === "PDF" &&
    Number.isSafeInteger(evidence.downloadId) &&
    Number(evidence.downloadId) >= 0 &&
    evidence.urlClass === "blob" &&
    evidence.mimeClass === "pdf" &&
    evidence.byteCountClass === "unknown"
    ? evidence
    : undefined;
}

function durableCompletionFailureStep(flowStep: PortalFlowStepResult): PortalFlowStepResult {
  return {
    ...flowStep,
    state: "download-unconfirmed",
    safeSignals: [...flowStep.safeSignals, "filed-return-durable-status-rejected"],
    safeMessage:
      "Pack confirmed the browser download but could not save its canonical completion checkpoint. The exact download ID remains available for recovery.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry so Pack can reconcile the saved browser download ID.",
      canResume: true,
    },
  };
}

function targetReviewCleanupFailureStep(flowStep: PortalFlowStepResult): PortalFlowStepResult {
  return {
    ...flowStep,
    state: "download-unconfirmed",
    safeSignals: [...flowStep.safeSignals, "filed-returns-target-review-clear-failed"],
    safeMessage:
      "Pack confirmed the browser download but could not clear its local recovery checkpoint. Retry this target so Pack can reconcile the exact download ID.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry so Pack can reconcile and clear the saved browser download ID.",
      canResume: true,
    },
  };
}
