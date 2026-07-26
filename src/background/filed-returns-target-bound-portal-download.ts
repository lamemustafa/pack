import { browser } from "wxt/browser";
import type {
  BrowserDownloadSafeEvidence,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { filedReturnScopedSignal } from "../connectors/gst/filed-returns-return-descriptors";
import {
  isTargetBoundGstr3bPortalDownloadCandidate,
  MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS,
  targetBoundNativeFilenameNonceForActionId,
} from "../connectors/gst/filed-returns-target-bound-download-candidate";
import { observeBrowserDownloadById } from "./download-observer";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { expectedDownloadForArtifact } from "./filed-returns-download-expectations";
import { targetReviewScope } from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { finalizeObservedSingleArtifactDownload } from "./filed-returns-single-artifact-download-completion";
import {
  confirmTargetBoundPortalCandidateDownloadId,
  moveFiledReturnsTargetDownloadToManualReview,
  persistFiledReturnsTargetDownloadIntent,
  persistTargetBoundPortalCandidateDownloadId,
} from "./filed-returns-target-download-attempt";
import {
  armTargetBoundGstr3bPortalCandidateCollector,
  type ArmedTargetBoundPortalCandidateCollector,
  type TargetBoundPortalCandidateCollection,
  type TargetBoundPortalCandidateDownloadsApi,
} from "./filed-returns-target-bound-portal-candidate";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";
import { beginLiveFiledReturnsDownloadObservation } from "./filed-returns-durable-download-reconciler";

export type TargetBoundPortalDownloadPreparation =
  | { state: "disabled" }
  | { response: PackMessageResponse; state: "blocked" }
  | {
      armedAt: Date;
      checkpointDeps: FiledReturnsFlowMessagingDeps & {
        storageKeys: FiledReturnsFlowMessagingDeps["storageKeys"] & { targetReview: string };
      };
      candidateCheckpoint: Promise<TargetBoundPortalCandidateCheckpoint>;
      collector: ArmedTargetBoundPortalCandidateCollector;
      expectedIncognito: boolean;
      filenameNonce: string;
      reviewScope: FiledReturnsDownloadScope;
      state: "armed";
      windowEndsAt: Date;
    };

export type TargetBoundPortalCandidateCheckpoint = {
  downloadId: number | null;
  persisted: boolean;
};

export async function prepareTargetBoundGstr3bPortalDownload({
  armedAt,
  artifactType,
  deps,
  scope,
  target,
  triggerStep,
}: {
  armedAt: Date;
  artifactType: FiledReturnsConcreteArtifactType;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): Promise<TargetBoundPortalDownloadPreparation> {
  const downloads = targetBoundDownloadsApi();
  const filenameNonce = targetBoundNativeFilenameNonceForActionId(target.actionId);
  if (
    !downloads ||
    !filenameNonce ||
    deps.stageCapturedDownloads ||
    deps.persistTargetReview === false ||
    typeof deps.portalTabIncognito !== "boolean" ||
    !deps.storageKeys.completion ||
    target.returnType !== "GSTR-3B" ||
    artifactType !== "PDF" ||
    target.artifactType !== "PDF"
  ) {
    return { state: "disabled" };
  }

  const reviewScope = targetReviewScope(scope, artifactType);
  const checkpointDeps = {
    ...deps,
    storageKeys: {
      ...deps.storageKeys,
      targetReview: deps.storageKeys.targetReview ?? PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  };
  let intentPersisted = false;
  try {
    intentPersisted = await persistFiledReturnsTargetDownloadIntent(
      reviewScope,
      {
        actionId: target.actionId,
        artifactType,
        kind: "single-artifact",
        phase: "download-intent-persisted",
        requestedAt: armedAt.toISOString(),
      },
      checkpointDeps,
    );
  } catch {
    intentPersisted = false;
  }
  if (!intentPersisted) {
    return {
      state: "blocked",
      response: {
        ok: true,
        flowStep: {
          ...withoutUnverifiedCaptureSuccessSignals(triggerStep, target),
          state: "blocked",
          safeSignals: [
            ...withoutUnverifiedCaptureSuccessSignals(triggerStep, target).safeSignals,
            "filed-return-download-state-persist-failed",
          ],
          safeMessage:
            "Pack did not click the GST Portal download control because it could not save the target-bound recovery checkpoint.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message: "Retry after Pack can save its local recovery state.",
            canResume: true,
          },
        },
      },
    };
  }

  const windowMs = boundedTargetBoundWindowMs(deps);
  const windowEndsAt = new Date(armedAt.getTime() + windowMs);
  const collector = armTargetBoundGstr3bPortalCandidateCollector(downloads, {
    armedAt,
    expectedIncognito: deps.portalTabIncognito,
    filenameNonce,
    target,
    windowEndsAt,
  });
  const candidateCheckpoint = collector.firstCandidate.then(async (downloadId) => {
    if (downloadId === null) return { downloadId: null, persisted: true };
    let persisted = false;
    try {
      persisted = await persistTargetBoundPortalCandidateDownloadId(
        reviewScope,
        downloadId,
        windowEndsAt,
        checkpointDeps,
      );
    } catch {
      persisted = false;
    }
    return { downloadId, persisted };
  });
  return {
    armedAt,
    candidateCheckpoint,
    checkpointDeps,
    collector,
    expectedIncognito: deps.portalTabIncognito,
    filenameNonce,
    reviewScope,
    state: "armed",
    windowEndsAt,
  };
}

export async function resolveTargetBoundGstr3bPortalDownload({
  activePeriod,
  artifactType,
  captureFailureSignals,
  delegatedAt,
  deps,
  preparation,
  scope,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  captureFailureSignals: readonly string[];
  delegatedAt: Date;
  deps: FiledReturnsFlowMessagingDeps;
  preparation: Extract<TargetBoundPortalDownloadPreparation, { state: "armed" }>;
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): Promise<{
  additionalFailureSignals: string[];
  response: PackMessageResponse | null;
}> {
  const boundTriggerStep = targetBoundPortalTriggerStep(triggerStep, target, captureFailureSignals);
  const collection = await preparation.collector.result;
  const checkpoint = await preparation.candidateCheckpoint;
  if (collection.state !== "single") {
    if (checkpoint.downloadId !== null && checkpoint.persisted) {
      try {
        await moveFiledReturnsTargetDownloadToManualReview(
          preparation.reviewScope,
          preparation.checkpointDeps,
        );
      } catch {
        // A provisional phase is recovery-safe and never auto-completes.
      }
    }
    return {
      additionalFailureSignals: candidateFailureSignals(collection),
      response: null,
    };
  }

  if (
    !(await candidateStartedAfterTrustedDelegation(
      collection.downloadId,
      delegatedAt,
      preparation,
      target,
    ))
  ) {
    if (checkpoint.downloadId !== null && checkpoint.persisted) {
      try {
        await moveFiledReturnsTargetDownloadToManualReview(
          preparation.reviewScope,
          preparation.checkpointDeps,
        );
      } catch {
        // The provisional phase remains manual-only if cleanup cannot be saved.
      }
    }
    return {
      additionalFailureSignals: [
        "browser-download-correlation-rejected",
        "filed-gstr3b-download-candidate-pre-delegation",
      ],
      response: null,
    };
  }

  const pendingEvidence = targetBoundPendingEvidence(collection.downloadId);
  const pendingDiagnosticStep = withFiledReturnsDownloadDiagnostic({
    attemptClass: "target-bound-portal-click",
    flowStep: boundTriggerStep,
    safeEvidence: pendingEvidence,
    target,
  });
  let downloadIdConfirmed = false;
  try {
    downloadIdConfirmed =
      checkpoint.persisted &&
      checkpoint.downloadId === collection.downloadId &&
      (await confirmTargetBoundPortalCandidateDownloadId(
        preparation.reviewScope,
        collection.downloadId,
        preparation.windowEndsAt,
        preparation.checkpointDeps,
        pendingDiagnosticStep,
      ));
  } catch {
    downloadIdConfirmed = false;
  }
  if (!downloadIdConfirmed) {
    const unpersistedEvidence: BrowserDownloadSafeEvidence = {
      byteCountClass: "unknown",
      mimeClass: "pdf",
      urlClass: "blob",
    };
    const flowStep = withFiledReturnsDownloadDiagnostic({
      attemptClass: "target-bound-portal-click",
      flowStep: {
        ...boundTriggerStep,
        safeSignals: [...boundTriggerStep.safeSignals, "filed-return-download-id-persist-failed"],
        safeMessage:
          "Pack found the target-bound browser download but could not save its exact ID. Check browser Downloads, then cancel this target before retrying.",
      },
      safeEvidence: unpersistedEvidence,
      target,
    });
    return { additionalFailureSignals: [], response: { ok: true, flowStep } };
  }

  const endLiveObservation = beginLiveFiledReturnsDownloadObservation(collection.downloadId);
  const observedDownload = await observeBrowserDownloadById(
    browser.downloads,
    collection.downloadId,
    {
      ...expectedDownloadForArtifact(artifactType),
      armedAt: preparation.armedAt,
      trustedDownloadIds: new Set([collection.downloadId]),
    },
  ).finally(endLiveObservation);
  return {
    additionalFailureSignals: [],
    response: await finalizeObservedSingleArtifactDownload({
      activePeriod,
      artifactType,
      attemptClass: "target-bound-portal-click",
      deps,
      observedDownload,
      pendingSafeEvidence: pendingEvidence,
      scope,
      target,
      triggerStep: boundTriggerStep,
    }),
  };
}

export async function cancelPreparedTargetBoundGstr3bPortalDownload(
  preparation: Extract<TargetBoundPortalDownloadPreparation, { state: "armed" }>,
): Promise<void> {
  preparation.collector.cancel();
  const checkpoint = await preparation.candidateCheckpoint;
  if (checkpoint.downloadId === null || !checkpoint.persisted) return;
  try {
    await moveFiledReturnsTargetDownloadToManualReview(
      preparation.reviewScope,
      preparation.checkpointDeps,
    );
  } catch {
    // The provisional phase itself is restart-safe and never auto-completes.
  }
}

export function trustedTargetBoundNativeBlobDelegatedAt(
  signals: readonly string[],
  signalPrefix: string,
  delegatedAt: string | undefined,
): Date | null {
  const delegatedSignal = `${signalPrefix}-target-bound-native-blob-click-delegated`;
  if (!signals.includes(delegatedSignal) || !delegatedAt) return null;
  const rejectedTerminalSuffixes = [
    "capture-control-not-found",
    "capture-control-ambiguous",
    "capture-control-not-actionable",
    "capture-control-artifact-mismatch",
    "capture-control-fingerprint-mismatch",
    "capture-target-binding-missing",
    "capture-target-binding-invalid",
    "capture-target-path-mismatch",
    "capture-target-evidence-conflict",
    "capture-target-identity-missing",
    "capture-target-identity-mismatch",
    "capture-control-click-threw",
    "capture-hook-install-failed",
    "main-world-capture-timeout",
    "main-world-capture-exception",
    "main-world-capture-result-rejected",
  ];
  if (rejectedTerminalSuffixes.some((suffix) => signals.includes(`${signalPrefix}-${suffix}`))) {
    return null;
  }
  const parsed = Date.parse(delegatedAt);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === delegatedAt
    ? new Date(parsed)
    : null;
}

function targetBoundPendingEvidence(downloadId: number): BrowserDownloadSafeEvidence {
  return {
    byteCountClass: "unknown",
    downloadId,
    mimeClass: "pdf",
    urlClass: "blob",
  };
}

async function candidateStartedAfterTrustedDelegation(
  downloadId: number,
  delegatedAt: Date,
  preparation: Extract<TargetBoundPortalDownloadPreparation, { state: "armed" }>,
  target: FiledReturnsDownloadTarget,
): Promise<boolean> {
  const downloads = targetBoundDownloadsApi();
  if (
    !downloads ||
    delegatedAt.getTime() < preparation.armedAt.getTime() ||
    delegatedAt.getTime() > preparation.windowEndsAt.getTime()
  ) {
    return false;
  }
  let items;
  try {
    items = await downloads.search({ id: downloadId });
  } catch {
    return false;
  }
  return Boolean(
    items.length === 1 &&
    items[0]?.id === downloadId &&
    isTargetBoundGstr3bPortalDownloadCandidate(items[0], {
      armedAt: delegatedAt,
      expectedIncognito: preparation.expectedIncognito,
      filenameNonce: preparation.filenameNonce,
      target,
      windowEndsAt: preparation.windowEndsAt,
    }),
  );
}

export function withoutUnverifiedCaptureSuccessSignals(
  step: PortalFlowStepResult,
  target: FiledReturnsDownloadTarget,
): PortalFlowStepResult {
  const rejectedSignals = new Set([
    filedReturnScopedSignal(target.returnType, "portal-blob-download-captured"),
    filedReturnScopedSignal(target.returnType, "extension-download-requested"),
  ]);
  return {
    ...step,
    safeSignals: step.safeSignals.filter((signal) => !rejectedSignals.has(signal)),
  };
}

function targetBoundPortalTriggerStep(
  triggerStep: PortalFlowStepResult,
  target: FiledReturnsDownloadTarget,
  captureFailureSignals: readonly string[],
): PortalFlowStepResult {
  const sanitized = withoutUnverifiedCaptureSuccessSignals(triggerStep, target);
  return {
    ...sanitized,
    state: "download-unconfirmed",
    safeSignals: Array.from(
      new Set([
        ...sanitized.safeSignals,
        ...captureFailureSignals,
        "filed-return-download-recovery-checkpoint",
      ]),
    ),
    safeMessage:
      "Pack bound the portal-created GSTR-3B PDF to this exact action and browser download ID.",
  };
}

function candidateFailureSignals(collection: TargetBoundPortalCandidateCollection): string[] {
  if (collection.state === "ambiguous") {
    return ["browser-download-correlation-rejected", "filed-gstr3b-download-candidate-ambiguous"];
  }
  return collection.state === "none" ? ["browser-download-not-observed"] : [];
}

function boundedTargetBoundWindowMs(deps: FiledReturnsFlowMessagingDeps): number {
  const configured = deps.timings?.targetBoundPortalDownloadWaitMs;
  if (!Number.isFinite(configured) || configured === undefined) {
    return MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS;
  }
  return Math.max(1, Math.min(configured, MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS));
}

function targetBoundDownloadsApi(): TargetBoundPortalCandidateDownloadsApi | null {
  const downloads = browser.downloads as unknown as Partial<TargetBoundPortalCandidateDownloadsApi>;
  if (
    !downloads.onCreated ||
    typeof downloads.onCreated.addListener !== "function" ||
    typeof downloads.onCreated.removeListener !== "function" ||
    typeof downloads.search !== "function"
  ) {
    return null;
  }
  return downloads as TargetBoundPortalCandidateDownloadsApi;
}
