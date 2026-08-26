import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsTargetReview,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { isTargetBoundPortalClickDownloadPath } from "../connectors/gst/filed-returns-download-diagnostic-compatibility";
import { observeBrowserDownloadById, type SafeDownloadObservation } from "./download-observer";
import { expectedDownloadForArtifact } from "./filed-returns-download-expectations";
import { withValidatedCapturedArtifactMime } from "./filed-returns-captured-evidence";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { cleanupSinglePeriodBundleStaging } from "./filed-returns-single-period-bundle-cleanup";
import {
  persistSinglePeriodBundleZipDownloadId,
  readSinglePeriodBundleLedgerStorageState,
  sameSinglePeriodBundleScope,
  singlePeriodBundleFlowStep,
  type SinglePeriodBundleLedger,
} from "./filed-returns-single-period-bundle-ledger";
import {
  clearFiledReturnsTargetReview,
  persistFiledReturnsTargetReview,
  readFiledReturnsTargetReview,
  responseForFiledReturnsTargetReview,
  type FiledReturnsTargetReviewDeps,
  updateFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { copyFiledReturnsDownloadDiagnosticState } from "./filed-returns-download-diagnostic-state";
import { hasPositiveFiledReturnsDownloadEvidence } from "./filed-returns-download-diagnostic-state";
import { persistCanonicalSinglePeriodCompletion } from "./filed-returns-session-summary";
import { moveFiledReturnsTargetDownloadToManualReview } from "./filed-returns-target-download-attempt";
import { SinglePeriodCleanupCheckpointError } from "../connectors/gst/single-period-cleanup-checkpoint";

const PERSISTED_DOWNLOAD_RECONCILIATION_WAIT_MS = 30_000;

export type FiledReturnsTargetDownloadReconciliation =
  { state: "retry-safe" } | { response: PackMessageResponse; state: "handled" };

export async function reconcileFiledReturnsTargetDownload(
  review: FiledReturnsTargetReview,
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsTargetDownloadReconciliation> {
  const attempt = review.downloadAttempt;
  if (!attempt) {
    return { state: "handled", response: responseForFiledReturnsTargetReview(review) };
  }
  if (attempt.phase === "download-intent-persisted") {
    return manualReviewResult(
      review,
      deps,
      "filed-returns-download-id-not-persisted",
      "Pack may have started this download, but no exact browser download ID was saved. Check browser Downloads, then cancel this target before starting again.",
      false,
    );
  }
  if (attempt.phase === "target-bound-candidate-observing") {
    return manualReviewResult(
      review,
      deps,
      "filed-returns-target-bound-candidate-window-interrupted",
      "Pack saved an exact browser download candidate, but the uniqueness window was interrupted. Check browser Downloads, then cancel this target before starting again.",
      true,
    );
  }

  let item;
  try {
    [item] = await browser.downloads.search({ id: attempt.downloadId });
  } catch {
    return manualReviewResult(
      review,
      deps,
      "filed-returns-download-search-unavailable",
      "Pack could not query the exact browser download ID. Check browser Downloads, then cancel this target before starting again.",
      true,
    );
  }
  if (!item || item.id !== attempt.downloadId) {
    return manualReviewResult(
      review,
      deps,
      "filed-returns-download-id-not-found",
      "Pack could not find the exact browser download ID. Check browser Downloads, then cancel this target before starting again.",
      true,
    );
  }
  if (!item.state || !["complete", "in_progress", "interrupted"].includes(item.state)) {
    return manualReviewResult(
      review,
      deps,
      "filed-returns-download-state-unknown",
      "The exact browser download has an unknown state. Check browser Downloads, then cancel this target before starting again.",
      true,
    );
  }

  const observation = await observeBrowserDownloadById(
    browser.downloads,
    attempt.downloadId,
    observationContext(attempt, attempt.downloadId),
    PERSISTED_DOWNLOAD_RECONCILIATION_WAIT_MS,
  );
  if (observation.state === "completed") {
    return {
      state: "handled",
      response: await completeReconciledDownload(review, observation, deps),
    };
  }
  const requiresManualReview = observation.safeSignals.some((signal) =>
    [
      "browser-download-danger-rejected",
      "browser-download-interrupted",
      "browser-download-zero-bytes",
    ].includes(signal),
  );
  if (observation.safeSignals.includes("browser-download-danger-rejected")) {
    await moveFiledReturnsTargetDownloadToManualReview(review.scope, deps);
  }
  return {
    state: "handled",
    response: await persistReconciliationReview(
      review.scope,
      observation,
      deps,
      requiresManualReview,
    ),
  };
}

async function completeReconciledDownload(
  review: FiledReturnsTargetReview,
  observation: SafeDownloadObservation,
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse> {
  const attempt = review.downloadAttempt;
  if (!attempt || attempt.phase !== "download-observing") {
    return persistCompletedEvidenceFailure(review, observation, null, null, deps);
  }
  const isZip = attempt.kind === "single-period-zip";
  const zipEvidence = isZip ? await readReconciledZipStagingEvidence(review, deps) : null;
  if (isZip && !zipEvidence) {
    return persistZipStagingEvidenceFailure(review, observation, deps);
  }
  const flowStep = reconciledCompletionStep(review, observation, zipEvidence);
  if (!flowStep) {
    return persistCompletedEvidenceFailure(review, observation, zipEvidence, null, deps);
  }
  let checkpointReview = review;
  const cleanup = zipEvidence
    ? zipEvidence.ledger
      ? await cleanupSinglePeriodBundleStaging({
          expectedLedger: zipEvidence.ledger,
          ledgerId: zipEvidence.ledger.ledgerId,
          onAfterTransientClear: async () => {
            checkpointReview = await persistReconciledZipCleanupCheckpoint(review, flowStep, deps);
            return true;
          },
          scope: review.scope,
        })
      : null
    : null;
  if (cleanup?.state === "blocked") {
    const step: PortalFlowStepResult = {
      connectorId: "gst",
      scopeId: filedReturnScopeId(review.scope.returnType),
      state: "blocked",
      safeSignals: [
        "filed-returns-download-reconciled-by-id",
        "single-period-zip-downloaded",
        ...zipEvidence!.flowStep.safeSignals,
        ...cleanup.safeSignals,
        ...observation.safeSignals,
      ],
      safeMessage:
        "Pack confirmed the selected-file ZIP by its exact browser download ID but could not clear temporary local staging.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry so Pack can clear the retained temporary staging.",
        canResume: true,
      },
      ...copyFiledReturnsDownloadDiagnosticState(zipEvidence!.flowStep),
    };
    await persistFiledReturnsTargetReview(review.scope, step, deps);
    const updatedReview = await readFiledReturnsTargetReview(review.scope, deps);
    return updatedReview
      ? responseForFiledReturnsTargetReview(updatedReview)
      : { ok: true, flowStep: step };
  }

  let durableSummary = null;
  try {
    durableSummary = await persistCanonicalSinglePeriodCompletion(
      deps.storageKeys.completion,
      review.scope,
      flowStep,
      deps.now?.() ?? new Date(),
    );
  } catch {
    durableSummary = null;
  }
  if (!durableSummary) {
    return persistCompletedEvidenceFailure(
      checkpointReview,
      observation,
      zipEvidence,
      cleanup,
      deps,
    );
  }

  let targetReviewCleared = false;
  try {
    targetReviewCleared = await clearFiledReturnsTargetReview(
      checkpointReview.scope,
      deps,
      checkpointReview.revision ?? 1,
    );
  } catch {
    targetReviewCleared = false;
  }
  if (!targetReviewCleared) {
    return persistCompletedTargetReviewCleanupFailure(checkpointReview, flowStep, cleanup, deps);
  }
  return { ok: true, flowStep: durableSummary.flowStep, flowSummary: durableSummary };
}

export async function persistReconciledZipCleanupCheckpoint(
  review: FiledReturnsTargetReview,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsTargetReview> {
  const originalAttempt = review.downloadAttempt;
  if (
    !originalAttempt ||
    originalAttempt.kind !== "single-period-zip" ||
    originalAttempt.phase !== "download-observing"
  ) {
    throw new SinglePeriodCleanupCheckpointError("bundle-mismatch");
  }
  const diagnostics = copyFiledReturnsDownloadDiagnosticState(flowStep);
  if (
    !hasPositiveFiledReturnsDownloadEvidence(
      flowStep,
      review.scope,
      flowStep.safeSignals,
      "single-period",
    )
  ) {
    throw new SinglePeriodCleanupCheckpointError("completion-evidence-missing");
  }
  const checkpointed = await updateFiledReturnsTargetReview(review.scope, deps, (currentReview) => {
    const currentAttempt = currentReview.downloadAttempt;
    if (
      (currentReview.revision ?? 1) !== (review.revision ?? 1) ||
      !currentAttempt ||
      currentAttempt.kind !== "single-period-zip" ||
      currentAttempt.phase !== "download-observing" ||
      currentAttempt.downloadId !== originalAttempt.downloadId
    ) {
      return null;
    }
    return {
      ...currentReview,
      ...diagnostics,
      safeSignals: [...flowStep.safeSignals],
      safeMessage: flowStep.safeMessage,
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
  });
  if (!checkpointed) {
    throw new SinglePeriodCleanupCheckpointError("completion-persist-failed");
  }
  const updatedReview = await readFiledReturnsTargetReview(review.scope, deps);
  const attempt = updatedReview?.downloadAttempt;
  if (
    !updatedReview ||
    !attempt ||
    attempt.kind !== "single-period-zip" ||
    attempt.phase !== "download-observing" ||
    attempt.downloadId !== originalAttempt.downloadId ||
    !updatedReview.safeSignals.includes("single-period-zip-downloaded") ||
    !updatedReview.safeSignals.includes("single-period-opfs-cleared")
  ) {
    throw new SinglePeriodCleanupCheckpointError("completion-mismatch");
  }
  return updatedReview;
}

interface ReconciledZipStagingEvidence {
  flowStep: PortalFlowStepResult;
  ledger: SinglePeriodBundleLedger | null;
}

async function readReconciledZipStagingEvidence(
  review: FiledReturnsTargetReview,
  deps: FiledReturnsTargetReviewDeps,
): Promise<ReconciledZipStagingEvidence | null> {
  const attempt = review.downloadAttempt;
  if (!attempt || attempt.kind !== "single-period-zip" || attempt.phase !== "download-observing") {
    return null;
  }
  let storageState;
  try {
    storageState = await readSinglePeriodBundleLedgerStorageState();
  } catch {
    return null;
  }
  if (storageState.state === "missing") {
    if (
      !review.safeSignals.includes("single-period-zip-downloaded") ||
      !review.safeSignals.includes("single-period-opfs-cleared") ||
      !hasPositiveFiledReturnsDownloadEvidence(
        review,
        review.scope,
        review.safeSignals,
        "single-period",
      )
    ) {
      return null;
    }
    const recoveredSafeSignals = review.safeSignals.filter(
      (signal) => signal !== "filed-return-durable-status-rejected",
    );
    return {
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId(review.scope.returnType),
        state: "downloaded",
        safeSignals: recoveredSafeSignals,
        safeMessage: "Pack recovered the verified selected-file ZIP cleanup checkpoint.",
        ...copyFiledReturnsDownloadDiagnosticState(review),
      },
      ledger: null,
    };
  }
  if (storageState.state !== "valid") return null;
  let ledger = storageState.ledger;
  if (
    ledger.ledgerId !== attempt.stagingLedgerId ||
    !sameSinglePeriodBundleScope(ledger.scope, review.scope) ||
    ledger.zipDownloadAttempt?.requestedAt !== attempt.requestedAt
  ) {
    return null;
  }
  if (ledger.phase === "zip-intent-persisted") {
    const repairedLedger = await persistSinglePeriodBundleZipDownloadId(
      ledger,
      attempt.downloadId,
      deps.now?.() ?? new Date(),
    );
    if (!repairedLedger) return null;
    ledger = repairedLedger;
  }
  if (
    !["zip-observing", "cleanup-pending"].includes(ledger.phase) ||
    ledger.zipDownloadAttempt?.downloadId !== attempt.downloadId ||
    ledger.zipDownloadAttempt.requestedAt !== attempt.requestedAt
  ) {
    return null;
  }
  const flowStep = singlePeriodBundleFlowStep(ledger);
  if (
    !flowStep ||
    !hasPositiveFiledReturnsDownloadEvidence(
      flowStep,
      review.scope,
      flowStep.safeSignals,
      "single-period",
    )
  ) {
    return null;
  }
  return { flowStep, ledger };
}

function reconciledCompletionStep(
  review: FiledReturnsTargetReview,
  observation: SafeDownloadObservation,
  zipEvidence: ReconciledZipStagingEvidence | null,
): PortalFlowStepResult | null {
  const attempt = review.downloadAttempt;
  if (!attempt || attempt.phase !== "download-observing" || observation.state !== "completed") {
    return null;
  }
  if (attempt.kind === "single-period-zip") {
    if (!zipEvidence || observation.safeEvidence?.downloadId !== attempt.downloadId) return null;
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId(review.scope.returnType),
      state: "downloaded",
      safeSignals: Array.from(
        new Set([
          ...zipEvidence.flowStep.safeSignals,
          "filed-returns-download-reconciled-by-id",
          "single-period-zip-downloaded",
          "single-period-opfs-cleared",
          ...observation.safeSignals,
        ]),
      ),
      safeMessage:
        "Pack confirmed the selected-file ZIP by its exact browser download ID and cleared temporary staging.",
      ...copyFiledReturnsDownloadDiagnosticState(zipEvidence.flowStep),
    };
  }
  const targetBoundPortalClick = Boolean(
    review.downloadDiagnostic &&
    isTargetBoundPortalClickDownloadPath(review.downloadDiagnostic.downloadPathClass),
  );
  const directDownload = attempt.directDownload === true;
  const safeEvidence =
    targetBoundPortalClick || directDownload
      ? observation.safeEvidence
      : withValidatedCapturedArtifactMime(observation.safeEvidence, attempt.artifactType);
  if (safeEvidence?.downloadId !== attempt.downloadId) return null;
  if (
    targetBoundPortalClick &&
    (review.scope.returnType !== "GSTR-3B" ||
      attempt.artifactType !== "PDF" ||
      safeEvidence.urlClass !== "blob" ||
      safeEvidence.mimeClass !== "pdf")
  ) {
    return null;
  }
  if (
    directDownload &&
    (review.scope.returnType !== "GSTR-3B" ||
      attempt.artifactType !== "PDF" ||
      safeEvidence.urlClass !== "https" ||
      safeEvidence.mimeClass !== "pdf" ||
      safeEvidence.byteCountClass !== "non-empty")
  ) {
    return null;
  }
  return withFiledReturnsDownloadDiagnostic({
    attemptClass: targetBoundPortalClick
      ? "target-bound-portal-click"
      : directDownload
        ? "extension-direct"
        : "captured-portal-request",
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId(review.scope.returnType),
      state: "downloaded",
      safeSignals: [
        "filed-returns-download-reconciled-by-id",
        `filed-return-artifact-downloaded:${attempt.artifactType}`,
        ...observation.safeSignals,
      ],
      safeMessage: "Pack confirmed the filed-return download by its exact browser download ID.",
    },
    safeEvidence,
    target: {
      actionId: attempt.actionId,
      artifactType: attempt.artifactType,
      financialYear: review.scope.financialYear,
      period: review.scope.period,
      returnType: review.scope.returnType,
    },
  });
}

async function persistZipStagingEvidenceFailure(
  review: FiledReturnsTargetReview,
  observation: SafeDownloadObservation,
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse> {
  const step: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(review.scope.returnType),
    state: "blocked",
    safeSignals: [
      "filed-returns-download-reconciled-by-id",
      "single-period-bundle-ledger-malformed",
      "single-period-opfs-retained",
      ...observation.safeSignals,
    ],
    safeMessage:
      "Pack confirmed the selected-file ZIP download, but its exact staged artifact evidence was missing or mismatched. Temporary staging was retained for review.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Review or cancel this selected-file target before starting another download.",
      canResume: true,
    },
  };
  await persistFiledReturnsTargetReview(review.scope, step, deps);
  const updatedReview = await readFiledReturnsTargetReview(review.scope, deps);
  return updatedReview
    ? responseForFiledReturnsTargetReview(updatedReview)
    : { ok: true, flowStep: step };
}

async function persistCompletedEvidenceFailure(
  review: FiledReturnsTargetReview,
  observation: SafeDownloadObservation,
  zipEvidence: ReconciledZipStagingEvidence | null,
  cleanup: Awaited<ReturnType<typeof cleanupSinglePeriodBundleStaging>> | null,
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse> {
  const step: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(review.scope.returnType),
    state: "blocked",
    safeSignals: Array.from(
      new Set([
        "filed-returns-download-reconciled-by-id",
        "filed-return-durable-status-rejected",
        ...review.safeSignals,
        ...(zipEvidence?.flowStep.safeSignals ?? []),
        ...(cleanup?.safeSignals ?? []),
        ...observation.safeSignals,
      ]),
    ),
    safeMessage:
      "Pack confirmed the exact browser download but could not reconstruct canonical target-bound completion evidence.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Review or cancel this target before starting another download.",
      canResume: true,
    },
    ...copyFiledReturnsDownloadDiagnosticState(zipEvidence?.flowStep ?? review),
  };
  await persistFiledReturnsTargetReview(review.scope, step, deps);
  const updatedReview = await readFiledReturnsTargetReview(review.scope, deps);
  return updatedReview
    ? responseForFiledReturnsTargetReview(updatedReview)
    : { ok: true, flowStep: step };
}

async function persistCompletedTargetReviewCleanupFailure(
  review: FiledReturnsTargetReview,
  verifiedCompletionStep: PortalFlowStepResult,
  cleanup: Awaited<ReturnType<typeof cleanupSinglePeriodBundleStaging>> | null,
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse> {
  const step: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(review.scope.returnType),
    state: "download-unconfirmed",
    safeSignals: Array.from(
      new Set([
        ...verifiedCompletionStep.safeSignals,
        "filed-returns-target-review-clear-failed",
        ...(review.downloadAttempt?.kind === "single-period-zip"
          ? ["single-period-cleanup-checkpoint-failed"]
          : []),
        ...(cleanup?.safeSignals ?? []),
      ]),
    ),
    safeMessage:
      "Pack verified the exact browser download but could not clear its durable target recovery checkpoint.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry so Pack can reconcile the saved target recovery checkpoint.",
      canResume: true,
    },
    ...copyFiledReturnsDownloadDiagnosticState(verifiedCompletionStep),
  };
  await persistFiledReturnsTargetReview(review.scope, step, deps);
  const updatedReview = await readFiledReturnsTargetReview(review.scope, deps);
  return updatedReview
    ? responseForFiledReturnsTargetReview(updatedReview)
    : { ok: true, flowStep: step };
}

async function persistReconciliationReview(
  scope: FiledReturnsDownloadScope,
  observation: SafeDownloadObservation,
  deps: FiledReturnsTargetReviewDeps,
  manualReview: boolean,
): Promise<PackMessageResponse> {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    // Every unconfirmed terminal outcome must enter the durable review record;
    // `blocked` alone is not admitted by the target-review persistence gate.
    state: "download-unconfirmed",
    safeSignals: [
      "filed-returns-download-reconciled-by-id",
      ...(manualReview ? ["filed-returns-download-manual-review-required"] : []),
      ...observation.safeSignals,
    ],
    safeMessage: observation.safeMessage,
    ...(observation.userAction ? { userAction: observation.userAction } : {}),
  };
  await persistFiledReturnsTargetReview(scope, flowStep, deps);
  const updatedReview = await readFiledReturnsTargetReview(scope, deps);
  return updatedReview
    ? responseForFiledReturnsTargetReview(updatedReview)
    : { ok: true, flowStep };
}

async function manualReviewResult(
  review: FiledReturnsTargetReview,
  deps: FiledReturnsTargetReviewDeps,
  signal: string,
  safeMessage: string,
  removeDownloadId: boolean,
): Promise<FiledReturnsTargetDownloadReconciliation> {
  if (removeDownloadId) {
    await moveFiledReturnsTargetDownloadToManualReview(review.scope, deps);
  }
  const step: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(review.scope.returnType),
    state: "download-unconfirmed",
    safeSignals: [signal, "filed-returns-download-manual-review-required"],
    safeMessage,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Check browser Downloads, then cancel this target before starting again.",
      canResume: true,
    },
  };
  await persistFiledReturnsTargetReview(review.scope, step, deps);
  const updatedReview = await readFiledReturnsTargetReview(review.scope, deps);
  return {
    state: "handled",
    response: updatedReview
      ? responseForFiledReturnsTargetReview(updatedReview)
      : { ok: true, flowStep: step },
  };
}

function observationContext(
  attempt: NonNullable<FiledReturnsTargetReview["downloadAttempt"]>,
  downloadId: number,
) {
  const common = {
    armedAt: new Date(attempt.requestedAt),
    trustedDownloadIds: new Set([downloadId]),
  };
  if (attempt.kind === "single-period-zip") {
    return {
      ...common,
      expectedFileExtensions: [".zip"],
      expectedMimeTypes: ["application/zip", "application/octet-stream"],
    };
  }
  return {
    ...expectedDownloadForArtifact(attempt.artifactType),
    ...(attempt.directDownload ? { requireExpectedMime: true } : {}),
    ...common,
  };
}
