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
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
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
    return withDirectDownloadDiagnostic(
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: FILED_RETURNS_SCOPE_ID,
          state: "blocked",
          safeSignals: ["filed-gstr3b-direct-download-artifact-rejected"],
          safeMessage:
            "Pack will not use the reviewed filed GSTR-3B direct PDF endpoint for a non-PDF artifact.",
        },
      },
      target,
    );
  }

  const response = await resolveDirectDownloadRequestOnce(deps, tabId, target);
  if (!response.ok) return response;
  if ("flowStep" in response) return withDirectDownloadDiagnostic(response, target);
  if ("downloadTrigger" in response) return directDownloadTriggerResponse(response, activePeriod);
  if (!("directDownloadRequest" in response)) return null;
  if (response.directDownloadRequest.actionId !== target.actionId) {
    return withDirectDownloadDiagnostic(directDownloadActionMismatchResponse(activePeriod), target);
  }
  if (!isReviewedGstDownloadUrl(response.directDownloadRequest.url)) {
    return withDirectDownloadDiagnostic(directDownloadOriginRejectedResponse(activePeriod), target);
  }
  if (!isExpectedFiledReturnDirectDownloadUrl(response.directDownloadRequest.url, scope)) {
    return withDirectDownloadDiagnostic(directDownloadUrlMismatchResponse(activePeriod), target);
  }

  const armedAt = new Date();
  const startedDownload = await startDirectBrowserDownload(
    response.directDownloadRequest.url,
    safeFiledReturnDownloadFilename(scope, "PDF"),
  );
  if (!startedDownload.ok) {
    return withDirectDownloadDiagnostic(directDownloadStartRejectedResponse(activePeriod), target);
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
  const flowStep = withFiledReturnsDownloadDiagnostic({
    attemptClass: "extension-direct",
    flowStep: explainDirectDownloadPromptIfNeeded(
      mergeFlowStepWithDownloadObservation(directTriggerStep, observedDownload),
    ),
    safeEvidence: observedDownload.safeEvidence,
    target,
  });
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

function withDirectDownloadDiagnostic(
  response: PackMessageResponse,
  target: FiledReturnsDownloadTarget,
): PackMessageResponse {
  if (!response.ok || !("flowStep" in response)) return response;
  return {
    ...response,
    flowStep: withFiledReturnsDownloadDiagnostic({
      attemptClass: "extension-direct",
      flowStep: response.flowStep,
      target,
    }),
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
