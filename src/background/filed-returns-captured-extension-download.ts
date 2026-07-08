import { browser } from "wxt/browser";
import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { FiledReturnsConcreteArtifactType } from "../core/filed-returns-artifacts";
import type { PackMessageResponse } from "../core/messages";
import { capturedFiledReturnsArtifactExtension } from "./captured-download-data-url";
import {
  mergeFlowStepWithDownloadObservation,
  observeBrowserDownloadById,
} from "./download-observer";
import { capturedDownloadSignalPrefix } from "./filed-returns-captured-signals";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { expectedDownloadForScope } from "./filed-returns-download-expectations";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import {
  targetReviewScope,
  withArtifactDownloadMessage,
  withDownloadedArtifactSignal,
} from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";
import {
  closeOffscreenBlobDocument,
  createOffscreenBlobUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";

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

  const startedDownload = await startExtensionBrowserDownload(
    blobUrl,
    safeFiledReturnDownloadFilename(
      scope,
      artifactType,
      capturedFiledReturnsArtifactExtension(capturedDownloadRequest.dataUrl, artifactType),
    ),
  );
  if (!startedDownload.ok) {
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
            "gstr2b-extension-download-start-rejected",
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            "Pack captured the filed-return file, but Brave rejected the extension-owned download.",
          userAction: {
            type: "ALLOW_MULTIPLE_DOWNLOADS",
            message: "Allow downloads for Pack in Brave, then retry the filed-return download.",
            canResume: true,
          },
        },
        target,
      }),
    };
  }

  const observedDownload = await observeBrowserDownloadById(browser.downloads, startedDownload.id, {
    ...expectedDownloadForScope(scope, artifactType),
    armedAt,
    expectedUrlSubstrings: [],
    trustedDownloadIds: new Set([startedDownload.id]),
  });
  await revokeOffscreenBlobUrl(blobUrl);
  await closeOffscreenBlobDocument();

  const flowStep = withFiledReturnsDownloadDiagnostic({
    attemptClass: "captured-portal-request",
    flowStep: withArtifactDownloadMessage(
      withDownloadedArtifactSignal(
        mergeFlowStepWithDownloadObservation(
          {
            ...triggerStep,
            safeSignals: [
              ...triggerStep.safeSignals,
              ...capturedDownloadRequest.safeSignals,
              `${capturedDownloadSignalPrefix(target)}-extension-download-started`,
              ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
            ],
            safeMessage:
              "Pack saved the captured filed-return file through the browser downloads API.",
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
  let flowSummary: FiledReturnsFlowSummary | null = null;
  if (deps.persistTargetReview !== false) {
    flowSummary = await persistFiledReturnsTargetReview(
      targetReviewScope(scope, artifactType),
      flowStep,
      deps,
    );
  }
  return {
    ok: true,
    flowStep,
    ...(flowSummary ? { flowSummary } : {}),
  };
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
