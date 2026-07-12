import type { FiledReturnsDownloadTarget } from "../../core/contracts";
import type { PackMessageResponse } from "../../core/messages";

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
  if (target.returnType !== "GSTR-3B" || !response.ok || !("flowStep" in response)) return false;
  const signals = new Set(response.flowStep.safeSignals);
  return [
    "filed-return-offscreen-blob-url-rejected",
    "filed-gstr3b-blob-capture-failed",
    "filed-gstr3b-captured-download-data-url-rejected",
    "filed-gstr3b-extension-download-start-rejected",
    "filed-gstr3b-main-world-capture-exception",
    "filed-gstr3b-main-world-capture-result-rejected",
    "filed-gstr3b-main-world-capture-timeout",
  ].some((signal) => signals.has(signal));
}

export function withCaptureFallbackSignal(response: PackMessageResponse): PackMessageResponse {
  if (!response.ok || !("flowStep" in response)) return response;
  return {
    ...response,
    flowStep: {
      ...response.flowStep,
      safeSignals: [...response.flowStep.safeSignals, "filed-gstr3b-capture-fallback-portal-click"],
    },
  };
}
