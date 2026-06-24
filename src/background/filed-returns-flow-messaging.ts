import type { FiledReturnsDownloadTarget } from "../core/contracts";
import type { PackMessage, PackMessageResponse } from "../core/messages";
import { ambiguousDownloadTriggerResponse } from "./filed-returns-flow-guards";

const FLOW_STEP_MESSAGE_RETRY_MS = 1_250;
const MAX_FLOW_STEP_MESSAGE_ATTEMPTS = 8;

export interface FiledReturnsFlowMessagingDeps {
  sendMessageToTabWithInjection: (
    tabId: number,
    message: Extract<
      PackMessage,
      {
        type: "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP" | "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD";
      }
    >,
  ) => Promise<PackMessageResponse>;
}

export async function runDownloadTriggerOnce(
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  target: FiledReturnsDownloadTarget,
): Promise<PackMessageResponse> {
  try {
    return await deps.sendMessageToTabWithInjection(tabId, {
      type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD",
      payload: target,
    });
  } catch {
    return ambiguousDownloadTriggerResponse();
  }
}

export async function runDownloadStepWithRetry(
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  message: Extract<PackMessage, { type: "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP" }>,
): Promise<PackMessageResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_FLOW_STEP_MESSAGE_ATTEMPTS; attempt += 1) {
    try {
      return await deps.sendMessageToTabWithInjection(tabId, message);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < MAX_FLOW_STEP_MESSAGE_ATTEMPTS - 1) {
        await delay(FLOW_STEP_MESSAGE_RETRY_MS);
      }
    }
  }

  return {
    ok: false,
    error:
      lastError instanceof Error
        ? lastError.message
        : "Pack could not reconnect to the GST tab after portal navigation.",
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
