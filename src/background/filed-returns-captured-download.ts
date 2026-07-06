import { browser } from "wxt/browser";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import type {
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import {
  filedReturnsArtifactMimeTypes,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import type { PackMessageResponse } from "../core/messages";
import {
  mergeFlowStepWithDownloadObservation,
  observeBrowserDownloadById,
} from "./download-observer";
import { expectedDownloadForScope } from "./filed-returns-download-expectations";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import {
  targetReviewScope,
  withArtifactDownloadMessage,
  withDownloadedArtifactSignal,
} from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";

const MAX_CAPTURED_DOWNLOAD_DATA_URL_LENGTH = 70 * 1024 * 1024;

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
      "gstr2b-captured-download-action-mismatch",
      "Pack rejected the captured GSTR-2B file because it did not match the active download action.",
    );
  }

  if (!isExpectedCapturedDataUrl(capturedDownloadRequest.dataUrl, artifactType)) {
    return capturedDownloadRejected(
      scope,
      "gstr2b-captured-download-data-url-rejected",
      "Pack rejected the captured GSTR-2B file because the generated file type did not match the requested artifact.",
    );
  }

  const startedDownload = await startExtensionBrowserDownload(
    capturedDownloadRequest.dataUrl,
    safeFiledReturnDownloadFilename(scope, artifactType),
  );
  if (!startedDownload.ok) {
    return {
      ok: true,
      flowStep: {
        ...triggerStep,
        state: "blocked",
        safeSignals: [
          ...triggerStep.safeSignals,
          "gstr2b-extension-download-start-rejected",
          ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
        ],
        safeMessage:
          "Pack captured the GSTR-2B file, but Brave rejected the extension-owned download.",
        userAction: {
          type: "ALLOW_MULTIPLE_DOWNLOADS",
          message: "Allow downloads for Pack in Brave, then retry the GSTR-2B download.",
          canResume: true,
        },
      },
    };
  }

  const observedDownload = await observeBrowserDownloadById(browser.downloads, startedDownload.id, {
    ...expectedDownloadForScope(scope, artifactType),
    armedAt,
    expectedUrlSubstrings: [],
    trustedDownloadIds: new Set([startedDownload.id]),
  });
  const flowStep = withArtifactDownloadMessage(
    withDownloadedArtifactSignal(
      mergeFlowStepWithDownloadObservation(
        {
          ...triggerStep,
          safeSignals: [
            ...triggerStep.safeSignals,
            "gstr2b-extension-download-started",
            ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
          ],
          safeMessage: "Pack saved the captured GSTR-2B file through the browser downloads API.",
        },
        observedDownload,
      ),
      artifactType,
    ),
    scope,
    artifactType,
  );
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

function capturedDownloadRejected(
  scope: FiledReturnsDownloadScope,
  safeSignal: string,
  safeMessage: string,
): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId(scope.returnType),
      state: "blocked",
      safeSignals: [safeSignal],
      safeMessage,
    },
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

function isExpectedCapturedDataUrl(
  dataUrl: string,
  artifactType: FiledReturnsConcreteArtifactType,
): boolean {
  if (!dataUrl.startsWith("data:")) return false;
  if (dataUrl.length > MAX_CAPTURED_DOWNLOAD_DATA_URL_LENGTH) return false;
  const metadataEnd = dataUrl.indexOf(",");
  if (metadataEnd <= 0) return false;
  const metadata = dataUrl.slice(0, Math.min(metadataEnd, 200)).toLowerCase();
  if (metadata.length === 0) return false;
  if (
    !filedReturnsArtifactMimeTypes(artifactType).some((mimeType) => metadata.includes(mimeType))
  ) {
    return false;
  }

  return artifactType === "PDF" ? hasPdfMagicBytes(dataUrl) : hasZipMagicBytes(dataUrl);
}

function hasPdfMagicBytes(dataUrl: string): boolean {
  return decodeDataUrlPrefix(dataUrl, 8)?.startsWith("%PDF-") ?? false;
}

function hasZipMagicBytes(dataUrl: string): boolean {
  return decodeDataUrlPrefix(dataUrl, 4)?.startsWith("PK\u0003\u0004") ?? false;
}

function decodeDataUrlPrefix(dataUrl: string, byteCount: number): string | null {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 0) return null;
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (metadata.includes(";base64")) {
    try {
      return globalThis.atob(payload.slice(0, Math.ceil((byteCount * 4) / 3) + 4));
    } catch {
      return null;
    }
  }
  try {
    return decodeURIComponent(payload.slice(0, byteCount * 3));
  } catch {
    return null;
  }
}
