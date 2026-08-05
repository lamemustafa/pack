import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetDownloadAttempt,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  persistFiledReturnsTargetReview,
  type FiledReturnsTargetReviewDeps,
  updateFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { toManualReviewDownloadAttempt } from "./filed-returns-target-download-attempt-validation";
import {
  copyFiledReturnsDownloadDiagnosticState,
  mergeFiledReturnsDownloadDiagnosticState,
} from "./filed-returns-download-diagnostic-state";

type DownloadIntent = Extract<
  FiledReturnsTargetDownloadAttempt,
  { phase: "download-intent-persisted" }
>;

export async function persistFiledReturnsTargetDownloadIntent(
  scope: FiledReturnsDownloadScope,
  intent: DownloadIntent,
  deps: FiledReturnsTargetReviewDeps,
  diagnosticSource?: PortalFlowStepResult,
): Promise<boolean> {
  const summary = await persistFiledReturnsTargetReview(
    scope,
    {
      ...intentStep(scope, intent),
      ...copyFiledReturnsDownloadDiagnosticState(diagnosticSource ?? {}),
    },
    deps,
    { downloadAttempt: intent },
  );
  return summary !== null;
}

export async function persistFiledReturnsTargetDownloadId(
  scope: FiledReturnsDownloadScope,
  downloadId: number,
  deps: FiledReturnsTargetReviewDeps,
  diagnosticSource?: PortalFlowStepResult,
): Promise<boolean> {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) return false;
  return updateFiledReturnsTargetReview(scope, deps, (review) => {
    const intent = review.downloadAttempt;
    if (!intent) return null;
    if (intent.phase === "download-observing") {
      return intent.downloadId === downloadId ? review : null;
    }
    if (intent.phase !== "download-intent-persisted") return null;
    const diagnosticState = diagnosticSource
      ? mergeFiledReturnsDownloadDiagnosticState(review, diagnosticSource, scope)
      : review.downloadDiagnostic || review.downloadDiagnostics
        ? copyFiledReturnsDownloadDiagnosticState(review)
        : {};
    if (!diagnosticState) return null;
    return {
      ...review,
      ...diagnosticState,
      downloadAttempt: { ...intent, downloadId, phase: "download-observing" },
    };
  });
}

export async function persistTargetBoundPortalCandidateDownloadId(
  scope: FiledReturnsDownloadScope,
  downloadId: number,
  candidateWindowEndsAt: Date,
  deps: FiledReturnsTargetReviewDeps,
  diagnosticSource?: PortalFlowStepResult,
): Promise<boolean> {
  if (
    !Number.isSafeInteger(downloadId) ||
    downloadId < 0 ||
    !Number.isFinite(candidateWindowEndsAt.getTime())
  ) {
    return false;
  }
  return updateFiledReturnsTargetReview(scope, deps, (review) => {
    const intent = review.downloadAttempt;
    if (
      !intent ||
      intent.kind !== "single-artifact" ||
      intent.phase !== "download-intent-persisted"
    ) {
      return null;
    }
    const diagnosticState = diagnosticSource
      ? mergeFiledReturnsDownloadDiagnosticState(review, diagnosticSource, scope)
      : copyFiledReturnsDownloadDiagnosticState(review);
    if (!diagnosticState) return null;
    return {
      ...review,
      ...diagnosticState,
      downloadAttempt: {
        ...intent,
        candidateWindowEndsAt: candidateWindowEndsAt.toISOString(),
        downloadId,
        phase: "target-bound-candidate-observing",
      },
    };
  });
}

export async function confirmTargetBoundPortalCandidateDownloadId(
  scope: FiledReturnsDownloadScope,
  downloadId: number,
  candidateWindowEndsAt: Date,
  deps: FiledReturnsTargetReviewDeps,
  diagnosticSource: PortalFlowStepResult,
): Promise<boolean> {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) return false;
  const expectedWindowEndsAt = candidateWindowEndsAt.toISOString();
  return updateFiledReturnsTargetReview(scope, deps, (review) => {
    const candidate = review.downloadAttempt;
    if (
      !candidate ||
      candidate.kind !== "single-artifact" ||
      candidate.phase !== "target-bound-candidate-observing" ||
      candidate.downloadId !== downloadId ||
      candidate.candidateWindowEndsAt !== expectedWindowEndsAt
    ) {
      return null;
    }
    const diagnosticState = mergeFiledReturnsDownloadDiagnosticState(
      review,
      diagnosticSource,
      scope,
    );
    if (!diagnosticState) return null;
    return {
      ...review,
      ...diagnosticState,
      downloadAttempt: {
        actionId: candidate.actionId,
        artifactType: candidate.artifactType,
        downloadId: candidate.downloadId,
        kind: "single-artifact",
        phase: "download-observing",
        requestedAt: candidate.requestedAt,
      },
    };
  });
}

export async function clearFiledReturnsTargetDownloadAttempt(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<boolean> {
  return updateFiledReturnsTargetReview(scope, deps, (review) => {
    if (!review.downloadAttempt) return null;
    const nextReview = { ...review };
    delete nextReview.downloadAttempt;
    return nextReview;
  });
}

export async function moveFiledReturnsTargetDownloadToManualReview(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<boolean> {
  return updateFiledReturnsTargetReview(scope, deps, (review) => {
    if (!review.downloadAttempt) return null;
    return {
      ...review,
      ...withoutDownloadIds(review),
      downloadAttempt: toManualReviewDownloadAttempt(review.downloadAttempt),
    };
  });
}

function withoutDownloadIds(review: {
  downloadDiagnostic?: NonNullable<PortalFlowStepResult["downloadDiagnostic"]>;
  downloadDiagnostics?: NonNullable<PortalFlowStepResult["downloadDiagnostics"]>;
}) {
  const withoutId = (diagnostic: NonNullable<PortalFlowStepResult["downloadDiagnostic"]>) => {
    const copy = { ...diagnostic };
    delete copy.downloadId;
    return copy;
  };
  return {
    ...(review.downloadDiagnostic
      ? { downloadDiagnostic: withoutId(review.downloadDiagnostic) }
      : {}),
    ...(review.downloadDiagnostics
      ? { downloadDiagnostics: review.downloadDiagnostics.map(withoutId) }
      : {}),
  };
}

function intentStep(
  scope: FiledReturnsDownloadScope,
  intent: DownloadIntent,
): PortalFlowStepResult {
  const isZip = intent.kind === "single-period-zip";
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "download-unconfirmed",
    safeSignals: [
      "filed-returns-download-intent-persisted",
      isZip ? "single-period-opfs-retained" : "filed-return-download-recovery-checkpoint",
    ],
    safeMessage: isZip
      ? "Pack saved a recovery checkpoint before starting the selected-file ZIP download."
      : "Pack saved a recovery checkpoint before starting the target-bound filed-return download action.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Check browser Downloads before retrying this target.",
      canResume: true,
    },
  };
}
