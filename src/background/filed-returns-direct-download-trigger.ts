import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import { toPortalReturnPeriod } from "../connectors/gst/filed-returns-return-period";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
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
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
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
  const response = await resolveDirectDownloadRequestOnce(deps, tabId, target);
  if (!response.ok) return response;
  if ("flowStep" in response) return response;
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
    safeFiledReturnDownloadFilename(scope),
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
  });
  const flowStep = explainDirectDownloadPromptIfNeeded(
    mergeFlowStepWithDownloadObservation(directTriggerStep, observedDownload),
  );
  if (deps.persistTargetReview !== false) {
    await persistFiledReturnsTargetReview(scope, flowStep, deps);
  }
  return {
    ok: true,
    flowStep,
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

function directDownloadActionMismatchResponse(activePeriod: string | null): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: [
        "filed-gstr3b-direct-download-action-mismatch",
        ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
      ],
      safeMessage:
        "Pack rejected a direct filed GSTR-3B PDF request because it did not match the current local action.",
    },
  };
}

function directDownloadOriginRejectedResponse(activePeriod: string | null): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: [
        "filed-gstr3b-direct-download-origin-rejected",
        ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
      ],
      safeMessage:
        "Pack rejected a direct filed GSTR-3B PDF request because the URL was not on a reviewed GST Portal origin.",
    },
  };
}

function directDownloadUrlMismatchResponse(activePeriod: string | null): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: [
        "filed-gstr3b-direct-download-url-mismatch",
        ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
      ],
      safeMessage:
        "Pack rejected a direct filed GSTR-3B PDF request because the GST Portal URL did not match the requested period and reviewed PDF endpoint.",
    },
  };
}

function directDownloadStartRejectedResponse(activePeriod: string | null): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: [
        "filed-gstr3b-direct-download-start-rejected",
        ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
      ],
      safeMessage:
        "Pack built a reviewed GST filed GSTR-3B PDF request, but the browser downloads API rejected the direct download. Pack did not fall back to the portal click because that opens the native Save dialog.",
    },
  };
}

function explainDirectDownloadPromptIfNeeded(step: PortalFlowStepResult): PortalFlowStepResult {
  if (
    step.state === "downloaded" ||
    !step.safeSignals.includes("filed-gstr3b-direct-download-started") ||
    (!step.safeSignals.includes("browser-download-not-observed") &&
      !step.safeSignals.includes("browser-download-interrupted"))
  ) {
    return step;
  }

  return {
    ...step,
    safeSignals: [...step.safeSignals, "browser-download-prompt-may-be-enabled"],
    safeMessage:
      "Pack started the direct browser download, but the browser did not finish it. If a native Save dialog appeared, press Save to complete this file, or turn off the browser setting that asks where to save each file before retrying.",
    userAction: {
      type: "ALLOW_MULTIPLE_DOWNLOADS",
      message:
        "Turn off the browser setting that asks where to save each file before downloading, then retry Pack.",
      canResume: true,
    },
  };
}

function isReviewedGstDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return GST_CONNECTOR_DESCRIPTOR.supportedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

function isExpectedFiledReturnDirectDownloadUrl(
  url: string,
  scope: FiledReturnsDownloadScope,
): boolean {
  const returnPeriod = toPortalReturnPeriod(scope.period, scope.financialYear);
  if (!returnPeriod) return false;

  try {
    const parsed = new URL(url);
    return (
      parsed.pathname === "/returns/auth/api/gstr3b/getgenpdf" &&
      parsed.searchParams.get("rtn_prd") === returnPeriod
    );
  } catch {
    return false;
  }
}
