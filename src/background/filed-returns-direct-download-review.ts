import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import { toPortalReturnPeriod } from "../connectors/gst/filed-returns-return-period";
import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";

export const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";

export function directDownloadActionMismatchResponse(
  activePeriod: string | null,
): PackMessageResponse {
  return blockedDirectDownloadResponse(
    activePeriod,
    "filed-gstr3b-direct-download-action-mismatch",
    "Pack rejected a direct filed GSTR-3B PDF request because it did not match the current local action.",
  );
}

export function directDownloadOriginRejectedResponse(
  activePeriod: string | null,
): PackMessageResponse {
  return blockedDirectDownloadResponse(
    activePeriod,
    "filed-gstr3b-direct-download-origin-rejected",
    "Pack rejected a direct filed GSTR-3B PDF request because the URL was not on a reviewed GST Portal origin.",
  );
}

export function directDownloadUrlMismatchResponse(
  activePeriod: string | null,
): PackMessageResponse {
  return blockedDirectDownloadResponse(
    activePeriod,
    "filed-gstr3b-direct-download-url-mismatch",
    "Pack rejected a direct filed GSTR-3B PDF request because the GST Portal URL did not match the requested period and reviewed PDF endpoint.",
  );
}

export function directDownloadStartRejectedResponse(
  activePeriod: string | null,
): PackMessageResponse {
  return blockedDirectDownloadResponse(
    activePeriod,
    "filed-gstr3b-direct-download-start-rejected",
    "Pack built a reviewed GST filed GSTR-3B PDF request, but the browser downloads API rejected the direct download.",
  );
}

export function explainDirectDownloadPromptIfNeeded(
  step: PortalFlowStepResult,
): PortalFlowStepResult {
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

export function isReviewedGstDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return GST_CONNECTOR_DESCRIPTOR.supportedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

export function isExpectedFiledReturnDirectDownloadUrl(
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

export function targetUrlSubstrings(scope: FiledReturnsDownloadScope): string[] {
  const returnPeriod = toPortalReturnPeriod(scope.period, scope.financialYear);
  return returnPeriod ? ["/returns/auth/api/gstr3b/getgenpdf", `rtn_prd=${returnPeriod}`] : [];
}

function blockedDirectDownloadResponse(
  activePeriod: string | null,
  signal: string,
  safeMessage: string,
): PackMessageResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: [
        signal,
        ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
      ],
      safeMessage,
    },
  };
}
