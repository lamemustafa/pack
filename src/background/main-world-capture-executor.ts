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
const MAIN_WORLD_CAPTURE_CHUNK_SIZE = 512 * 1024;

export async function capturePortalBlobDownloadInMainWorld(
  tabId: number,
  request: FiledReturnsMainWorldCaptureRequest,
  options: { chunkedTransfer?: boolean } = {},
): Promise<MainWorldCaptureOutcome> {
  const transferId = options.chunkedTransfer ? createTransferId() : null;
  const captureRequest: FiledReturnsMainWorldCaptureRequest = {
    ...request,
    ...(transferId ? { transferChunkSize: MAIN_WORLD_CAPTURE_CHUNK_SIZE, transferId } : {}),
  };
  if (transferId) {
    await prepareContentCaptureTransfer(tabId, { ...captureRequest, transferId }).catch(
      () => undefined,
    );
  }
  try {
    const timeoutMs = request.timeoutMs ?? MAIN_WORLD_CAPTURE_TIMEOUT_MS;
    const [injectionResult] = await withTimeout(
      browser.scripting.executeScript({
        args: [captureRequest],
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
      safeFailureSignals: [`${captureRequest.signalPrefix}-main-world-capture-result-rejected`],
    };
  } catch {
    return {
      capturedDownloadRequest: null,
      safeFailureSignals: [`${captureRequest.signalPrefix}-main-world-capture-exception`],
    };
  }
}

async function prepareContentCaptureTransfer(
  tabId: number,
  request: FiledReturnsMainWorldCaptureRequest & { transferId: string },
): Promise<void> {
  const response = await browser.tabs.sendMessage(tabId, {
    type: "PACK_CONTENT_PREPARE_MAIN_WORLD_CAPTURE_V3",
    payload: {
      actionId: request.actionId,
      transferId: request.transferId,
    },
  });
  if (
    typeof response !== "object" ||
    response === null ||
    (response as Record<string, unknown>).ok !== true
  ) {
    throw new Error("main-world-capture-transfer-not-prepared");
  }
}

function createTransferId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `transfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
