import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsMainWorldCaptureRequest,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { filedReturnScopedSignal } from "../connectors/gst/filed-returns-return-descriptors";
import { isExpectedCapturedDataUrlForTarget } from "./captured-download-data-url";
import { downloadCapturedFiledReturnThroughExtension } from "./filed-returns-captured-extension-download";
import { gstr2bDialogFreeUnsupportedStep } from "./filed-returns-captured-portal-guard";
import { capturedDownloadRejected } from "./filed-returns-captured-rejected";
import { stageCapturedFiledReturnDownload } from "./filed-returns-captured-staging";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { capturePortalBlobDownloadInMainWorld } from "./main-world-capture-executor";
import {
  cancelPreparedTargetBoundGstr3bPortalDownload,
  prepareTargetBoundGstr3bPortalDownload,
  resolveTargetBoundGstr3bPortalDownload,
  trustedTargetBoundNativeBlobDelegatedAt,
  withoutUnverifiedCaptureSuccessSignals,
} from "./filed-returns-target-bound-portal-download";

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
  if (
    !mainWorldCaptureMatchesTarget({
      artifactType,
      request: mainWorldCaptureRequest,
      target,
    })
  ) {
    return capturedDownloadRejected(
      scope,
      target,
      filedReturnScopedSignal(target.returnType, "captured-download-target-mismatch"),
      "Pack rejected the filed-return capture request because it did not exactly match the active download target.",
    );
  }

  const targetBoundPreparation = await prepareTargetBoundGstr3bPortalDownload({
    armedAt,
    artifactType,
    deps,
    scope,
    target,
    triggerStep,
  });
  if (targetBoundPreparation.state === "blocked") return targetBoundPreparation.response;

  const captureRequest =
    targetBoundPreparation.state === "armed"
      ? {
          ...mainWorldCaptureRequest,
          targetBoundNativeFilenameNonce: targetBoundPreparation.filenameNonce,
        }
      : mainWorldCaptureRequest;
  const captureOutcome = await capturePortalBlobDownloadInMainWorld(tabId, captureRequest);
  const capturedDownloadRequest = captureOutcome.capturedDownloadRequest;
  if (capturedDownloadRequest && targetBoundPreparation.state === "armed") {
    await cancelPreparedTargetBoundGstr3bPortalDownload(targetBoundPreparation);
  }
  let safeFailureSignals = captureOutcome.safeFailureSignals;
  if (!capturedDownloadRequest) {
    if (targetBoundPreparation.state === "armed") {
      const delegatedAt = trustedTargetBoundNativeBlobDelegatedAt(
        safeFailureSignals,
        mainWorldCaptureRequest.signalPrefix,
        captureOutcome.targetBoundNativeDelegatedAt,
      );
      if (delegatedAt) {
        const targetBoundResult = await resolveTargetBoundGstr3bPortalDownload({
          activePeriod,
          artifactType,
          captureFailureSignals: safeFailureSignals,
          delegatedAt,
          deps,
          preparation: targetBoundPreparation,
          scope,
          target,
          triggerStep,
        });
        if (targetBoundResult.response) return targetBoundResult.response;
        safeFailureSignals = [...safeFailureSignals, ...targetBoundResult.additionalFailureSignals];
      } else {
        await cancelPreparedTargetBoundGstr3bPortalDownload(targetBoundPreparation);
      }
    }
    const captureFailureTriggerStep = withoutUnverifiedCaptureSuccessSignals(triggerStep, target);
    const postClickBlockedState = await inspectPostCaptureBlockedState(deps, tabId, target);
    if (postClickBlockedState) {
      return {
        ok: true,
        flowStep: withFiledReturnsDownloadDiagnostic({
          attemptClass: "captured-portal-request",
          flowStep: {
            ...postClickBlockedState,
            safeSignals: Array.from(
              new Set([
                ...captureFailureTriggerStep.safeSignals,
                ...safeFailureSignals,
                ...postClickBlockedState.safeSignals,
                ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
              ]),
            ),
          },
          target,
        }),
      };
    }
    const unsupportedStep = gstr2bDialogFreeUnsupportedStep({
      activePeriod,
      safeFailureSignals,
      scope,
      target,
      triggerStep: captureFailureTriggerStep,
    });
    if (unsupportedStep) return unsupportedStep;

    return {
      ok: true,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: "captured-portal-request",
        flowStep: {
          ...captureFailureTriggerStep,
          state: "blocked",
          safeSignals: [
            ...captureFailureTriggerStep.safeSignals,
            `${mainWorldCaptureRequest.signalPrefix}-blob-capture-failed`,
            ...safeFailureSignals,
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

function mainWorldCaptureMatchesTarget({
  artifactType,
  request,
  target,
}: {
  artifactType: FiledReturnsConcreteArtifactType;
  request: FiledReturnsMainWorldCaptureRequest;
  target: FiledReturnsDownloadTarget;
}): boolean {
  const targetArtifactType = target.artifactType ?? "PDF";
  const binding = request.targetBinding;
  if (!binding) return false;
  return (
    request.actionId === target.actionId &&
    binding.artifactType === artifactType &&
    binding.artifactType === targetArtifactType &&
    binding.financialYear === target.financialYear &&
    binding.period === target.period &&
    binding.returnType === target.returnType
  );
}

async function inspectPostCaptureBlockedState(
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  target: FiledReturnsDownloadTarget,
): Promise<PortalFlowStepResult | null> {
  if (target.returnType !== "GSTR-1" || target.artifactType !== "EXCEL") return null;
  try {
    const response = await deps.sendMessageToTabWithInjection(tabId, {
      type: "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3",
      payload: target,
    });
    if (
      response.ok &&
      "flowStep" in response &&
      response.flowStep.safeSignals.includes("filed-gstr1-excel-no-details-available")
    ) {
      return response.flowStep;
    }
  } catch {
    // Preserve the generic capture failure when the content script cannot inspect the dialog.
  }
  return null;
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
      filedReturnScopedSignal(target.returnType, "captured-download-action-mismatch"),
      "Pack rejected the captured filed-return file because it did not match the active download action.",
    );
  }

  if (!isExpectedCapturedDataUrlForTarget(capturedDownloadRequest.dataUrl, artifactType, target)) {
    return capturedDownloadRejected(
      scope,
      target,
      filedReturnScopedSignal(target.returnType, "captured-download-data-url-rejected"),
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
