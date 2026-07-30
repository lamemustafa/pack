import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { delay } from "../core/time";
import type { PackMessage, PackMessageResponse } from "../connectors/gst/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  contentScriptUnavailableResponse,
  normaliseContentScriptMessageResponse,
} from "./content-script-message-response";
import { ambiguousDownloadTriggerResponse } from "./filed-returns-flow-guards";
import { isValidFiledReturnsDownloadDiagnosticState } from "./filed-returns-download-diagnostic-state";

const FLOW_STEP_MESSAGE_RETRY_MS = 1_250;
const MAX_FLOW_STEP_MESSAGE_ATTEMPTS = 8;
const CONTENT_MESSAGE_TIMEOUT_MS = 60_000;
const FLOW_STEP_STATES = new Set<PortalFlowStepResult["state"]>([
  "blocked",
  "candidate-not-found",
  "clicked",
  "download-unconfirmed",
  "downloaded",
  "login-required",
  "partial",
  "ready",
  "unsupported-page",
  "user-action-required",
]);
const USER_ACTION_TYPES = new Set<NonNullable<PortalFlowStepResult["userAction"]>["type"]>([
  "ALLOW_MULTIPLE_DOWNLOADS",
  "COMPLETE_CAPTCHA",
  "COMPLETE_OTP",
  "LOGIN",
  "NAVIGATE_TO_SUPPORTED_PAGE",
  "RETRY_PORTAL_GENERATION",
  "WAIT_FOR_PORTAL_AVAILABILITY",
]);

export interface FiledReturnsFlowMessagingDeps {
  sendMessageToTabWithInjection: (
    tabId: number,
    message: Extract<
      PackMessage,
      {
        type:
          | "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3"
          | "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3"
          | "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34"
          | "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3";
      }
    >,
  ) => Promise<PackMessageResponse>;
  storageKeys: {
    completion?: string;
    targetReview?: string;
  };
  now?: () => Date;
  portalTabIncognito?: boolean;
  persistTargetReview?: boolean;
  stageCapturedDownloads?: {
    bundleKind?: "full-fiscal-year" | "single-period";
    ledgerId: string;
  };
  timings?: {
    contentMessageTimeoutMs?: number;
    targetBoundPortalDownloadWaitMs?: number;
  };
}

export async function runDownloadTriggerOnce(
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  target: FiledReturnsDownloadTarget,
): Promise<PackMessageResponse> {
  try {
    return normaliseContentScriptMessageResponse(
      await withContentMessageTimeout(
        deps.sendMessageToTabWithInjection(tabId, {
          type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3",
          payload: target,
        }),
        deps,
      ),
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
      const response = normaliseContentScriptMessageResponse(
        await withContentMessageTimeout(deps.sendMessageToTabWithInjection(tabId, message), deps),
      );
      return isRunDownloadStepResponse(response, message.payload)
        ? response
        : contentScriptUnavailableResponse("empty-response");
    } catch (error) {
      if (isContentMessageTimeoutError(error)) break;
      if (attempt < MAX_FLOW_STEP_MESSAGE_ATTEMPTS - 1) {
        await delay(FLOW_STEP_MESSAGE_RETRY_MS);
      }
    }
  }

  return contentScriptUnavailableResponse("unreachable");
}

function isRunDownloadStepResponse(
  input: unknown,
  scope: FiledReturnsDownloadScope,
): input is Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }> {
  if (!input || typeof input !== "object" || !("ok" in input) || input.ok !== true) return false;
  if (!("flowStep" in input) || !input.flowStep || typeof input.flowStep !== "object") return false;
  const step = input.flowStep;
  return (
    hasOnlyKeys(step, [
      "connectorId",
      "downloadDiagnostic",
      "downloadDiagnostics",
      "safeMessage",
      "safeSignals",
      "scopeId",
      "state",
      "userAction",
    ]) &&
    "connectorId" in step &&
    step.connectorId === "gst" &&
    "scopeId" in step &&
    step.scopeId === filedReturnScopeId(scope.returnType) &&
    "state" in step &&
    typeof step.state === "string" &&
    FLOW_STEP_STATES.has(step.state as PortalFlowStepResult["state"]) &&
    "safeSignals" in step &&
    isSafeSignalList(step.safeSignals) &&
    "safeMessage" in step &&
    typeof step.safeMessage === "string" &&
    step.safeMessage.length > 0 &&
    step.safeMessage.length <= 500 &&
    isValidUserAction("userAction" in step ? step.userAction : undefined) &&
    isValidFlowStepDiagnostics(step, scope)
  );
}

function isValidFlowStepDiagnostics(step: object, scope: FiledReturnsDownloadScope): boolean {
  return isValidFiledReturnsDownloadDiagnosticState(
    {
      ...(step && "downloadDiagnostic" in step
        ? { downloadDiagnostic: step.downloadDiagnostic }
        : {}),
      ...(step && "downloadDiagnostics" in step
        ? { downloadDiagnostics: step.downloadDiagnostics }
        : {}),
    },
    scope,
  );
}

function isSafeSignalList(input: unknown): input is string[] {
  // Portal steps may repeat a bounded safe token across transient snapshots.
  // Durable persistence performs its own stricter canonical signal validation.
  return (
    Array.isArray(input) &&
    input.length <= 32 &&
    input.every(
      (signal) =>
        typeof signal === "string" &&
        signal.length > 0 &&
        signal.length <= 120 &&
        /^[A-Za-z0-9:._-]+$/.test(signal),
    )
  );
}

function isValidUserAction(input: unknown): boolean {
  if (input === undefined) return true;
  if (!input || typeof input !== "object") return false;
  if (!hasOnlyKeys(input, ["canResume", "message", "type"])) return false;
  return (
    "canResume" in input &&
    typeof input.canResume === "boolean" &&
    "message" in input &&
    typeof input.message === "string" &&
    input.message.length > 0 &&
    input.message.length <= 500 &&
    "type" in input &&
    typeof input.type === "string" &&
    USER_ACTION_TYPES.has(input.type as NonNullable<PortalFlowStepResult["userAction"]>["type"])
  );
}

function hasOnlyKeys(input: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(input).every((key) => allowed.has(key));
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
