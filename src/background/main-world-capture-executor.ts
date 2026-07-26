import { browser } from "wxt/browser";
import type { FiledReturnsMainWorldCaptureRequest } from "../connectors/gst/filed-returns-contracts";
import { targetBoundNativeFilenameNonceForActionId } from "../connectors/gst/filed-returns-target-bound-download-candidate";
import { withTimeout } from "./async-timeout";
import { capturePortalBlobDownloadWithDiagnostics } from "../connectors/gst/main-world-blob-capture";
import {
  isMainWorldCaptureOutcome,
  type MainWorldCaptureOutcome,
} from "./main-world-capture-contracts";

const MAIN_WORLD_CAPTURE_TIMEOUT_MS = 75_000;
const MAIN_WORLD_CAPTURE_RESTORE_HEADROOM_MS = 2_000;
const MAIN_WORLD_CAPTURE_MAX_FAILURE_SIGNALS = 32;
const MAIN_WORLD_CAPTURE_SUCCESS_SUFFIXES = new Set([
  "portal-blob-captured",
  "native-blob-click-suppressed",
  "portal-data-url-captured",
  "native-data-click-suppressed",
  "main-world-capture",
  "native-window-open-suppressed",
  "portal-filename-observed",
]);
const MAIN_WORLD_CAPTURE_FAILURE_SUFFIXES = new Set([
  "main-world-capture-armed",
  "unbound-blob-ignored",
  "blob-zero-byte-rejected",
  "blob-oversized-rejected",
  "blob-content-type-rejected",
  "blob-bytes-accepted",
  "file-reader-result-rejected",
  "file-reader-error",
  "unbound-data-url-ignored",
  "data-url-observed",
  "data-url-rejected",
  "data-url-content-type-rejected",
  "unbound-blob-url-ignored",
  "blob-url-observed",
  "blob-url-fetch-unavailable",
  "blob-url-fetch-rejected",
  "blob-url-fetch-failed",
  "native-https-download-suppressed",
  "window-open-observed",
  "fetch-content-type-rejected",
  "fetch-artifact-response-observed",
  "xhr-content-type-rejected",
  "xhr-artifact-response-observed",
  "xhr-action-binding-ambiguous",
  "xhr-selection-closed-with-context",
  "xhr-selection-closed-without-context",
  "xhr-page-callback-bound-readystatechange",
  "xhr-page-callback-bound-load",
  "xhr-page-callback-bound-loadend",
  "create-object-url-observed",
  "create-object-url-oversized",
  "create-object-url-zero-byte",
  "unbound-create-object-url-ignored",
  "unbound-create-object-url-no-open-selection",
  "unbound-create-object-url-selection-open-no-context",
  "unbound-create-object-url-selection-open-invalid-context",
  "unbound-create-object-url-selection-open-valid-inactive-context",
  "target-bound-native-blob-click-delegated",
  "capture-control-not-found",
  "capture-control-ambiguous",
  "capture-control-not-actionable",
  "capture-control-artifact-mismatch",
  "capture-control-fingerprint-mismatch",
  "capture-target-binding-missing",
  "capture-target-binding-invalid",
  "capture-target-path-mismatch",
  "capture-target-evidence-conflict",
  "capture-target-identity-missing",
  "capture-target-identity-mismatch",
  "capture-control-click-threw",
  "capture-hook-install-failed",
  "main-world-capture-timeout",
]);
const MAIN_WORLD_CAPTURE_TERMINAL_FAILURE_SUFFIXES = new Set([
  "file-reader-result-rejected",
  "file-reader-error",
  "capture-control-not-found",
  "capture-control-ambiguous",
  "capture-control-not-actionable",
  "capture-control-artifact-mismatch",
  "capture-control-fingerprint-mismatch",
  "capture-target-binding-missing",
  "capture-target-binding-invalid",
  "capture-target-path-mismatch",
  "capture-target-evidence-conflict",
  "capture-target-identity-missing",
  "capture-target-identity-mismatch",
  "capture-control-click-threw",
  "capture-hook-install-failed",
  "target-bound-native-blob-click-delegated",
  "main-world-capture-timeout",
]);

export async function capturePortalBlobDownloadInMainWorld(
  tabId: number,
  request: FiledReturnsMainWorldCaptureRequest,
): Promise<MainWorldCaptureOutcome> {
  try {
    const timeoutMs = request.timeoutMs
      ? request.timeoutMs + MAIN_WORLD_CAPTURE_RESTORE_HEADROOM_MS
      : MAIN_WORLD_CAPTURE_TIMEOUT_MS;
    const result = await executeFunctionInMainWorld({
      argument: request,
      func: capturePortalBlobDownloadWithDiagnostics,
      tabId,
      timeoutMs,
      timeoutSignal: "main-world-capture-timeout",
    });
    const trustedOutcome = trustedMainWorldCaptureOutcome(request, result);
    if (trustedOutcome) return trustedOutcome;
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

async function executeFunctionInMainWorld<TArgument, TResult>({
  argument,
  func,
  tabId,
  timeoutMs,
  timeoutSignal,
}: {
  argument: TArgument;
  func: (argument: TArgument) => TResult | Promise<TResult>;
  tabId: number;
  timeoutMs: number;
  timeoutSignal: string;
}): Promise<TResult | undefined> {
  const [injectionResult] = await withTimeout(
    browser.scripting.executeScript({
      args: [argument],
      func,
      target: { tabId },
      world: "MAIN",
    }),
    timeoutMs,
    timeoutSignal,
  );
  return injectionResult?.result;
}

function trustedMainWorldCaptureOutcome(
  request: FiledReturnsMainWorldCaptureRequest,
  value: unknown,
): MainWorldCaptureOutcome | null {
  if (!isMainWorldCaptureOutcome(value)) return null;
  const captured = value.capturedDownloadRequest;
  if (captured) {
    if (
      captured.actionId !== request.actionId ||
      value.safeFailureSignals.length !== 0 ||
      value.targetBoundNativeDelegatedAt !== undefined
    )
      return null;
    return hasTrustedSuccessSignals(request.signalPrefix, captured.safeSignals) ? value : null;
  }
  const hasDelegatedSignal = value.safeFailureSignals.includes(
    `${request.signalPrefix}-target-bound-native-blob-click-delegated`,
  );
  if (hasDelegatedSignal !== Boolean(value.targetBoundNativeDelegatedAt)) return null;
  if (
    hasDelegatedSignal &&
    request.targetBoundNativeFilenameNonce !==
      targetBoundNativeFilenameNonceForActionId(request.actionId)
  ) {
    return null;
  }
  return hasTrustedFailureSignals(request, value.safeFailureSignals) ? value : null;
}

function hasTrustedSuccessSignals(signalPrefix: string, signals: readonly string[]): boolean {
  if (signals.length < 3 || signals.length > 5 || new Set(signals).size !== signals.length) {
    return false;
  }
  const suffixes = trustedSignalSuffixes(signalPrefix, signals);
  if (!suffixes || !suffixes.every((suffix) => MAIN_WORLD_CAPTURE_SUCCESS_SUFFIXES.has(suffix))) {
    return false;
  }
  const hasBlobPair =
    suffixes.includes("portal-blob-captured") && suffixes.includes("native-blob-click-suppressed");
  const hasDataPair =
    suffixes.includes("portal-data-url-captured") &&
    suffixes.includes("native-data-click-suppressed");
  return suffixes.includes("main-world-capture") && hasBlobPair !== hasDataPair;
}

function hasTrustedFailureSignals(
  request: FiledReturnsMainWorldCaptureRequest,
  signals: readonly string[],
): boolean {
  if (
    signals.length < 2 ||
    signals.length > MAIN_WORLD_CAPTURE_MAX_FAILURE_SIGNALS ||
    new Set(signals).size !== signals.length
  ) {
    return false;
  }
  const suffixes = trustedSignalSuffixes(request.signalPrefix, signals);
  return Boolean(
    suffixes &&
    suffixes[0] === "main-world-capture-armed" &&
    (!suffixes.includes("target-bound-native-blob-click-delegated") ||
      (request.targetBinding.returnType === "GSTR-3B" &&
        request.targetBinding.artifactType === "PDF")) &&
    suffixes.every((suffix) => MAIN_WORLD_CAPTURE_FAILURE_SUFFIXES.has(suffix)) &&
    suffixes.some((suffix) => MAIN_WORLD_CAPTURE_TERMINAL_FAILURE_SUFFIXES.has(suffix)),
  );
}

function trustedSignalSuffixes(signalPrefix: string, signals: readonly string[]): string[] | null {
  const prefix = `${signalPrefix}-`;
  if (!signalPrefix || signalPrefix.length > 32 || !/^[a-z][a-z0-9-]*$/.test(signalPrefix)) {
    return null;
  }
  const suffixes = signals.map((signal) =>
    signal.startsWith(prefix) ? signal.slice(prefix.length) : "",
  );
  return suffixes.every(Boolean) ? suffixes : null;
}
