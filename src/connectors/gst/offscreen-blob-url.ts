import { isFiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import { isFiledReturnsReturnType } from "./filed-returns-return-types";
import type { FiledReturnsConcreteArtifactType } from "./filed-returns-artifacts";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import { isFiledReturnsFinancialYear } from "./filed-returns-scope";
import type { FiledReturnsSummaryPlanEntry } from "./filed-returns-summary-sheet";

export const PACK_OFFSCREEN_BLOB_URL_TARGET = "pack-offscreen-blob-url";
export const PACK_OFFSCREEN_DATA_URL_MAX_LENGTH = 50 * 1024 * 1024;

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
    returnType: FiledReturnsReturnType;
    artifactType: FiledReturnsConcreteArtifactType;
    dataUrl: string;
  };
}

export interface PackOffscreenCreateFiledReturnZipMessage {
  type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    ledgerId: string;
    expectedReturnType: FiledReturnsReturnType;
    expectedEntryCount: number;
    expectedEntries: PackOffscreenFiledReturnZipExpectedEntry[];
    summaryPlan?: FiledReturnsSummaryPlanEntry[];
  };
}

export interface PackOffscreenFiledReturnZipExpectedEntry {
  artifactType: FiledReturnsConcreteArtifactType;
  entryNames: string[];
}

export interface PackOffscreenClearFiledReturnLedgerMessage {
  type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
    ledgerId: string;
  };
}

export interface PackOffscreenClearAllFiledReturnLedgersMessage {
  type: "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS";
  target: typeof PACK_OFFSCREEN_BLOB_URL_TARGET;
  payload: {
    requestId: string;
  };
}

export type PackOffscreenBlobUrlMessage =
  | PackOffscreenCreateBlobUrlMessage
  | PackOffscreenRevokeBlobUrlMessage
  | PackOffscreenStageFiledReturnMessage
  | PackOffscreenCreateFiledReturnZipMessage
  | PackOffscreenClearFiledReturnLedgerMessage
  | PackOffscreenClearAllFiledReturnLedgersMessage;

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
      byteCount: number;
      artifactType: FiledReturnsConcreteArtifactType;
      ledgerId: string;
      returnType: FiledReturnsReturnType;
      zipPath: string;
    }
  | {
      ok: true;
      requestId: string;
      blobUrl: string;
      zipEntryCount: number;
      artifactEntryCount: number;
      summaryEntryCount: 0 | 2;
      summary?: PackOffscreenFiledReturnSummaryResult;
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
        | "clear-failed"
        | "zip-invalid-entry"
        | "zip-empty"
        | "zip-too-large"
        | "zip-failed";
    };

export type PackOffscreenFiledReturnSummaryResult =
  | {
      status: "included";
      outcomeOnly: boolean;
      parsedPeriodCount: number;
      rowCount: number;
    }
  | {
      status: "failed";
      reasonCategory: "generation-failed" | "too-large";
    };

export function isPackOffscreenBlobUrlMessageShape(
  input: unknown,
): input is PackOffscreenBlobUrlMessage {
  if (!isRecord(input)) return false;
  if (input.target !== PACK_OFFSCREEN_BLOB_URL_TARGET) return false;
  if (!isRecord(input.payload)) return false;
  if (!isBoundedString(input.payload.requestId, 8, 120)) return false;
  if (input.type === "PACK_OFFSCREEN_CREATE_BLOB_URL") {
    return (
      hasOnlyKeys(input.payload, ["dataUrl", "requestId"]) &&
      isBoundedString(input.payload.dataUrl, 1, PACK_OFFSCREEN_DATA_URL_MAX_LENGTH)
    );
  }
  if (input.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN") {
    return (
      hasOnlyKeys(input.payload, [
        "artifactType",
        "dataUrl",
        "ledgerId",
        "requestId",
        "returnType",
        "zipPath",
      ]) &&
      isBoundedString(input.payload.ledgerId, 1, 120) &&
      isBoundedString(input.payload.zipPath, 1, 220) &&
      isFiledReturnsReturnType(input.payload.returnType) &&
      isFiledReturnsConcreteArtifactType(input.payload.artifactType) &&
      isBoundedString(input.payload.dataUrl, 1, PACK_OFFSCREEN_DATA_URL_MAX_LENGTH)
    );
  }
  if (input.type === "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP") {
    const expectedEntries = input.payload.expectedEntries;
    const expectedEntryCount = input.payload.expectedEntryCount;
    return (
      hasOnlyKeys(input.payload, [
        "expectedEntries",
        "expectedEntryCount",
        "expectedReturnType",
        "ledgerId",
        "requestId",
        "summaryPlan",
      ]) &&
      isBoundedString(input.payload.ledgerId, 1, 120) &&
      isFiledReturnsReturnType(input.payload.expectedReturnType) &&
      typeof expectedEntryCount === "number" &&
      Number.isInteger(expectedEntryCount) &&
      expectedEntryCount >= 1 &&
      expectedEntryCount <= 36 &&
      isExpectedZipEntryPlanShape(expectedEntries) &&
      expectedEntries.length === expectedEntryCount &&
      (input.payload.summaryPlan === undefined ||
        isFiledReturnsSummaryPlanShape(input.payload.summaryPlan))
    );
  }
  if (input.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER") {
    return (
      hasOnlyKeys(input.payload, ["ledgerId", "requestId"]) &&
      isBoundedString(input.payload.ledgerId, 1, 120)
    );
  }
  if (input.type === "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS") {
    return hasOnlyKeys(input.payload, ["requestId"]);
  }
  if (input.type === "PACK_OFFSCREEN_REVOKE_BLOB_URL") {
    return (
      hasOnlyKeys(input.payload, ["blobUrl", "requestId"]) &&
      isBoundedString(input.payload.blobUrl, 1, 4096)
    );
  }
  return false;
}

function isFiledReturnsSummaryPlanShape(input: unknown): input is FiledReturnsSummaryPlanEntry[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 36) return false;
  const financialYears = new Set<string>();
  for (const candidate of input) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "artifactType",
        "entryNames",
        "financialYear",
        "outcomeCategory",
        "period",
        "returnType",
      ]) ||
      !isFiledReturnsConcreteArtifactType(candidate.artifactType) ||
      !isFiledReturnsReturnType(candidate.returnType) ||
      !isFiledReturnsFinancialYear(candidate.financialYear) ||
      !isBoundedString(candidate.period, 3, 12) ||
      !isSummaryOutcomeCategory(candidate.outcomeCategory) ||
      !Array.isArray(candidate.entryNames) ||
      candidate.entryNames.length > 2 ||
      candidate.entryNames.some((entryName) => !isBoundedString(entryName, 1, 220))
    ) {
      return false;
    }
    financialYears.add(candidate.financialYear);
  }
  return financialYears.size === 1;
}

function isSummaryOutcomeCategory(
  value: unknown,
): value is FiledReturnsSummaryPlanEntry["outcomeCategory"] {
  return value === "staged" || value === "not-filed" || value === "artifact-unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength;
}

function isExpectedZipEntryPlanShape(
  input: unknown,
): input is PackOffscreenFiledReturnZipExpectedEntry[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 36) return false;
  for (const candidate of input) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["artifactType", "entryNames"])) {
      return false;
    }
    if (
      !isFiledReturnsConcreteArtifactType(candidate.artifactType) ||
      !Array.isArray(candidate.entryNames) ||
      candidate.entryNames.length < 1 ||
      candidate.entryNames.length > 2 ||
      candidate.entryNames.some((entryName) => !isBoundedString(entryName, 1, 220))
    ) {
      return false;
    }
  }
  return true;
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}
