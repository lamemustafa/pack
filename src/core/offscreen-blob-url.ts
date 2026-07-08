import { isFiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import { isFiledReturnsReturnType } from "./filed-returns-return-types";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export const PACK_OFFSCREEN_BLOB_URL_TARGET = "pack-offscreen-blob-url";
export const PACK_OFFSCREEN_DATA_URL_MAX_LENGTH = 50 * 1024 * 1024;
export const PACK_OFFSCREEN_DATA_URL_CHUNK_MAX_LENGTH = 1024 * 1024;
export const PACK_OFFSCREEN_DATA_URL_MAX_CHUNKS = 200;

export interface PackOffscreenCreateBlobUrlMessage {
  type: "PACK_OFFSCREEN_CREATE_BLOB_URL";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    dataUrl: string;
  };
}

export interface PackOffscreenRevokeBlobUrlMessage {
  type: "PACK_OFFSCREEN_REVOKE_BLOB_URL";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    blobUrl: string;
  };
}

export interface PackOffscreenStageFiledReturnMessage {
  type: "PACK_OFFSCREEN_STAGE_FILED_RETURN";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    ledgerId: string;
    zipPath: string;
    dataUrl: string;
  };
}

export interface PackOffscreenStageFiledReturnChunkMessage {
  type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    transferId: string;
    ledgerId: string;
    zipPath: string;
    returnType: FiledReturnsReturnType;
    artifactType: FiledReturnsConcreteArtifactType;
    index: number;
    totalChunks: number;
    chunk: string;
  };
}

export interface PackOffscreenCreateFiledReturnZipMessage {
  type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    ledgerId: string;
  };
}

export interface PackOffscreenClearFiledReturnLedgerMessage {
  type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    ledgerId: string;
  };
}

export type PackOffscreenBlobUrlMessage =
  | PackOffscreenCreateBlobUrlMessage
  | PackOffscreenRevokeBlobUrlMessage
  | PackOffscreenStageFiledReturnMessage
  | PackOffscreenStageFiledReturnChunkMessage
  | PackOffscreenCreateFiledReturnZipMessage
  | PackOffscreenClearFiledReturnLedgerMessage;

export type PackOffscreenBlobUrlResponse =
  | {
      ok: true;
      requestId: string;
      blobUrl: string;
    }
  | {
      ok: true;
      requestId: string;
      revoked: true;
    }
  | {
      ok: true;
      requestId: string;
      staged: true;
      byteCountClass: "non-empty";
    }
  | {
      ok: true;
      requestId: string;
      blobUrl: string;
      zipEntryCount: number;
    }
  | {
      ok: true;
      requestId: string;
      cleared: true;
    }
  | {
      ok: false;
      requestId?: string;
      errorCategory:
        | "invalid-message"
        | "invalid-data-url"
        | "blob-url-failed"
        | "opfs-unavailable"
        | "stage-failed"
        | "stage-chunk-failed"
        | "clear-failed"
        | "zip-empty"
        | "zip-failed";
    };

export function isPackOffscreenBlobUrlMessage(
  input: unknown,
): input is PackOffscreenBlobUrlMessage {
  if (!isRecord(input)) return false;
  if (input.target !== PACK_OFFSCREEN_BLOB_URL_TARGET) return false;
  if (!isRecord(input.payload)) return false;
  if (!isBoundedString(input.payload.requestId, 8, 120)) return false;
  if (input.type === "PACK_OFFSCREEN_CREATE_BLOB_URL") {
    return isBoundedString(input.payload.dataUrl, 1, PACK_OFFSCREEN_DATA_URL_MAX_LENGTH);
  }
  if (input.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN") {
    return (
      isBoundedString(input.payload.ledgerId, 1, 120) &&
      isSafeZipPath(input.payload.zipPath) &&
      isBoundedString(input.payload.dataUrl, 1, PACK_OFFSCREEN_DATA_URL_MAX_LENGTH)
    );
  }
  if (input.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK") {
    return (
      isBoundedString(input.payload.transferId, 8, 120) &&
      isBoundedString(input.payload.ledgerId, 1, 120) &&
      isSafeZipPath(input.payload.zipPath) &&
      isFiledReturnsReturnType(input.payload.returnType) &&
      isFiledReturnsConcreteArtifactType(input.payload.artifactType) &&
      typeof input.payload.index === "number" &&
      Number.isInteger(input.payload.index) &&
      input.payload.index >= 0 &&
      typeof input.payload.totalChunks === "number" &&
      Number.isInteger(input.payload.totalChunks) &&
      input.payload.totalChunks > 0 &&
      input.payload.totalChunks <= PACK_OFFSCREEN_DATA_URL_MAX_CHUNKS &&
      input.payload.index < input.payload.totalChunks &&
      isBoundedString(input.payload.chunk, 1, PACK_OFFSCREEN_DATA_URL_CHUNK_MAX_LENGTH)
    );
  }
  if (input.type === "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP") {
    return isBoundedString(input.payload.ledgerId, 1, 120);
  }
  if (input.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER") {
    return isBoundedString(input.payload.ledgerId, 1, 120);
  }
  if (input.type === "PACK_OFFSCREEN_REVOKE_BLOB_URL") {
    return isBoundedString(input.payload.blobUrl, 1, 4096);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength;
}

function isSafeZipPath(value: unknown): value is string {
  return (
    isBoundedString(value, 1, 220) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  );
}
