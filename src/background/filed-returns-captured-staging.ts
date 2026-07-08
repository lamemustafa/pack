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
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { safeFiledReturnZipEntryPath } from "./filed-returns-download-filename";
import { capturedFiledReturnsArtifactExtension } from "./captured-download-data-url";
import {
  targetReviewScope,
  withArtifactDownloadMessage,
  withDownloadedArtifactSignal,
} from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";
import { capturedDownloadSignalPrefix } from "./filed-returns-captured-signals";
import {
  type OffscreenFiledReturnStageResult,
  stageOffscreenFiledReturn,
  stageOffscreenFiledReturnChunk,
} from "./offscreen-blob-url";
import type { MainWorldChunkedCaptureRequest } from "./main-world-capture-contracts";

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
  const bundleKind = deps.stageCapturedDownloads?.bundleKind ?? "full-fiscal-year";
  const signalPrefix = bundleKind === "single-period" ? "single-period" : "full-fiscal-year";
  const staged = await stageOffscreenFiledReturn({
    artifactType,
    dataUrl: capturedDownloadRequest.dataUrl,
    ledgerId: deps.stageCapturedDownloads?.ledgerId ?? "unknown-ledger",
    returnType: target.returnType,
    zipPath: safeFiledReturnZipEntryPath(
      scope,
      artifactType,
      capturedFiledReturnsArtifactExtension(capturedDownloadRequest.dataUrl, artifactType),
    ),
  });

  if (staged.status !== "staged") {
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
            `${signalPrefix}-opfs-stage-failed`,
            ...offscreenStageErrorSignals(signalPrefix, staged),
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
            ...capturedDownloadRequest.safeSignals,
            `${capturedDownloadSignalPrefix(target)}-${signalPrefix}-zip-staged`,
            `${signalPrefix}-opfs-staged`,
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            bundleKind === "single-period"
              ? "Pack staged the captured filed-return file for a single local zip."
              : "Pack staged the captured filed-return file for a single fiscal-year zip.",
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

export async function stageChunkedCapturedFiledReturnDownload({
  activePeriod,
  artifactType,
  chunkedCaptureRequest,
  deps,
  scope,
  tabId,
  target,
  triggerStep,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  chunkedCaptureRequest: MainWorldChunkedCaptureRequest;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
  target: FiledReturnsDownloadTarget;
  triggerStep: PortalFlowStepResult;
}): Promise<PackMessageResponse> {
  const bundleKind = deps.stageCapturedDownloads?.bundleKind ?? "full-fiscal-year";
  const signalPrefix = bundleKind === "single-period" ? "single-period" : "full-fiscal-year";
  const ledgerId = deps.stageCapturedDownloads?.ledgerId ?? "unknown-ledger";
  const zipPath = safeFiledReturnZipEntryPath(scope, artifactType);

  let staged: OffscreenFiledReturnStageResult = { status: "failed" };
  for (let index = 0; index < chunkedCaptureRequest.chunkCount; index += 1) {
    const chunkResponse = await browser.tabs.sendMessage(tabId, {
      type: "PACK_CONTENT_TAKE_MAIN_WORLD_CAPTURE_CHUNK_V3",
      payload: {
        actionId: chunkedCaptureRequest.actionId,
        index,
        transferId: chunkedCaptureRequest.transferId,
      },
    });
    if (!isChunkResponse(chunkResponse)) {
      staged = { status: "failed" };
      break;
    }
    staged = await stageOffscreenFiledReturnChunk({
      chunk: chunkResponse.mainWorldCaptureChunk,
      index,
      ledgerId,
      returnType: target.returnType,
      artifactType,
      totalChunks: chunkedCaptureRequest.chunkCount,
      transferId: chunkedCaptureRequest.transferId,
      zipPath,
    });
    if (staged.status !== "staged") break;
  }

  await browser.tabs
    .sendMessage(tabId, {
      type: "PACK_CONTENT_CLEAR_MAIN_WORLD_CAPTURE_V3",
      payload: {
        actionId: chunkedCaptureRequest.actionId,
        transferId: chunkedCaptureRequest.transferId,
      },
    })
    .catch(() => undefined);

  if (staged.status !== "staged") {
    return {
      ok: true,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: "captured-portal-request",
        flowStep: {
          ...triggerStep,
          state: "blocked",
          safeSignals: [
            ...triggerStep.safeSignals,
            ...chunkedCaptureRequest.safeSignals,
            `${signalPrefix}-opfs-chunk-stage-failed`,
            ...offscreenStageErrorSignals(signalPrefix, staged),
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            "Pack captured the filed-return file in chunks, but could not stage it for the local zip.",
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
            ...chunkedCaptureRequest.safeSignals,
            `${capturedDownloadSignalPrefix(target)}-${signalPrefix}-zip-staged`,
            `${signalPrefix}-opfs-staged`,
            `${signalPrefix}-opfs-chunk-staged`,
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage:
            bundleKind === "single-period"
              ? "Pack staged the captured filed-return file for a single local zip."
              : "Pack staged the captured filed-return file for a single fiscal-year zip.",
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

function offscreenStageErrorSignals(
  signalPrefix: string,
  staged: OffscreenFiledReturnStageResult,
): string[] {
  return staged.status === "failed" && staged.errorCategory
    ? [`${signalPrefix}-opfs-stage-error:${staged.errorCategory}`]
    : [];
}

function isChunkResponse(response: unknown): response is {
  ok: true;
  mainWorldCaptureChunk: string;
} {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return record.ok === true && typeof record.mainWorldCaptureChunk === "string";
}
