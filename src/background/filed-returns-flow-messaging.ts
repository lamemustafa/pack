import type { FiledReturnsDownloadTarget } from "../core/contracts";
import type { PackMessage, PackMessageResponse } from "../core/messages";
import { ambiguousDownloadTriggerResponse } from "./filed-returns-flow-guards";

const FLOW_STEP_MESSAGE_RETRY_MS = 1_250;
const MAX_FLOW_STEP_MESSAGE_ATTEMPTS = 8;
const CONTENT_MESSAGE_TIMEOUT_MS = 60_000;

export interface FiledReturnsFlowMessagingDeps {
  sendMessageToTabWithInjection: (
    tabId: number,
    message: Extract<
      PackMessage,
      {
        type:
          | "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3"
          | "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3"
          | "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3"
          | "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3";
      }
    >,
  ) => Promise<PackMessageResponse>;
  storageKeys: {
    targetReview?: string;
  };
  now?: () => Date;
  persistTargetReview?: boolean;
  preferDirectDownload?: boolean;
  stageCapturedDownloads?: {
    bundleKind?: "full-fiscal-year" | "single-period";
    ledgerId: string;
  };
  timings?: {
    contentMessageTimeoutMs?: number;
  };
}

export async function runDownloadTriggerOnce(
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  target: FiledReturnsDownloadTarget,
): Promise<PackMessageResponse> {
  try {
    return await withContentMessageTimeout(
      deps.sendMessageToTabWithInjection(tabId, {
        type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
        payload: target,
      }),
      deps,
    );
  } catch {
    return ambiguousDownloadTriggerResponse();
  }
}

export async function resolveDirectDownloadRequestOnce(
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  target: FiledReturnsDownloadTarget,
): Promise<PackMessageResponse> {
  try {
    return await withContentMessageTimeout(
      deps.sendMessageToTabWithInjection(tabId, {
        type: "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3",
        payload: target,
      }),
      deps,
    );
  } catch {
    return ambiguousDownloadTriggerResponse();
  }
}

export async function runDownloadStepWithRetry(
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  message: Extract<PackMessage, { type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3" }>,
): Promise<PackMessageResponse> {
  for (let attempt = 0; attempt < MAX_FLOW_STEP_MESSAGE_ATTEMPTS; attempt += 1) {
    try {
      return await withContentMessageTimeout(
        deps.sendMessageToTabWithInjection(tabId, message),
        deps,
      );
    } catch (error) {
      if (isContentMessageTimeoutError(error)) break;
      if (attempt < MAX_FLOW_STEP_MESSAGE_ATTEMPTS - 1) {
        await delay(FLOW_STEP_MESSAGE_RETRY_MS);
      }
    }
  }

  return {
    ok: false,
    error: "CONTENT_SCRIPT_UNAVAILABLE",
  };
}

class ContentMessageTimeoutError extends Error {
  constructor() {
    super("CONTENT_MESSAGE_TIMEOUT");
  }
}

function withContentMessageTimeout(
  message: Promise<PackMessageResponse>,
  deps: FiledReturnsFlowMessagingDeps,
): Promise<PackMessageResponse> {
  const timeoutMs = deps.timings?.contentMessageTimeoutMs ?? CONTENT_MESSAGE_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new ContentMessageTimeoutError());
    }, timeoutMs);
  });

  return Promise.race([message, timeout]).finally(() => {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  });
}

function isContentMessageTimeoutError(error: unknown): boolean {
  return error instanceof ContentMessageTimeoutError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
