import { browser } from "wxt/browser";
import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { capturedFiledReturnsArtifactExtension } from "./captured-download-data-url";
import { observeBrowserDownloadById } from "./download-observer";
import { capturedDownloadSignalPrefix } from "./filed-returns-captured-signals";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { expectedDownloadForArtifact } from "./filed-returns-download-expectations";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import { targetReviewScope } from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";
import { finalizeObservedSingleArtifactDownload } from "./filed-returns-single-artifact-download-completion";
import {
  clearFiledReturnsTargetDownloadAttempt,
  persistFiledReturnsTargetDownloadId,
  persistFiledReturnsTargetDownloadIntent,
} from "./filed-returns-target-download-attempt";
import {
  closeOffscreenBlobDocument,
  createOffscreenBlobUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";
import { beginLiveFiledReturnsDownloadObservation } from "./filed-returns-durable-download-reconciler";

export async function downloadCapturedFiledReturnThroughExtension({
  activePeriod,
  armedAt,
  artifactType,
  capturedDownloadRequest,
  deps,
  scope,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  armedAt: Date;
  artifactType: FiledReturnsConcreteArtifactType;
  capturedDownloadRequest: FiledReturnsCapturedDownloadRequest;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): Promise<PackMessageResponse> {
  const blobUrl = await createOffscreenBlobUrl(capturedDownloadRequest.dataUrl);
  if (!blobUrl) {
    return {
      ok: true,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: "captured-portal-request",
        flowStep: {
          ...triggerStep,
          state: "blocked",
          safeSignals: [
            ...triggerStep.safeSignals,
            ...capturedDownloadRequest.safeSignals,
            "filed-return-offscreen-blob-url-rejected",
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            "Pack captured the filed-return file, but could not prepare a temporary extension Blob URL for the local download.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message: "Retry from the same GST Portal page.",
            canResume: true,
          },
        },
        target,
      }),
    };
  }

  const reviewScope = targetReviewScope(scope, artifactType);
  const checkpointEnabled = deps.persistTargetReview !== false;
  const checkpointDeps = {
    ...deps,
    storageKeys: {
      ...deps.storageKeys,
      targetReview: deps.storageKeys.targetReview ?? PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  };
  const downloadRequestedAt = deps.now?.() ?? new Date();
  if (checkpointEnabled) {
    let intentPersisted = false;
    try {
      intentPersisted = await persistFiledReturnsTargetDownloadIntent(
        reviewScope,
        {
          actionId: target.actionId,
          artifactType,
          kind: "single-artifact",
          phase: "download-intent-persisted",
          requestedAt: downloadRequestedAt.toISOString(),
        },
        checkpointDeps,
      );
    } catch {
      intentPersisted = false;
    }
    if (!intentPersisted) {
      await revokeOffscreenBlobUrl(blobUrl);
      await closeOffscreenBlobDocument();
      return {
        ok: true,
        flowStep: withFiledReturnsDownloadDiagnostic({
          attemptClass: "captured-portal-request",
          flowStep: {
            ...triggerStep,
            state: "blocked",
            safeSignals: [
              ...triggerStep.safeSignals,
              ...capturedDownloadRequest.safeSignals,
              "filed-return-download-state-persist-failed",
              ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
            ],
            safeMessage:
              "Pack did not start the captured filed-return download because it could not save a safe recovery checkpoint.",
            userAction: {
              type: "RETRY_PORTAL_GENERATION",
              message: "Retry after Pack can save its local recovery state.",
              canResume: true,
            },
          },
          target,
        }),
      };
    }
  }

  const startedDownload = await startExtensionBrowserDownload(
    blobUrl,
    safeFiledReturnDownloadFilename(
      scope,
      artifactType,
      capturedFiledReturnsArtifactExtension(capturedDownloadRequest.dataUrl, artifactType),
    ),
  );
  if (!startedDownload.ok) {
    if (checkpointEnabled) {
      try {
        await clearFiledReturnsTargetDownloadAttempt(reviewScope, checkpointDeps);
      } catch {
        // Retaining the intent-only checkpoint is safer than hiding an uncertain cleanup.
      }
    }
    await revokeOffscreenBlobUrl(blobUrl);
    await closeOffscreenBlobDocument();
    return {
      ok: true,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: "captured-portal-request",
        flowStep: {
          ...triggerStep,
          state: "blocked",
          safeSignals: [
            ...triggerStep.safeSignals,
            ...capturedDownloadRequest.safeSignals,
            `${capturedDownloadSignalPrefix(target)}-extension-download-start-rejected`,
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            "Pack captured the filed-return file, but the browser rejected the extension-owned download.",
          userAction: {
            type: "ALLOW_MULTIPLE_DOWNLOADS",
            message:
              "Allow downloads for Pack in the browser, then retry the filed-return download.",
            canResume: true,
          },
        },
        target,
      }),
    };
  }

  const endLiveObservation = beginLiveFiledReturnsDownloadObservation(startedDownload.id);

  if (checkpointEnabled) {
    let downloadIdPersisted = false;
    try {
      downloadIdPersisted = await persistFiledReturnsTargetDownloadId(
        reviewScope,
        startedDownload.id,
        checkpointDeps,
      );
    } catch {
      downloadIdPersisted = false;
    }
    if (!downloadIdPersisted) {
      endLiveObservation();
      await revokeOffscreenBlobUrl(blobUrl);
      await closeOffscreenBlobDocument();
      const flowStep = withFiledReturnsDownloadDiagnostic({
        attemptClass: "captured-portal-request",
        flowStep: {
          ...triggerStep,
          state: "download-unconfirmed",
          safeSignals: [
            ...triggerStep.safeSignals,
            ...capturedDownloadRequest.safeSignals,
            `${capturedDownloadSignalPrefix(target)}-extension-download-started`,
            "filed-return-download-id-persist-failed",
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            "Pack may have started the captured filed-return download but could not save its exact browser download ID. Check browser Downloads before taking another action.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message: "Check browser Downloads, then cancel this target before starting again.",
            canResume: true,
          },
        },
        target,
      });
      let flowSummary: FiledReturnsFlowSummary | null = null;
      try {
        flowSummary = await persistFiledReturnsTargetReview(reviewScope, flowStep, checkpointDeps);
      } catch {
        // The intent checkpoint remains the fail-closed recovery source.
      }
      return {
        ok: true,
        flowStep,
        ...(flowSummary ? { flowSummary } : {}),
      };
    }
  }

  const observedDownload = await observeBrowserDownloadById(browser.downloads, startedDownload.id, {
    ...expectedDownloadForArtifact(artifactType),
    armedAt: checkpointEnabled ? downloadRequestedAt : armedAt,
    trustedDownloadIds: new Set([startedDownload.id]),
  }).finally(endLiveObservation);
  await revokeOffscreenBlobUrl(blobUrl);
  await closeOffscreenBlobDocument();
  return finalizeObservedSingleArtifactDownload({
    activePeriod,
    artifactType,
    attemptClass: "captured-portal-request",
    deps,
    observedDownload,
    scope,
    target,
    triggerStep: {
      ...triggerStep,
      safeSignals: [
        ...triggerStep.safeSignals,
        ...capturedDownloadRequest.safeSignals,
        `${capturedDownloadSignalPrefix(target)}-extension-download-started`,
      ],
      safeMessage: "Pack saved the captured filed-return file through the browser downloads API.",
    },
  });
}

async function startExtensionBrowserDownload(
  url: string,
  filename: string,
): Promise<{ ok: true; id: number } | { ok: false }> {
  try {
    const id = await browser.downloads.download({
      conflictAction: "uniquify",
      filename,
      saveAs: false,
      url,
    });
    return { ok: true, id };
  } catch {
    return { ok: false };
  }
}
