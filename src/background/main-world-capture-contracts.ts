import type { FiledReturnsCapturedDownloadRequest } from "../core/contracts";
import type { FiledReturnsArtifactExtension } from "../core/filed-returns-artifacts";

export interface MainWorldCaptureOutcome {
  capturedDownloadRequest: FiledReturnsCapturedDownloadRequest | null;
  chunkedCaptureRequest?: MainWorldChunkedCaptureRequest;
  safeFailureSignals: string[];
}

export interface MainWorldChunkedCaptureRequest {
  actionId: string;
  artifactExtension?: FiledReturnsArtifactExtension;
  chunkCount: number;
  safeSignals: string[];
  transferId: string;
}

export function isMainWorldCaptureOutcome(value: unknown): value is MainWorldCaptureOutcome {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (isCapturedDownloadRequest(record.capturedDownloadRequest) ||
      record.capturedDownloadRequest === null) &&
    (record.chunkedCaptureRequest === undefined ||
      isMainWorldChunkedCaptureRequest(record.chunkedCaptureRequest)) &&
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

function isMainWorldChunkedCaptureRequest(value: unknown): value is MainWorldChunkedCaptureRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.actionId === "string" &&
    isOptionalArtifactExtension(record.artifactExtension) &&
    typeof record.transferId === "string" &&
    typeof record.chunkCount === "number" &&
    Number.isInteger(record.chunkCount) &&
    record.chunkCount > 0 &&
    record.chunkCount <= 200 &&
    Array.isArray(record.safeSignals) &&
    record.safeSignals.every((signal) => typeof signal === "string")
  );
}

function isOptionalArtifactExtension(value: unknown): value is FiledReturnsArtifactExtension | undefined {
  return value === undefined || value === ".pdf" || value === ".xls" || value === ".xlsx";
}
