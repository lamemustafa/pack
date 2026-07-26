import type { FiledReturnsCapturedDownloadRequest } from "../connectors/gst/filed-returns-contracts";

export interface MainWorldCaptureOutcome {
  capturedDownloadRequest: FiledReturnsCapturedDownloadRequest | null;
  safeFailureSignals: string[];
  targetBoundNativeDelegatedAt?: string;
}

export function isMainWorldCaptureOutcome(value: unknown): value is MainWorldCaptureOutcome {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) =>
      ["capturedDownloadRequest", "safeFailureSignals", "targetBoundNativeDelegatedAt"].includes(
        key,
      ),
    ) &&
    (isCapturedDownloadRequest(record.capturedDownloadRequest) ||
      record.capturedDownloadRequest === null) &&
    Array.isArray(record.safeFailureSignals) &&
    record.safeFailureSignals.every((signal) => typeof signal === "string") &&
    (record.targetBoundNativeDelegatedAt === undefined ||
      isCanonicalTimestamp(record.targetBoundNativeDelegatedAt))
  );
}

export function isCapturedDownloadRequest(
  value: unknown,
): value is FiledReturnsCapturedDownloadRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => ["actionId", "dataUrl", "safeSignals"].includes(key)) &&
    typeof record.actionId === "string" &&
    typeof record.dataUrl === "string" &&
    Array.isArray(record.safeSignals) &&
    record.safeSignals.every((signal) => typeof signal === "string")
  );
}

function isCanonicalTimestamp(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 40) return false;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === input;
}
