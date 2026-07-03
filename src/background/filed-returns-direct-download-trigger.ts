import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import {
  mergeFlowStepWithDownloadObservation,
  observeBrowserDownloadById,
} from "./download-observer";
import {
  type FiledReturnsFlowMessagingDeps,
  resolveDirectDownloadRequestOnce,
} from "./filed-returns-flow-messaging";
import {
  FILED_RETURNS_SCOPE_ID,
  directDownloadActionMismatchResponse,
  directDownloadOriginRejectedResponse,
  directDownloadStartRejectedResponse,
  directDownloadUrlMismatchResponse,
  explainDirectDownloadPromptIfNeeded,
  isExpectedFiledReturnDirectDownloadUrl,
  isReviewedGstDownloadUrl,
  targetUrlSubstrings,
} from "./filed-returns-direct-download-review";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";

const EXPECTED_FILED_RETURN_DOWNLOAD = {
  expectedFileExtensions: [],
  expectedMimeTypes: ["application/pdf"],
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

export async function triggerDirectFiledReturnDownload({
  activePeriod,
  deps,
  scope,
  tabId,
  target,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
  target: FiledReturnsDownloadTarget;
}): Promise<PackMessageResponse | null> {
  if (target.artifactType && target.artifactType !== "PDF") {
    return {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "blocked",
        safeSignals: ["filed-gstr3b-direct-download-artifact-rejected"],
        safeMessage:
          "Pack will not use the reviewed filed GSTR-3B direct PDF endpoint for a non-PDF artifact.",
      },
    };
  }

  const response = await resolveDirectDownloadRequestOnce(deps, tabId, target);
  if (!response.ok) return response;
  if ("flowStep" in response) return response;
  if ("downloadTrigger" in response) return directDownloadTriggerResponse(response, activePeriod);
  if (!("directDownloadRequest" in response)) return null;
  if (response.directDownloadRequest.actionId !== target.actionId) {
    return directDownloadActionMismatchResponse(activePeriod);
  }
  if (!isReviewedGstDownloadUrl(response.directDownloadRequest.url)) {
    return directDownloadOriginRejectedResponse(activePeriod);
  }
  if (!isExpectedFiledReturnDirectDownloadUrl(response.directDownloadRequest.url, scope)) {
    return directDownloadUrlMismatchResponse(activePeriod);
  }

  const armedAt = new Date();
  const startedDownload = await startDirectBrowserDownload(
    response.directDownloadRequest.url,
    safeFiledReturnDownloadFilename(scope, "PDF"),
  );
  if (!startedDownload.ok) {
    return directDownloadStartRejectedResponse(activePeriod);
  }

  const directTriggerStep: PortalFlowStepResult = {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "clicked",
    safeSignals: [
      "filed-gstr3b-direct-download-started",
      ...response.directDownloadRequest.safeSignals,
      ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
    ],
    safeMessage: "Pack started the filed GSTR-3B PDF download through the browser downloads API.",
  };

  const observedDownload = await observeBrowserDownloadById(browser.downloads, startedDownload.id, {
    ...EXPECTED_FILED_RETURN_DOWNLOAD,
    armedAt,
    expectedUrlSubstrings: targetUrlSubstrings(scope),
    trustedDownloadIds: new Set([startedDownload.id]),
  });
  const flowStep = explainDirectDownloadPromptIfNeeded(
    mergeFlowStepWithDownloadObservation(directTriggerStep, observedDownload),
  );
  let flowSummary: FiledReturnsFlowSummary | null = null;
  if (deps.persistTargetReview !== false) {
    flowSummary = await persistFiledReturnsTargetReview(scope, flowStep, deps);
  }
  return {
    ok: true,
    flowStep,
    ...(flowSummary ? { flowSummary } : {}),
    ...(response.observation ? { observation: response.observation } : {}),
  };
}

function directDownloadTriggerResponse(
  response: Extract<PackMessageResponse, { ok: true; downloadTrigger: PortalFlowStepResult }>,
  activePeriod: string | null,
): PackMessageResponse | null {
  if (response.downloadTrigger.state === "candidate-not-found") return null;
  return {
    ok: true,
    flowStep: {
      ...response.downloadTrigger,
      safeSignals: [
        ...response.downloadTrigger.safeSignals,
        ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
      ],
    },
    ...(response.observation ? { observation: response.observation } : {}),
  };
}

async function startDirectBrowserDownload(
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
