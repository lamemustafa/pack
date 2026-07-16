import type { FiledReturnsCapturedDownloadRequest } from "../core/contracts";

export interface MainWorldCaptureOutcome {
  capturedDownloadRequest: FiledReturnsCapturedDownloadRequest | null;
  safeFailureSignals: string[];
}

export function isMainWorldCaptureOutcome(value: unknown): value is MainWorldCaptureOutcome {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (isCapturedDownloadRequest(record.capturedDownloadRequest) ||
      record.capturedDownloadRequest === null) &&
    Array.isArray(record.safeFailureSignals) &&
    record.safeFailureSignals.every((signal) => typeof signal === "string")
  );
}

export function isCapturedDownloadRequest(
  value: unknown,
): value is FiledReturnsCapturedDownloadRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.actionId === "string" &&
    typeof record.dataUrl === "string" &&
    Array.isArray(record.safeSignals) &&
    record.safeSignals.every((signal) => typeof signal === "string")
  );
}
