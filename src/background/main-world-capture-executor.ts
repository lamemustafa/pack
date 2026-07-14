import { browser } from "wxt/browser";
import type { FiledReturnsMainWorldCaptureRequest } from "../core/contracts";
import { withTimeout } from "./async-timeout";
import { capturePortalBlobDownloadWithDiagnostics } from "./main-world-blob-capture";
import {
  isCapturedDownloadRequest,
  isMainWorldCaptureOutcome,
  type MainWorldCaptureOutcome,
} from "./main-world-capture-contracts";

const MAIN_WORLD_CAPTURE_TIMEOUT_MS = 75_000;

export async function capturePortalBlobDownloadInMainWorld(
  tabId: number,
  request: FiledReturnsMainWorldCaptureRequest,
): Promise<MainWorldCaptureOutcome> {
  try {
    const timeoutMs = request.timeoutMs ?? MAIN_WORLD_CAPTURE_TIMEOUT_MS;
    const [injectionResult] = await withTimeout(
      browser.scripting.executeScript({
        args: [request],
        func: capturePortalBlobDownloadWithDiagnostics,
        target: { tabId },
        world: "MAIN",
      }),
      timeoutMs,
      "main-world-capture-timeout",
    );
    if (isMainWorldCaptureOutcome(injectionResult?.result)) return injectionResult.result;
    if (isCapturedDownloadRequest(injectionResult?.result)) {
      return { capturedDownloadRequest: injectionResult.result, safeFailureSignals: [] };
    }
    return {
      capturedDownloadRequest: null,
      safeFailureSignals: [`${request.signalPrefix}-main-world-capture-result-rejected`],
    };
  } catch {
    return {
      capturedDownloadRequest: null,
      safeFailureSignals: [`${request.signalPrefix}-main-world-capture-exception`],
    };
  }
}
