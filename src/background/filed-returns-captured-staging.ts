import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { FiledReturnsConcreteArtifactType } from "../core/filed-returns-artifacts";
import type { PackMessageResponse } from "../core/messages";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import {
  targetReviewScope,
  withArtifactDownloadMessage,
  withDownloadedArtifactSignal,
} from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";
import { capturedDownloadSignalPrefix } from "./filed-returns-captured-signals";
import { stageOffscreenFiledReturn } from "./offscreen-blob-url";

export async function stageCapturedFiledReturnDownload({
  activePeriod,
  artifactType,
  capturedDownloadRequest,
  deps,
  scope,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  capturedDownloadRequest: FiledReturnsCapturedDownloadRequest;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): Promise<PackMessageResponse> {
  const staged = await stageOffscreenFiledReturn({
    dataUrl: capturedDownloadRequest.dataUrl,
    ledgerId: deps.stageCapturedDownloads?.ledgerId ?? "unknown-ledger",
    zipPath: safeFiledReturnDownloadFilename(scope, artifactType),
  });

  if (staged !== "staged") {
    return {
      ok: true,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: "captured-portal-request",
        flowStep: {
          ...triggerStep,
          state: "blocked",
          safeSignals: [
            ...triggerStep.safeSignals,
            "full-fiscal-year-opfs-stage-failed",
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            "Pack captured the filed-return file, but could not stage it for the fiscal-year zip.",
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

  const flowStep = withFiledReturnsDownloadDiagnostic({
    attemptClass: "captured-portal-request",
    flowStep: withArtifactDownloadMessage(
      withDownloadedArtifactSignal(
        {
          ...triggerStep,
          state: "downloaded",
          safeSignals: [
            ...triggerStep.safeSignals,
            `${capturedDownloadSignalPrefix(target)}-full-fiscal-year-zip-staged`,
            "full-fiscal-year-opfs-staged",
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage: "Pack staged the captured filed-return file for a single fiscal-year zip.",
        },
        artifactType,
      ),
      scope,
      artifactType,
    ),
    safeEvidence: {
      urlClass: "data",
      mimeClass: artifactType === "PDF" ? "pdf" : "spreadsheet",
      byteCountClass: "non-empty",
    },
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
