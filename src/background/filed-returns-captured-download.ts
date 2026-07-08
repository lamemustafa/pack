import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsMainWorldCaptureRequest,
  PortalFlowStepResult,
} from "../core/contracts";
import type { FiledReturnsConcreteArtifactType } from "../core/filed-returns-artifacts";
import type { PackMessageResponse } from "../core/messages";
import { isExpectedCapturedDataUrl } from "./captured-download-data-url";
import { downloadCapturedFiledReturnThroughExtension } from "./filed-returns-captured-extension-download";
import {
  gstr2bDialogFreeUnsupportedStep,
  suppressNativePortalDownloadsDuringCapture,
} from "./filed-returns-captured-portal-guard";
import { capturedDownloadRejected } from "./filed-returns-captured-rejected";
import {
  stageCapturedFiledReturnDownload,
  stageChunkedCapturedFiledReturnDownload,
} from "./filed-returns-captured-staging";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import {
  capturePortalBlobDownloadInMainWorld,
} from "./main-world-blob-capture";
import type { MainWorldChunkedCaptureRequest } from "./main-world-capture-contracts";

export async function startMainWorldCapturedFiledReturnDownload({
  activePeriod,
  armedAt,
  artifactType,
  deps,
  mainWorldCaptureRequest,
  scope,
  tabId,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  armedAt: Date;
  artifactType: FiledReturnsConcreteArtifactType;
  deps: FiledReturnsFlowMessagingDeps;
  mainWorldCaptureRequest: FiledReturnsMainWorldCaptureRequest;
  scope: FiledReturnsDownloadScope;
  tabId: number;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): Promise<PackMessageResponse> {
  if (mainWorldCaptureRequest.actionId !== target.actionId) {
    return capturedDownloadRejected(
      scope,
      target,
      "gstr2b-captured-download-action-mismatch",
      "Pack rejected the filed-return capture request because it did not match the active download action.",
    );
  }

  const nativeSuppression = suppressNativePortalDownloadsDuringCapture(scope, artifactType);
  let capturedDownloadRequest: FiledReturnsCapturedDownloadRequest | null = null;
  let chunkedCaptureRequest: MainWorldChunkedCaptureRequest | undefined;
  let safeFailureSignals: string[] = [];
  try {
    const captureOutcome = await capturePortalBlobDownloadInMainWorld(
      tabId,
      mainWorldCaptureRequest,
    );
    capturedDownloadRequest = captureOutcome.capturedDownloadRequest;
    chunkedCaptureRequest = captureOutcome.chunkedCaptureRequest;
    safeFailureSignals = captureOutcome.safeFailureSignals;
  } finally {
    nativeSuppression.stop();
  }
  const nativeSuppressionSignals = nativeSuppression.safeSignals();
  if (!capturedDownloadRequest && chunkedCaptureRequest && deps.stageCapturedDownloads) {
    if (nativeSuppressionSignals.length > 0) {
      chunkedCaptureRequest = {
        ...chunkedCaptureRequest,
        safeSignals: [...chunkedCaptureRequest.safeSignals, ...nativeSuppressionSignals],
      };
    }
    return stageChunkedCapturedFiledReturnDownload({
      activePeriod,
      artifactType,
      chunkedCaptureRequest,
      deps,
      scope,
      tabId,
      target,
      triggerStep,
    });
  }
  if (!capturedDownloadRequest) {
    const unsupportedStep = gstr2bDialogFreeUnsupportedStep({
      activePeriod,
      nativeSuppressionSignals,
      scope,
      target,
      triggerStep,
    });
    if (unsupportedStep) return unsupportedStep;

    return {
      ok: true,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: "captured-portal-request",
        flowStep: {
          ...triggerStep,
          state: "blocked",
          safeSignals: [
            ...triggerStep.safeSignals,
            `${mainWorldCaptureRequest.signalPrefix}-blob-capture-failed`,
            ...safeFailureSignals,
            ...nativeSuppressionSignals,
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            "Pack could not capture the portal-generated filed-return file without exposing the native Save dialog.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message:
              "Retry from the same GST Portal page. If the portal keeps blocking generation, use the portal download manually for this period.",
            canResume: true,
          },
        },
        target,
      }),
    };
  }
  if (nativeSuppressionSignals.length > 0) {
    capturedDownloadRequest = {
      ...capturedDownloadRequest,
      safeSignals: [...capturedDownloadRequest.safeSignals, ...nativeSuppressionSignals],
    };
  }

  return startCapturedFiledReturnDownload({
    activePeriod,
    armedAt,
    artifactType,
    capturedDownloadRequest,
    deps,
    scope,
    target,
    triggerStep,
  });
}

export async function startCapturedFiledReturnDownload({
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
  if (capturedDownloadRequest.actionId !== target.actionId) {
    return capturedDownloadRejected(
      scope,
      target,
      "gstr2b-captured-download-action-mismatch",
      "Pack rejected the captured filed-return file because it did not match the active download action.",
    );
  }

  if (!isExpectedCapturedDataUrl(capturedDownloadRequest.dataUrl, artifactType)) {
    return capturedDownloadRejected(
      scope,
      target,
      "gstr2b-captured-download-data-url-rejected",
      "Pack rejected the captured filed-return file because the generated file type did not match the requested artifact.",
    );
  }

  if (deps.stageCapturedDownloads) {
    return stageCapturedFiledReturnDownload({
      activePeriod,
      artifactType,
      capturedDownloadRequest,
      deps,
      scope,
      target,
      triggerStep,
    });
  }

  return downloadCapturedFiledReturnThroughExtension({
    activePeriod,
    armedAt,
    artifactType,
    capturedDownloadRequest,
    deps,
    scope,
    target,
    triggerStep,
  });
}
