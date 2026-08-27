import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsTargetDownloadAttempt,
  FiledReturnsTargetReview,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  normaliseFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  clearArtifactAcquisitionCheckpoints,
  clearArtifactAcquisitionCheckpointsAfterPersistedSummary,
  clearMalformedArtifactAcquisitionCheckpoint,
  inspectArtifactAcquisitionCheckpoint,
  type ArtifactAcquisitionCompletionEvidence,
} from "./artifact-acquisition-state";
import { persistArtifactAcquisitionCompletion } from "./filed-returns-artifact-acquisition-completion";
import type { PackMessageResponse } from "../connectors/gst/messages";
import {
  canonicalDurableTargetStatus,
  hasConfirmedSinglePeriodZipDownloadEvidence,
  parseDurableFiledReturnsScope,
  parseDurableTargetStatus,
} from "../connectors/gst/filed-returns-durable-status";
import { isFullFiscalYearScope } from "../connectors/gst/filed-returns-scope";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { isCanonicalSinglePeriodLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import { readSinglePeriodStagingRecord } from "./filed-returns-artifact-progress";
import { isFiledReturnsTargetDownloadAttempt } from "./filed-returns-target-download-attempt-validation";
import {
  copyFiledReturnsDownloadDiagnosticState,
  isValidFiledReturnsDownloadDiagnosticState,
  mergeFiledReturnsDownloadDiagnosticState,
} from "./filed-returns-download-diagnostic-state";
import {
  persistCanonicalFiledReturnsFlowSummary,
  readCanonicalFiledReturnsFlowSummary,
} from "./filed-returns-session-summary";
import { parseArtifactAcquisitionCompletion } from "./filed-returns-durable-summary";
import {
  cleanupSinglePeriodBundleStaging,
  type SinglePeriodBundleCleanupResult,
} from "./filed-returns-single-period-bundle-cleanup";
import {
  readSinglePeriodBundleLedgerStorageState,
  sameSinglePeriodBundleScope,
  type SinglePeriodBundleLedger,
} from "./filed-returns-single-period-bundle-ledger";

export interface FiledReturnsTargetReviewDeps {
  storageKeys: {
    completion?: string;
    targetReview?: string;
  };
  now?: () => Date;
}

export type FiledReturnsTargetReviewStorageState =
  | { state: "missing" }
  | { state: "malformed" }
  | { review: FiledReturnsTargetReview; state: "valid" };

interface PersistFiledReturnsTargetReviewOptions {
  artifactAcquisitionMalformedCheckpointReference?: string;
  downloadAttempt?: FiledReturnsTargetDownloadAttempt;
  singlePeriodBundleCheckpoint?: NonNullable<
    FiledReturnsTargetReview["singlePeriodBundleCheckpoint"]
  >;
}

let targetReviewMutationCriticalSection = Promise.resolve();

const MALFORMED_TARGET_REVIEW_SENTINEL = {
  schemaVersion: "1.0",
  state: "malformed",
} as const;

export async function readFiledReturnsTargetReview(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsTargetReview | null> {
  const key = deps.storageKeys.targetReview;
  if (!key) return null;

  const state = await readCanonicalTargetReviewStorageStateByKey(key);
  return state.state === "valid" && sameFiledReturnsScope(state.review.scope, scope)
    ? state.review
    : null;
}

export async function readCurrentFiledReturnsTargetReview(
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsTargetReview | null> {
  const state = await readCurrentFiledReturnsTargetReviewStorageState(deps);
  return state.state === "valid" ? state.review : null;
}

export async function readCurrentFiledReturnsTargetReviewStorageState(
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsTargetReviewStorageState> {
  const key = deps.storageKeys.targetReview;
  if (!key) return { state: "missing" };
  return readCanonicalTargetReviewStorageStateByKey(key);
}

export async function readCurrentFiledReturnsTargetReviewSummary(
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const review = await readCurrentFiledReturnsTargetReview(deps);
  return review ? toTargetReviewSummary(review) : null;
}

export function responseForFiledReturnsTargetReview(
  review: FiledReturnsTargetReview,
): PackMessageResponse {
  const flowStep = targetReviewStep(review);
  return {
    ok: true,
    flowStep,
    flowSummary: toTargetReviewSummary(review, flowStep),
  };
}

export async function persistFiledReturnsTargetReview(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsTargetReviewDeps,
  options: PersistFiledReturnsTargetReviewOptions = {},
): Promise<FiledReturnsFlowSummary | null> {
  const key = deps.storageKeys.targetReview;
  if (!key || !requiresTargetReview(flowStep)) return null;

  return runTargetReviewMutationCriticalSection(async () => {
    const state = await readTargetReviewStorageStateByKey(key);
    if (state.state === "malformed") return null;
    if (state.state === "valid" && !sameFiledReturnsScope(state.review.scope, scope)) return null;

    const existingReview = state.state === "valid" ? state.review : null;
    const diagnosticState = mergeFiledReturnsDownloadDiagnosticState(
      existingReview ?? {},
      flowStep,
      scope,
    );
    const diagnosticsRejected = diagnosticState === null;
    const durableStatus = canonicalDurableTargetStatus(
      scope,
      "target-review",
      diagnosticsRejected
        ? uniqueSafeSignals([...flowStep.safeSignals, "filed-return-download-diagnostics-rejected"])
        : flowStep.safeSignals,
    );
    const malformedCheckpointReference = durableStatus.safeSignals.includes(
      "artifact-acquisition-checkpoint-malformed",
    )
      ? (options.artifactAcquisitionMalformedCheckpointReference ??
        existingReview?.artifactAcquisitionMalformedCheckpointReference)
      : undefined;
    const review = {
      ...(malformedCheckpointReference
        ? {
            artifactAcquisitionMalformedCheckpointReference: malformedCheckpointReference,
          }
        : {}),
      ...(options.downloadAttempt
        ? { downloadAttempt: options.downloadAttempt }
        : existingReview?.downloadAttempt
          ? { downloadAttempt: existingReview.downloadAttempt }
          : {}),
      ...(options.singlePeriodBundleCheckpoint
        ? { singlePeriodBundleCheckpoint: options.singlePeriodBundleCheckpoint }
        : existingReview?.singlePeriodBundleCheckpoint
          ? { singlePeriodBundleCheckpoint: existingReview.singlePeriodBundleCheckpoint }
          : {}),
      ...(diagnosticState ?? copyFiledReturnsDownloadDiagnosticState(existingReview ?? {})),
      revision: nextTargetReviewRevision(existingReview),
      schemaVersion: "1.0",
      targetId: createTargetId(scope),
      status: "download-unconfirmed",
      scope: canonicalTargetReviewScope(scope),
      ...durableStatus,
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    } satisfies FiledReturnsTargetReview;
    const parsedReview = parseFiledReturnsTargetReview(review);
    if (!parsedReview) return null;
    await browser.storage.local.set({ [key]: parsedReview });
    return toTargetReviewSummary(parsedReview);
  });
}

export async function replaceFiledReturnsTargetReview(
  review: FiledReturnsTargetReview,
  deps: FiledReturnsTargetReviewDeps,
): Promise<boolean> {
  const key = deps.storageKeys.targetReview;
  if (!key) return false;
  return runTargetReviewMutationCriticalSection(async () => {
    const state = await readTargetReviewStorageStateByKey(key);
    if (state.state !== "valid") return false;
    if (
      state.review.targetId !== review.targetId ||
      targetReviewRevision(state.review) !== targetReviewRevision(review) ||
      !sameFiledReturnsScope(state.review.scope, review.scope)
    ) {
      return false;
    }
    const nextReview = {
      ...review,
      revision: targetReviewRevision(state.review) + 1,
    } satisfies FiledReturnsTargetReview;
    const parsedReview = parseFiledReturnsTargetReview(nextReview);
    if (!parsedReview) return false;
    await browser.storage.local.set({ [key]: parsedReview });
    return true;
  });
}

export async function updateFiledReturnsTargetReview(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
  update: (review: FiledReturnsTargetReview) => FiledReturnsTargetReview | null,
): Promise<boolean> {
  const key = deps.storageKeys.targetReview;
  if (!key) return false;
  return runTargetReviewMutationCriticalSection(async () => {
    const state = await readTargetReviewStorageStateByKey(key);
    if (state.state !== "valid" || !sameFiledReturnsScope(state.review.scope, scope)) return false;
    const updated = update(state.review);
    if (
      !updated ||
      updated.targetId !== state.review.targetId ||
      !sameFiledReturnsScope(updated.scope, state.review.scope)
    ) {
      return false;
    }
    const nextReview = {
      ...updated,
      revision: targetReviewRevision(state.review) + 1,
    } satisfies FiledReturnsTargetReview;
    const parsedReview = parseFiledReturnsTargetReview(nextReview);
    if (!parsedReview) return false;
    await browser.storage.local.set({ [key]: parsedReview });
    return true;
  });
}

export async function clearFiledReturnsTargetReview(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
  expectedRevision?: number,
): Promise<boolean> {
  const key = deps.storageKeys.targetReview;
  if (!key) return false;
  if (
    expectedRevision !== undefined &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 10_000)
  ) {
    return false;
  }

  return runTargetReviewMutationCriticalSection(async () => {
    const state = await readTargetReviewStorageStateByKey(key);
    if (state.state !== "valid" || !sameFiledReturnsScope(state.review.scope, scope)) return false;
    if (expectedRevision !== undefined && targetReviewRevision(state.review) !== expectedRevision) {
      return false;
    }
    await browser.storage.local.remove(key);
    return true;
  });
}

/**
 * Marks a matching local review before session-only completion persistence can
 * clear its checkpoint. The local review outlives session storage, so it must
 * never remain able to contradict a completion the session record has proved.
 */
async function markTargetReviewArtifactAcquisitionCompletion(
  scope: FiledReturnsDownloadScope,
  evidence: readonly ArtifactAcquisitionCompletionEvidence[],
  deps: FiledReturnsTargetReviewDeps,
): Promise<
  { state: "absent" } | { review: FiledReturnsTargetReview; state: "marked" } | { state: "blocked" }
> {
  const key = deps.storageKeys.targetReview;
  if (!key) return { state: "absent" };
  const storageState = await readTargetReviewStorageStateByKey(key);
  if (storageState.state === "missing") return { state: "absent" };
  if (storageState.state === "malformed") return { state: "blocked" };
  // This single local record is already protecting a different target. It
  // cannot carry this target's completion proof, so the caller must retain
  // the matching active lease and session checkpoint rather than creating a
  // transition window with no durable B-scope guard.
  if (!sameFiledReturnsScope(storageState.review.scope, scope)) return { state: "blocked" };
  const markedReview = {
    ...storageState.review,
    artifactAcquisitionCompletion: evidence.map(({ artifactType, downloadId, requestId }) => ({
      artifactType,
      downloadId,
      requestId,
    })),
    revision: targetReviewRevision(storageState.review) + 1,
    safeSignals: uniqueSafeSignals([
      ...storageState.review.safeSignals,
      "artifact-acquisition-completion-pending-summary",
    ]),
    updatedAt: (deps.now?.() ?? new Date()).toISOString(),
  } satisfies FiledReturnsTargetReview;
  const parsedReview = parseFiledReturnsTargetReview(markedReview);
  if (!parsedReview) return { state: "blocked" };
  await browser.storage.local.set({ [key]: parsedReview });
  return { review: parsedReview, state: "marked" };
}

export async function markFiledReturnsTargetReviewArtifactAcquisitionCompletion(
  scope: FiledReturnsDownloadScope,
  evidence: readonly ArtifactAcquisitionCompletionEvidence[],
  deps: FiledReturnsTargetReviewDeps,
): Promise<
  { state: "absent" } | { review: FiledReturnsTargetReview; state: "marked" } | { state: "blocked" }
> {
  return runTargetReviewMutationCriticalSection(() =>
    markTargetReviewArtifactAcquisitionCompletion(scope, evidence, deps),
  );
}

/** Reconciles one exact completed artifact checkpoint without repeating its portal click. */
export async function reconcileRetainedArtifactAcquisition(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse | null> {
  const key = deps.storageKeys.targetReview;
  if (!key) return null;
  return runTargetReviewMutationCriticalSection(async () => {
    const state = await readTargetReviewStorageStateByKey(key);
    if (
      state.state !== "valid" ||
      !sameFiledReturnsScope(state.review.scope, scope) ||
      !hasArtifactAcquisitionRecoverySignal(state.review.safeSignals)
    ) {
      return null;
    }
    const review = state.review;
    const artifacts = concreteFiledReturnsArtifactTypesForSelection(
      scope.returnType,
      scope.artifactType,
    );
    // Selected-file ZIPs are not proof of their independent component files.
    // New recovery reviews are always concrete; retain legacy composite reviews
    // for explicit cancellation rather than claiming their aggregate complete.
    if (artifacts.length !== 1) return responseForFiledReturnsTargetReview(review);
    const [artifactType] = artifacts;
    if (!artifactType) return responseForFiledReturnsTargetReview(review);

    const inspection = await inspectArtifactAcquisitionCheckpoint({
      ...scope,
      artifactType,
    });
    const evidence =
      inspection.state === "completed"
        ? [inspection.evidence]
        : inspection.state === "retry-safe"
          ? review.artifactAcquisitionCompletion
          : undefined;
    if (!evidence) {
      if (inspection.state !== "retry-safe" || review.artifactAcquisitionCompletion) {
        return responseForFiledReturnsTargetReview(review);
      }
      if (review.safeSignals.includes("artifact-acquisition-session-proof-expired")) {
        return responseForFiledReturnsTargetReview(review);
      }
      // Chrome clears storage.session when an extension is reloaded, while the
      // local review deliberately survives. The exact browser download ID is
      // session-only, so a later retry cannot safely recreate the correlation.
      // Surface that boundary instead of offering a reconciliation action that
      // can only return this same review.
      const expiredProofReview: FiledReturnsTargetReview = {
        ...review,
        revision: targetReviewRevision(review) + 1,
        safeSignals: uniqueSafeSignals([
          ...review.safeSignals,
          "artifact-acquisition-session-proof-expired",
        ]),
        updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      };
      const parsedExpiredProofReview = parseFiledReturnsTargetReview(expiredProofReview);
      if (!parsedExpiredProofReview) return responseForFiledReturnsTargetReview(review);
      await browser.storage.local.set({ [key]: parsedExpiredProofReview });
      return responseForFiledReturnsTargetReview(parsedExpiredProofReview);
    }

    let completionReview = review;
    if (inspection.state === "completed") {
      const markedReview: FiledReturnsTargetReview = {
        ...review,
        artifactAcquisitionCompletion: evidence,
        revision: targetReviewRevision(review) + 1,
        updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      };
      const parsedMarkedReview = parseFiledReturnsTargetReview(markedReview);
      if (!parsedMarkedReview) return responseForFiledReturnsTargetReview(review);
      await browser.storage.local.set({ [key]: parsedMarkedReview });
      completionReview = parsedMarkedReview;
    }

    const durableSummary = await persistArtifactAcquisitionCompletion(
      deps.storageKeys.completion,
      scope,
      evidence,
      deps.now?.() ?? new Date(),
      copyFiledReturnsDownloadDiagnosticState(review),
    );
    if (!durableSummary) return responseForFiledReturnsTargetReview(completionReview);
    await browser.storage.local.remove(key);
    return {
      ok: true,
      flowStep: durableSummary.flowStep,
      flowSummary: durableSummary,
    };
  });
}

export async function resolveUnconfirmedFiledReturnsDownload(
  scope: FiledReturnsDownloadScope,
  resolution: "manually-observed" | "cancelled",
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse> {
  const key = deps.storageKeys.targetReview;
  if (!key) return noTargetReviewResponse(scope);
  return runTargetReviewMutationCriticalSection(async () => {
    const state = await readTargetReviewStorageStateByKey(key);
    if (state.state === "malformed") return malformedTargetReviewResponse(scope);
    if (state.state !== "valid" || !sameFiledReturnsScope(state.review.scope, scope)) {
      return noTargetReviewResponse(scope);
    }
    const review = state.review;
    const persistedArtifactCompletion = await readPersistedArtifactAcquisitionCompletion(
      scope,
      review,
      deps,
    );
    if (
      resolution === "cancelled" &&
      persistedArtifactCompletion &&
      hasArtifactAcquisitionRecoverySignal(review.safeSignals)
    ) {
      // The canonical session summary is the durable completion marker. A
      // service-worker stop can leave the local review behind after checkpoint
      // cleanup; never replace that completed target with a cancellation.
      const cancellation = await clearArtifactAcquisitionCheckpoints(review.scope);
      if (cancellation.state === "blocked") return responseForFiledReturnsTargetReview(review);
      if (cancellation.state === "completed") {
        await clearArtifactAcquisitionCheckpointsAfterPersistedSummary(
          review.scope,
          cancellation.evidence,
        );
      }
      await browser.storage.local.remove(key);
      return {
        ok: true,
        flowStep: persistedArtifactCompletion.flowStep,
        flowSummary: persistedArtifactCompletion,
      };
    }
    if (
      resolution === "cancelled" &&
      hasArtifactAcquisitionRecoverySignal(review.safeSignals) &&
      !review.artifactAcquisitionCompletion
    ) {
      const cancellation = await clearArtifactAcquisitionCheckpoints(review.scope);
      if (cancellation.state === "completed") {
        // Local review storage must carry the exact proof before the session
        // completion is written. An MV3 stop after the session write can leave
        // this review behind; without the marker, a later cancellation could
        // replace a proven download after its checkpoint is cleared.
        const markedCompletion = await markTargetReviewArtifactAcquisitionCompletion(
          scope,
          cancellation.evidence,
          deps,
        );
        if (markedCompletion.state !== "marked") return responseForFiledReturnsTargetReview(review);
        let restoredCompletion: FiledReturnsFlowSummary | null;
        try {
          restoredCompletion = await persistArtifactAcquisitionCompletion(
            deps.storageKeys.completion,
            scope,
            cancellation.evidence,
            deps.now?.() ?? new Date(),
            copyFiledReturnsDownloadDiagnosticState(markedCompletion.review),
          );
        } catch {
          return responseForFiledReturnsTargetReview(markedCompletion.review);
        }
        if (restoredCompletion) {
          await browser.storage.local.remove(key);
          return {
            ok: true,
            flowStep: restoredCompletion.flowStep,
            flowSummary: restoredCompletion,
          };
        }
      }
    }
    if (
      resolution === "cancelled" &&
      review.artifactAcquisitionCompletion &&
      hasArtifactAcquisitionRecoverySignal(review.safeSignals)
    ) {
      const artifacts = concreteFiledReturnsArtifactTypesForSelection(
        scope.returnType,
        scope.artifactType,
      );
      const [artifactType] = artifacts;
      if (artifacts.length !== 1 || !artifactType) {
        return responseForFiledReturnsTargetReview(review);
      }
      const inspection = await inspectArtifactAcquisitionCheckpoint({ ...scope, artifactType });
      if (inspection.state !== "completed" && inspection.state !== "retry-safe") {
        return responseForFiledReturnsTargetReview(review);
      }
      // A worker stop can retain the completed checkpoint, while a browser
      // restart clears it. In either case, restore this parser-validated local
      // completion marker before cancellation can replace the target.
      const restoredCompletion = await persistArtifactAcquisitionCompletion(
        deps.storageKeys.completion,
        scope,
        inspection.state === "completed"
          ? [inspection.evidence]
          : review.artifactAcquisitionCompletion,
        deps.now?.() ?? new Date(),
        copyFiledReturnsDownloadDiagnosticState(review),
      );
      if (!restoredCompletion) return responseForFiledReturnsTargetReview(review);
      await browser.storage.local.remove(key);
      return {
        ok: true,
        flowStep: restoredCompletion.flowStep,
        flowSummary: restoredCompletion,
      };
    }
    const hasCleanupFailure = hasSinglePeriodCleanupFailure(review.safeSignals);
    if (hasCleanupFailure && resolution !== "cancelled") {
      return responseForFiledReturnsTargetReview(review);
    }

    if (resolution === "manually-observed") {
      const updatedReview: FiledReturnsTargetReview = {
        ...review,
        revision: targetReviewRevision(review) + 1,
        safeSignals: uniqueSafeSignals([
          ...review.safeSignals,
          "filed-returns-target-manually-observed",
        ]),
        safeMessage:
          "Pack recorded a manual observation, but it cannot verify this download. Retry or cancel the target before treating it as complete.",
        updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      };
      const parsedReview = parseFiledReturnsTargetReview(updatedReview);
      if (!parsedReview) return malformedTargetReviewResponse(scope);
      await browser.storage.local.set({ [key]: parsedReview });
      return responseForFiledReturnsTargetReview(parsedReview);
    }

    if (review.downloadAttempt?.phase === "download-observing" && !hasCleanupFailure) {
      return responseForFiledReturnsTargetReview({
        ...review,
        safeSignals: uniqueSafeSignals([
          ...review.safeSignals,
          "filed-returns-download-reconciliation-required",
        ]),
        safeMessage:
          "Pack still has an exact browser download ID for this target. Retry the target so Pack can reconcile that ID before cancellation.",
      });
    }

    const cancelledZipCleanup = await cleanupCancelledSinglePeriodZip(review);
    if (cancelledZipCleanup?.state === "blocked") {
      const cleanupReview: FiledReturnsTargetReview = {
        ...review,
        revision: targetReviewRevision(review) + 1,
        safeSignals: uniqueSafeSignals([
          ...review.safeSignals,
          "single-period-zip-cancel-cleanup-failed",
          ...cancelledZipCleanup.safeSignals,
        ]),
        safeMessage: cancelledZipCleanup.transientStagingCleared
          ? "Pack cleared temporary selected-file staging but could not verify its durable cancellation checkpoint."
          : "Pack could not cancel this selected-file ZIP because its temporary local staging could not be cleared.",
        updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      };
      const parsedReview = parseFiledReturnsTargetReview(cleanupReview);
      if (!parsedReview) return malformedTargetReviewResponse(scope);
      await browser.storage.local.set({ [key]: parsedReview });
      return responseForFiledReturnsTargetReview(parsedReview);
    }

    if (hasArtifactAcquisitionRecoverySignal(review.safeSignals)) {
      if (
        review.safeSignals.includes("artifact-acquisition-checkpoint-malformed") &&
        review.artifactAcquisitionMalformedCheckpointReference &&
        !(await clearMalformedArtifactAcquisitionCheckpoint(
          review.artifactAcquisitionMalformedCheckpointReference,
        ))
      ) {
        return responseForFiledReturnsTargetReview(review);
      }
      const cancellation = await clearArtifactAcquisitionCheckpoints(review.scope, {
        discardCompleted: true,
        discardIntent: true,
        discardMissing: true,
      });
      if (cancellation.state === "blocked") {
        const clearFailureReview: FiledReturnsTargetReview = {
          ...review,
          revision: targetReviewRevision(review) + 1,
          safeSignals: uniqueSafeSignals([
            ...review.safeSignals,
            "artifact-acquisition-checkpoint-clear-failed",
          ]),
          safeMessage:
            "Pack could not clear retained artifact recovery state. It will not start another portal action automatically.",
          updatedAt: (deps.now?.() ?? new Date()).toISOString(),
        };
        const parsedReview = parseFiledReturnsTargetReview(clearFailureReview);
        if (!parsedReview) return malformedTargetReviewResponse(scope);
        await browser.storage.local.set({ [key]: parsedReview });
        return responseForFiledReturnsTargetReview(parsedReview);
      }
    }

    await browser.storage.local.remove(key);
    const flowStep: PortalFlowStepResult = {
      connectorId: "gst",
      scopeId: filedReturnScopeId(scope.returnType),
      state: "user-action-required",
      safeSignals: ["filed-returns-target-cancelled", ...(cancelledZipCleanup?.safeSignals ?? [])],
      safeMessage:
        "Pack cancelled the unresolved filed-return target. No portal click was retried.",
      ...copyFiledReturnsDownloadDiagnosticState(review),
    };
    const flowSummary: FiledReturnsFlowSummary = {
      scope: canonicalTargetReviewScope(scope),
      status: "cancelled",
      completedPeriods: [],
      totalPeriods: 1,
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      flowStep,
    };
    await persistResolvedTargetReviewSummary(flowSummary, deps);
    return { ok: true, flowStep, flowSummary };
  });
}

export async function retryCompletedSinglePeriodZipCleanup(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsTargetReviewDeps,
): Promise<PackMessageResponse | null> {
  const key = deps.storageKeys.targetReview;
  if (!key) return null;
  return runTargetReviewMutationCriticalSection(async () => {
    const state = await readTargetReviewStorageStateByKey(key);
    if (
      state.state !== "valid" ||
      !sameFiledReturnsScope(state.review.scope, scope) ||
      !hasSinglePeriodCleanupFailure(state.review.safeSignals)
    ) {
      return null;
    }
    const review = state.review;
    const attemptLedgerId =
      review.downloadAttempt?.kind === "single-period-zip"
        ? review.downloadAttempt.stagingLedgerId
        : null;
    let cleanupLedgerId = attemptLedgerId;
    let expectedLedger: SinglePeriodBundleLedger | undefined;
    if (attemptLedgerId) {
      let stagingRecord;
      try {
        stagingRecord = await readSinglePeriodStagingRecord();
      } catch {
        return responseForFiledReturnsTargetReview(review);
      }
      if (stagingRecord && stagingRecord.ledgerId !== attemptLedgerId) {
        return responseForFiledReturnsTargetReview(review);
      }
    } else {
      const cleanupTarget = await readScopeBoundSinglePeriodCleanupTarget(
        review,
        isInterruptedSinglePeriodBundleReview(review),
      );
      if (cleanupTarget.state === "blocked") {
        return responseForFiledReturnsTargetReview(review);
      }
      cleanupLedgerId = cleanupTarget.ledgerId;
      expectedLedger = cleanupTarget.expectedLedger;
    }
    if (!cleanupLedgerId) return responseForFiledReturnsTargetReview(review);
    const cleanup = await cleanupSinglePeriodBundleStaging({
      ...(expectedLedger ? { expectedLedger } : {}),
      ledgerId: cleanupLedgerId,
      scope,
    });
    if (cleanup.state === "blocked") {
      return responseForFiledReturnsTargetReview(review);
    }

    const cancelled = review.safeSignals.includes("single-period-zip-cancel-cleanup-failed");
    const completedDownload = hasConfirmedSinglePeriodZipDownloadEvidence(review.safeSignals);
    if (!cancelled && !completedDownload) {
      const unresolvedReview: FiledReturnsTargetReview = {
        ...review,
        revision: targetReviewRevision(review) + 1,
        safeSignals: uniqueSafeSignals([
          ...review.safeSignals.filter((signal) => !isResolvedSinglePeriodCleanupSignal(signal)),
          "single-period-opfs-cleanup-completed",
          "single-period-zip-cleanup-without-download",
          ...cleanup.safeSignals,
        ]),
        safeMessage:
          "Pack cleared temporary selected-file staging, but no exact browser download completion was recorded.",
        updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      };
      const parsedReview = parseFiledReturnsTargetReview(unresolvedReview);
      if (!parsedReview) return responseForFiledReturnsTargetReview(review);
      await browser.storage.local.set({ [key]: parsedReview });
      return responseForFiledReturnsTargetReview(parsedReview);
    }
    const flowStep: PortalFlowStepResult = {
      connectorId: "gst",
      scopeId: filedReturnScopeId(scope.returnType),
      state: cancelled ? "user-action-required" : "downloaded",
      safeSignals: Array.from(
        new Set([
          ...review.safeSignals,
          ...(cancelled ? ["filed-returns-target-cancelled"] : ["single-period-zip-downloaded"]),
          "single-period-opfs-cleanup-completed",
          ...cleanup.safeSignals,
        ]),
      ),
      safeMessage: cancelled
        ? "Pack cancelled the selected-file ZIP and cleared its temporary local staging."
        : "Pack kept the completed selected-file ZIP and cleared its temporary local staging.",
      ...copyFiledReturnsDownloadDiagnosticState(review),
    };
    const flowSummary: FiledReturnsFlowSummary = {
      scope: canonicalTargetReviewScope(scope),
      status: cancelled ? "cancelled" : "complete",
      completedPeriods: cancelled ? [] : [scope.period],
      currentPeriod: scope.period,
      totalPeriods: 1,
      updatedAt: (deps.now?.() ?? new Date()).toISOString(),
      flowStep,
    };
    const durableSummary = await persistResolvedTargetReviewSummary(flowSummary, deps);
    if (!durableSummary) return responseForFiledReturnsTargetReview(review);
    await browser.storage.local.remove(key);
    return {
      ok: true,
      flowStep: durableSummary.flowStep,
      flowSummary: durableSummary,
    };
  });
}

export async function persistResolvedTargetReviewSummary(
  flowSummary: FiledReturnsFlowSummary,
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const key = deps.storageKeys.completion;
  if (!key) return null;
  return persistCanonicalFiledReturnsFlowSummary(key, flowSummary);
}

async function readPersistedArtifactAcquisitionCompletion(
  scope: FiledReturnsDownloadScope,
  review: FiledReturnsTargetReview,
  deps: FiledReturnsTargetReviewDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const key = deps.storageKeys.completion;
  if (!key) return null;
  const summary = await readCanonicalFiledReturnsFlowSummary(key);
  return summary &&
    summary.status === "complete" &&
    sameExactFiledReturnsScope(summary.scope, scope) &&
    summary.flowStep.state === "downloaded" &&
    summary.flowStep.safeSignals.includes("artifact-acquisition-download-reconciled") &&
    sameArtifactAcquisitionCompletion(
      summary.artifactAcquisitionCompletion,
      review.artifactAcquisitionCompletion,
    )
    ? summary
    : null;
}

function parseFiledReturnsTargetReview(input: unknown): FiledReturnsTargetReview | null {
  if (!input || typeof input !== "object") return null;
  const review = input as Partial<FiledReturnsTargetReview> & Record<string, unknown>;
  if (
    !hasOnlyKeys(review, [
      "artifactAcquisitionCompletion",
      "artifactAcquisitionMalformedCheckpointReference",
      "downloadAttempt",
      "downloadDiagnostic",
      "downloadDiagnostics",
      "revision",
      "safeMessage",
      "safeSignals",
      "schemaVersion",
      "singlePeriodBundleCheckpoint",
      "scope",
      "status",
      "targetId",
      "updatedAt",
    ])
  ) {
    return null;
  }
  if (review.schemaVersion !== "1.0") return null;
  const revision = review.revision ?? 1;
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    revision > 10_000
  ) {
    return null;
  }
  if (!isBoundedString(review.targetId, 1, 120)) return null;
  if (review.status !== "download-unconfirmed") return null;
  const malformedCheckpointReference = review.artifactAcquisitionMalformedCheckpointReference;
  if (
    malformedCheckpointReference !== undefined &&
    (!isBoundedString(malformedCheckpointReference, 1, 120) ||
      !/^[a-zA-Z0-9-]+$/.test(malformedCheckpointReference))
  ) {
    return null;
  }
  const scope = parseDurableFiledReturnsScope(review.scope, Boolean(malformedCheckpointReference));
  if (!scope || review.targetId !== createTargetId(scope)) return null;
  const artifactAcquisitionCompletion = parseArtifactAcquisitionCompletion(
    review.artifactAcquisitionCompletion,
    scope,
  );
  if (review.artifactAcquisitionCompletion !== undefined && !artifactAcquisitionCompletion) {
    return null;
  }
  const durableStatus = parseDurableTargetStatus(scope, "target-review", review.safeSignals);
  if (!durableStatus) return null;
  if (
    isFullFiscalYearScope(scope) &&
    (!malformedCheckpointReference ||
      scope.completedPeriods !== undefined ||
      artifactAcquisitionCompletion ||
      review.downloadAttempt !== undefined ||
      review.singlePeriodBundleCheckpoint !== undefined ||
      !durableStatus.safeSignals.includes("artifact-acquisition-checkpoint-malformed"))
  ) {
    return null;
  }
  if (
    malformedCheckpointReference &&
    !durableStatus.safeSignals.includes("artifact-acquisition-checkpoint-malformed")
  ) {
    return null;
  }
  if (
    review.downloadAttempt !== undefined &&
    (!isFiledReturnsTargetDownloadAttempt(review.downloadAttempt) ||
      !downloadAttemptMatchesReviewScope(review.downloadAttempt, scope))
  ) {
    return null;
  }
  const singlePeriodBundleCheckpoint = parseSinglePeriodBundleCheckpoint(
    review.singlePeriodBundleCheckpoint,
  );
  if (review.singlePeriodBundleCheckpoint !== undefined && !singlePeriodBundleCheckpoint) {
    return null;
  }
  if (
    singlePeriodBundleCheckpoint &&
    (normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType) !== "PDF_AND_EXCEL" ||
      review.downloadAttempt !== undefined ||
      !durableStatus.safeSignals.includes("single-period-bundle-artifact-review-required"))
  ) {
    return null;
  }
  if (!isValidFiledReturnsDownloadDiagnosticState(review, scope)) {
    return null;
  }
  if (!downloadAttemptMatchesDiagnosticIdentity(review.downloadAttempt, review)) {
    return null;
  }
  if (!isCanonicalTimestamp(review.updatedAt)) {
    return null;
  }
  return {
    ...review,
    ...durableStatus,
    revision,
    scope,
    ...(artifactAcquisitionCompletion ? { artifactAcquisitionCompletion } : {}),
    ...(malformedCheckpointReference
      ? { artifactAcquisitionMalformedCheckpointReference: malformedCheckpointReference }
      : {}),
    ...(singlePeriodBundleCheckpoint ? { singlePeriodBundleCheckpoint } : {}),
  } as FiledReturnsTargetReview;
}

function sameArtifactAcquisitionCompletion(
  left: FiledReturnsFlowSummary["artifactAcquisitionCompletion"],
  right: readonly ArtifactAcquisitionCompletionEvidence[] | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.artifactType === right[index]?.artifactType &&
        entry.downloadId === right[index]?.downloadId &&
        entry.requestId === right[index]?.requestId,
    )
  );
}

function parseSinglePeriodBundleCheckpoint(
  input: unknown,
): NonNullable<FiledReturnsTargetReview["singlePeriodBundleCheckpoint"]> | null {
  if (input === undefined) return null;
  if (!input || typeof input !== "object") return null;
  const checkpoint = input as Record<string, unknown>;
  if (!hasOnlyKeys(checkpoint, ["ledgerId", "revision"])) return null;
  if (!isCanonicalSinglePeriodLedgerId(checkpoint.ledgerId)) return null;
  if (
    !Number.isSafeInteger(checkpoint.revision) ||
    Number(checkpoint.revision) < 1 ||
    Number(checkpoint.revision) > 1_000_000
  ) {
    return null;
  }
  return {
    ledgerId: checkpoint.ledgerId as string,
    revision: checkpoint.revision as number,
  };
}

async function cleanupCancelledSinglePeriodZip(
  review: FiledReturnsTargetReview,
): Promise<SinglePeriodBundleCleanupResult | null> {
  const attempt = review.downloadAttempt;
  if (attempt?.kind === "single-period-zip") {
    return cleanupSinglePeriodBundleStaging({
      ledgerId: attempt.stagingLedgerId,
      scope: review.scope,
    });
  }
  if (!isInterruptedSinglePeriodBundleReview(review)) return null;

  const cleanupTarget = await readScopeBoundSinglePeriodCleanupTarget(review, true);
  if (cleanupTarget.state === "blocked") {
    return {
      state: "blocked",
      safeSignals: cleanupTarget.safeSignals,
      transientStagingCleared: false,
    };
  }
  if (!cleanupTarget.expectedLedger) {
    return {
      state: "blocked",
      safeSignals: ["single-period-bundle-revision-conflict", "single-period-opfs-retained"],
      transientStagingCleared: false,
    };
  }
  return cleanupSinglePeriodBundleStaging({
    expectedLedger: cleanupTarget.expectedLedger,
    ledgerId: cleanupTarget.ledgerId,
    scope: review.scope,
  });
}

type ScopeBoundSinglePeriodCleanupTarget =
  | {
      state: "blocked";
      safeSignals: string[];
    }
  | {
      state: "ready";
      expectedLedger?: SinglePeriodBundleLedger;
      ledgerId: string;
    };

async function readScopeBoundSinglePeriodCleanupTarget(
  review: FiledReturnsTargetReview,
  requireInterruptedArtifact: boolean,
): Promise<ScopeBoundSinglePeriodCleanupTarget> {
  let storageState;
  try {
    storageState = await readSinglePeriodBundleLedgerStorageState();
  } catch {
    return blockedScopeBoundCleanup("single-period-bundle-state-read-failed");
  }

  if (storageState.state === "missing") {
    return blockedScopeBoundCleanup("single-period-zip-recovery-checkpoint-missing");
  }
  if (storageState.state === "malformed") {
    return blockedScopeBoundCleanup("single-period-bundle-ledger-malformed");
  }
  if (storageState.state === "legacy") {
    return requireInterruptedArtifact
      ? blockedScopeBoundCleanup("single-period-bundle-revision-conflict")
      : { ledgerId: storageState.ledgerId, state: "ready" };
  }

  const ledger = storageState.ledger;
  if (!sameSinglePeriodBundleScope(ledger.scope, review.scope)) {
    return blockedScopeBoundCleanup("single-period-bundle-scope-conflict");
  }
  const reviewCheckpoint = review.singlePeriodBundleCheckpoint;
  if (
    requireInterruptedArtifact &&
    (!reviewCheckpoint ||
      reviewCheckpoint.ledgerId !== ledger.ledgerId ||
      reviewCheckpoint.revision !== ledger.revision)
  ) {
    return blockedScopeBoundCleanup("single-period-bundle-revision-conflict");
  }
  if (
    requireInterruptedArtifact &&
    ledger.phase !== "artifact-review" &&
    !ledger.artifacts.some((artifact) => artifact.status === "running")
  ) {
    return blockedScopeBoundCleanup("single-period-bundle-revision-conflict");
  }
  return {
    expectedLedger: ledger,
    ledgerId: ledger.ledgerId,
    state: "ready",
  };
}

function blockedScopeBoundCleanup(signal: string): ScopeBoundSinglePeriodCleanupTarget {
  return {
    state: "blocked",
    safeSignals: [signal, "single-period-opfs-retained"],
  };
}

function isInterruptedSinglePeriodBundleReview(review: FiledReturnsTargetReview): boolean {
  return (
    review.downloadAttempt === undefined &&
    review.safeSignals.includes("single-period-bundle-artifact-review-required") &&
    review.safeSignals.includes("single-period-bundle-running-ambiguous")
  );
}

function downloadAttemptMatchesReviewScope(
  attempt: NonNullable<FiledReturnsTargetReview["downloadAttempt"]>,
  scope: FiledReturnsDownloadScope,
): boolean {
  const selectedArtifact = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  if (attempt.kind === "single-period-zip") return selectedArtifact === "PDF_AND_EXCEL";
  if (attempt.phase === "target-bound-candidate-observing") {
    return scope.returnType === "GSTR-3B" && selectedArtifact === "PDF";
  }
  return selectedArtifact === attempt.artifactType;
}

function downloadAttemptMatchesDiagnosticIdentity(
  attempt: FiledReturnsTargetReview["downloadAttempt"],
  diagnostics: Pick<FiledReturnsTargetReview, "downloadDiagnostic" | "downloadDiagnostics">,
): boolean {
  if (!attempt || attempt.kind !== "single-artifact") return true;
  const entries =
    diagnostics.downloadDiagnostics ??
    (diagnostics.downloadDiagnostic ? [diagnostics.downloadDiagnostic] : []);
  if (entries.some((diagnostic) => diagnostic.actionId !== attempt.actionId)) return false;
  if (attempt.phase === "download-intent-persisted") {
    return entries.every((diagnostic) => diagnostic.downloadId === undefined);
  }
  return entries.every(
    (diagnostic) =>
      diagnostic.downloadId === undefined || diagnostic.downloadId === attempt.downloadId,
  );
}

function toTargetReviewSummary(
  review: FiledReturnsTargetReview,
  flowStep = targetReviewStep(review),
): FiledReturnsFlowSummary {
  return {
    scope: review.scope,
    status: "blocked",
    completedPeriods: [],
    totalPeriods: 1,
    currentPeriod: review.scope.period,
    updatedAt: review.updatedAt,
    flowStep,
  };
}

function targetReviewStep(review: FiledReturnsTargetReview): PortalFlowStepResult {
  if (review.safeSignals.includes("filed-return-durable-status-rejected")) {
    const hasExactDownloadId = review.downloadAttempt?.phase === "download-observing";
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId(review.scope.returnType),
      state: "blocked",
      safeSignals: [
        "filed-returns-target-review-required",
        ...(hasExactDownloadId
          ? ["filed-returns-download-reconciliation-required"]
          : ["filed-returns-download-manual-review-required"]),
        "filed-return-durable-status-rejected",
        ...(review.safeSignals.includes("single-period-opfs-cleared")
          ? ["single-period-opfs-cleared"]
          : []),
      ],
      safeMessage: hasExactDownloadId
        ? "Pack confirmed the exact browser download but could not save canonical target completion. It will not start another download automatically."
        : "Pack rejected non-canonical recovery state and cannot verify whether a download started. It will not continue automatically.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: hasExactDownloadId
          ? "Re-check the saved exact browser download ID without starting another download."
          : "Review or cancel this target before starting another portal action.",
        canResume: true,
      },
      ...copyFiledReturnsDownloadDiagnosticState(review),
    };
  }
  if (hasSinglePeriodCleanupFailure(review.safeSignals)) {
    const transientStagingCleared = review.safeSignals.includes("single-period-opfs-cleared");
    const downloadConfirmed = hasConfirmedSinglePeriodZipDownloadEvidence(review.safeSignals);
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId(review.scope.returnType),
      state: "blocked",
      safeSignals: uniqueSafeSignals([
        "filed-returns-target-review-required",
        "filed-returns-target-local-cleanup-required",
        ...(transientStagingCleared
          ? ["single-period-opfs-cleared", "single-period-cleanup-checkpoint-failed"]
          : ["single-period-opfs-clear-failed", "single-period-opfs-cleanup-required"]),
        ...confirmedSinglePeriodZipSignals(review.safeSignals),
        ...singlePeriodOpfsClearDiagnosticSignals(review.safeSignals),
      ]),
      safeMessage: transientStagingCleared
        ? "Pack cleared temporary selected-file staging but could not verify its durable recovery checkpoint cleanup."
        : downloadConfirmed
          ? `Pack confirmed the selected ZIP download for ${review.scope.period}; only temporary local staging remains to be cleared.`
          : "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: transientStagingCleared
          ? "Retry so Pack can reconcile the durable selected-file recovery checkpoint."
          : "Retry so Pack can clear the retained temporary staging before completion.",
        canResume: true,
      },
      ...copyFiledReturnsDownloadDiagnosticState(review),
    };
  }
  const interruptedSinglePeriodBundle = isInterruptedSinglePeriodBundleReview(review);
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(review.scope.returnType),
    state: "user-action-required",
    safeSignals: uniqueSafeSignals([
      "filed-returns-target-review-required",
      ...(review.downloadAttempt
        ? [
            review.downloadAttempt.phase === "download-observing"
              ? "filed-returns-download-reconciliation-required"
              : "filed-returns-download-manual-review-required",
          ]
        : []),
      ...(review.safeSignals.includes("filed-returns-target-manually-observed")
        ? ["filed-returns-target-manually-observed"]
        : []),
      ...(review.safeSignals.includes("single-period-zip-incomplete")
        ? ["single-period-zip-incomplete"]
        : []),
      ...(interruptedSinglePeriodBundle
        ? review.safeSignals.filter(
            (signal) =>
              [
                "portal-system-error",
                "single-period-bundle-artifact-review-required",
                "single-period-bundle-running-ambiguous",
                "single-period-opfs-retained",
              ].includes(signal) || signal.endsWith("-main-world-capture-timeout"),
          )
        : []),
      ...review.safeSignals.filter((signal) => signal.startsWith("artifact-acquisition-")),
      ...(hasSinglePeriodCleanupFailure(review.safeSignals)
        ? ["filed-returns-target-local-cleanup-required"]
        : []),
      ...targetReviewDiagnosticSignals(review.safeSignals),
    ]),
    safeMessage: review.safeMessage,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: interruptedSinglePeriodBundle
        ? "Cancel and reset this retained bundle before starting the selected target again."
        : "Choose an explicit retry or cancellation before Pack clicks this period again.",
      canResume: !interruptedSinglePeriodBundle,
    },
    ...copyFiledReturnsDownloadDiagnosticState(review),
  };
}

function confirmedSinglePeriodZipSignals(safeSignals: readonly string[]): string[] {
  return safeSignals.filter(
    (signal) =>
      signal === "single-period-zip-downloaded" ||
      signal === "browser-download-completed" ||
      signal === "browser-download-non-empty" ||
      /^browser-download-id:\d{1,10}$/.test(signal),
  );
}

function singlePeriodOpfsClearDiagnosticSignals(safeSignals: readonly string[]): string[] {
  return safeSignals.filter(
    (signal) =>
      signal === "single-period-opfs-clear-offscreen-response-invalid" ||
      signal === "single-period-opfs-clear-offscreen-unreachable" ||
      /^single-period-opfs-clear-error:(clear-failed|opfs-unavailable)$/.test(signal),
  );
}

function targetReviewDiagnosticSignals(safeSignals: readonly string[]): string[] {
  return safeSignals.filter(
    (signal) =>
      TARGET_REVIEW_BROWSER_DIAGNOSTIC_SIGNALS.has(signal) ||
      signal.endsWith("-main-world-capture-armed") ||
      signal.endsWith("-main-world-capture-exception") ||
      signal.endsWith("-main-world-capture-result-rejected") ||
      signal.endsWith("-main-world-capture-timeout") ||
      signal.endsWith("-target-bound-native-blob-click-delegated"),
  );
}

function hasArtifactAcquisitionRecoverySignal(safeSignals: readonly string[]): boolean {
  return safeSignals.some((signal) => signal.startsWith("artifact-acquisition-"));
}

const TARGET_REVIEW_BROWSER_DIAGNOSTIC_SIGNALS = new Set([
  "browser-download-correlation-rejected",
  "browser-download-danger-pending",
  "browser-download-danger-rejected",
  "browser-download-danger-unknown",
  "browser-download-existence-unknown",
  "browser-download-file-missing",
  "browser-download-in-progress",
  "browser-download-interrupted",
  "browser-download-not-observed",
  "browser-download-save-dialog-may-be-open",
  "browser-download-search-missing",
  "browser-download-search-unavailable",
  "browser-download-size-unknown",
  "browser-download-state-unconfirmed",
  "browser-download-zero-bytes",
]);

export function noTargetReviewResponse(scope: FiledReturnsDownloadScope): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "user-action-required",
    safeSignals: ["filed-returns-target-review-not-found"],
    safeMessage: "Pack did not find an unresolved filed-return target for this period.",
  };
  return {
    ok: true,
    flowStep,
    flowSummary: {
      scope,
      status: "blocked",
      completedPeriods: [],
      totalPeriods: 1,
      currentPeriod: scope.period,
      flowStep,
    },
  };
}

export function malformedTargetReviewResponse(
  scope: FiledReturnsDownloadScope,
): PackMessageResponse {
  const flowStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "blocked",
    safeSignals: ["filed-returns-target-review-malformed"],
    safeMessage:
      "Pack found damaged filed-return recovery metadata and cannot verify whether a browser download already started.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message:
        "Check browser Downloads, then use Clear local Pack data before starting another filed-return download.",
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
      totalPeriods: 1,
      currentPeriod: scope.period,
      flowStep,
    },
  };
}

function requiresTargetReview(step: PortalFlowStepResult): boolean {
  if (hasSinglePeriodCleanupFailure(step.safeSignals)) return true;
  if (step.safeSignals.includes("single-period-bundle-artifact-review-required")) return true;
  if (step.safeSignals.includes("filed-return-durable-status-rejected")) return true;
  if (hasArtifactAcquisitionRecoverySignal(step.safeSignals)) return true;
  if (step.safeSignals.includes("filed-gstr1-excel-no-details-available")) return false;
  return (
    step.state === "download-unconfirmed" ||
    step.safeSignals.some((signal) => signal.endsWith("-main-world-capture-timeout")) ||
    step.safeSignals.some((signal) =>
      [
        "browser-download-size-unknown",
        "browser-download-not-observed",
        "browser-download-danger-rejected",
        "filed-return-download-trigger-ambiguous",
        "filed-gstr3b-download-trigger-ambiguous",
      ].includes(signal),
    )
  );
}

function hasSinglePeriodCleanupFailure(safeSignals: readonly string[]): boolean {
  return safeSignals.some(isSinglePeriodCleanupFailureSignal);
}

function isSinglePeriodCleanupFailureSignal(signal: string): boolean {
  return [
    "single-period-opfs-clear-failed",
    "single-period-cleanup-checkpoint-failed",
    "single-period-bundle-ledger-malformed",
    "single-period-bundle-scope-conflict",
    "single-period-bundle-revision-conflict",
    "single-period-bundle-state-read-failed",
    "single-period-zip-cancel-cleanup-failed",
  ].includes(signal);
}

function isResolvedSinglePeriodCleanupSignal(signal: string): boolean {
  return signal === "single-period-opfs-retained" || isSinglePeriodCleanupFailureSignal(signal);
}

function uniqueSafeSignals(safeSignals: readonly string[]): string[] {
  return [...new Set(safeSignals)];
}

async function readTargetReviewStorageStateByKey(
  key: string,
): Promise<FiledReturnsTargetReviewStorageState> {
  const values = await browser.storage.local.get(key);
  const stored = values[key];
  if (stored === undefined || stored === null) return { state: "missing" };
  if (isMalformedTargetReviewSentinel(stored)) return { state: "malformed" };
  const review = parseFiledReturnsTargetReview(stored);
  if (review) return { review, state: "valid" };
  // Do not retain unvalidated recovery metadata. The sentinel preserves the
  // fail-closed state until the user explicitly clears local Pack data.
  await browser.storage.local.set({ [key]: MALFORMED_TARGET_REVIEW_SENTINEL });
  return { state: "malformed" };
}

async function readCanonicalTargetReviewStorageStateByKey(
  key: string,
): Promise<FiledReturnsTargetReviewStorageState> {
  return runTargetReviewMutationCriticalSection(async () => {
    const values = await browser.storage.local.get(key);
    const stored = values[key];
    if (stored === undefined || stored === null) return { state: "missing" };
    if (isMalformedTargetReviewSentinel(stored)) return { state: "malformed" };
    const review = parseFiledReturnsTargetReview(stored);
    if (!review) {
      // Replace, rather than delete, untrusted metadata. A subsequent start
      // must remain blocked until the user chooses the explicit clear-data
      // recovery action.
      await browser.storage.local.set({ [key]: MALFORMED_TARGET_REVIEW_SENTINEL });
      return { state: "malformed" };
    }
    if (!hasEquivalentJsonValue(stored, review)) {
      await browser.storage.local.set({ [key]: review });
    }
    return { review, state: "valid" };
  });
}

function isMalformedTargetReviewSentinel(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    hasOnlyKeys(value, ["schemaVersion", "state"]) &&
    value.schemaVersion === MALFORMED_TARGET_REVIEW_SENTINEL.schemaVersion &&
    value.state === MALFORMED_TARGET_REVIEW_SENTINEL.state
  );
}

function hasEquivalentJsonValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

async function runTargetReviewMutationCriticalSection<T>(action: () => Promise<T>): Promise<T> {
  const previous = targetReviewMutationCriticalSection;
  let release: () => void = () => undefined;
  targetReviewMutationCriticalSection = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

function targetReviewRevision(review: FiledReturnsTargetReview): number {
  return review.revision ?? 1;
}

function nextTargetReviewRevision(review: FiledReturnsTargetReview | null): number {
  return review ? targetReviewRevision(review) + 1 : 1;
}

function canonicalTargetReviewScope(scope: FiledReturnsDownloadScope): FiledReturnsDownloadScope {
  return {
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
    ...(scope.artifactType ? { artifactType: scope.artifactType } : {}),
  };
}

function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    artifactSelectionsOverlap(left, right)
  );
}

function sameExactFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}

function artifactSelectionsOverlap(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  const leftArtifacts = concreteFiledReturnsArtifactTypesForSelection(
    left.returnType,
    left.artifactType,
  );
  const rightArtifacts = concreteFiledReturnsArtifactTypesForSelection(
    right.returnType,
    right.artifactType,
  );
  return leftArtifacts.some((artifactType) => rightArtifacts.includes(artifactType));
}

function createTargetId(scope: FiledReturnsDownloadScope): string {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const baseTargetId = `${scope.returnType}:${scope.financialYear}:${scope.period}`;
  return artifactType === "PDF" ? baseTargetId : `${baseTargetId}:${artifactType}`;
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function isCanonicalTimestamp(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 40) return false;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === input;
}
