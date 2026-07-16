import type { FiledReturnsDownloadTarget } from "../../core/contracts";
import type { PackMessageResponse } from "../../core/messages";
import { filedReturnScopedSignal } from "./filed-returns-return-descriptors";

const TARGET_BOUND_PORTAL_CLICK_WAIT_MS = 120_000;

export function targetBoundPortalClickObservationTimeoutMs(): number {
  return TARGET_BOUND_PORTAL_CLICK_WAIT_MS;
}

export function shouldFallBackToPortalClick(response: PackMessageResponse): boolean {
  if (!response.ok || !("flowStep" in response)) return false;
  const signals = new Set(response.flowStep.safeSignals);
  return [
    "filed-gstr3b-download-trigger-ambiguous",
    "filed-gstr3b-direct-download-fetch-unavailable",
    "filed-gstr3b-direct-download-status-rejected",
    "filed-gstr3b-direct-download-non-pdf-response",
    "filed-gstr3b-direct-download-fetch-failed",
    "filed-gstr3b-direct-download-start-rejected",
  ].some((signal) => signals.has(signal));
}

export function shouldFallBackAfterCaptureFailure(
  response: PackMessageResponse,
  target: FiledReturnsDownloadTarget,
): boolean {
  if (target.forcePortalClick || !response.ok || !("flowStep" in response)) {
    return false;
  }
  const signals = new Set(response.flowStep.safeSignals);
  if (signals.has("filed-gstr1-excel-no-details-available")) return false;
  const signalPrefix = filedReturnScopedSignal(target.returnType, "");
  const scopedPrefix = signalPrefix.endsWith("-") ? signalPrefix.slice(0, -1) : signalPrefix;
  return [
    "filed-return-offscreen-blob-url-rejected",
    ...(target.returnType === "GSTR-2B" ? ["gstr2b-blob-capture-failed"] : []),
    `${scopedPrefix}-blob-capture-failed`,
    `${scopedPrefix}-captured-download-data-url-rejected`,
    `${scopedPrefix}-extension-download-start-rejected`,
    `${scopedPrefix}-main-world-capture-exception`,
    `${scopedPrefix}-main-world-capture-result-rejected`,
    `${scopedPrefix}-main-world-capture-timeout`,
  ].some((signal) => signals.has(signal));
}

export function withCaptureFallbackSignal(
  response: PackMessageResponse,
  target: FiledReturnsDownloadTarget,
): PackMessageResponse {
  if (!response.ok || !("flowStep" in response)) return response;
  return {
    ...response,
    flowStep: {
      ...response.flowStep,
      safeSignals: [
        ...response.flowStep.safeSignals,
        filedReturnScopedSignal(target.returnType, "capture-fallback-portal-click"),
      ],
    },
  };
}
