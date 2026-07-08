import { browser } from "wxt/browser";
import {
  PACK_OFFSCREEN_BLOB_URL_TARGET,
  type PackOffscreenBlobUrlResponse,
} from "../core/offscreen-blob-url";
import type { FiledReturnsConcreteArtifactType } from "../core/filed-returns-artifacts";
import type { FiledReturnsReturnType } from "../core/filed-returns-return-types";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_JUSTIFICATION =
  "Create and revoke a temporary Blob URL for an explicit local GST return download.";
export type OffscreenFiledReturnStageResult =
  | { status: "staged" }
  | { status: "failed"; errorCategory?: string };

let creatingOffscreenDocument: Promise<void> | null = null;

export async function createOffscreenBlobUrl(dataUrl: string): Promise<string | null> {
  const requestId = createRequestId();
  await ensureOffscreenDocument();
  const response = await browser.runtime.sendMessage({
    type: "PACK_OFFSCREEN_CREATE_BLOB_URL",
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    payload: {
      requestId,
      dataUrl,
    },
  });
  return isBlobUrlResponse(response, requestId) ? response.blobUrl : null;
}

export async function stageOffscreenFiledReturn({
  dataUrl,
  ledgerId,
  zipPath,
}: {
  dataUrl: string;
  ledgerId: string;
  zipPath: string;
}): Promise<OffscreenFiledReturnStageResult> {
  const requestId = createRequestId();
  await ensureOffscreenDocument();
  const response = await browser.runtime.sendMessage({
    type: "PACK_OFFSCREEN_STAGE_FILED_RETURN",
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    payload: {
      requestId,
      dataUrl,
      ledgerId,
      zipPath,
    },
  });
  return toStageResult(response, requestId);
}

export async function stageOffscreenFiledReturnChunk({
  chunk,
  index,
  ledgerId,
  returnType,
  artifactType,
  totalChunks,
  transferId,
  zipPath,
}: {
  chunk: string;
  index: number;
  ledgerId: string;
  returnType: FiledReturnsReturnType;
  artifactType: FiledReturnsConcreteArtifactType;
  totalChunks: number;
  transferId: string;
  zipPath: string;
}): Promise<OffscreenFiledReturnStageResult> {
  const requestId = createRequestId();
  await ensureOffscreenDocument();
  const response = await browser.runtime.sendMessage({
    type: "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK",
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    payload: {
      requestId,
      chunk,
      index,
      ledgerId,
      totalChunks,
      transferId,
      zipPath,
      returnType,
      artifactType,
    },
  });
  return toStageResult(response, requestId);
}

export async function createOffscreenFiledReturnZipUrl(
  ledgerId: string,
): Promise<{ blobUrl: string; zipEntryCount: number } | null> {
  const requestId = createRequestId();
  await ensureOffscreenDocument();
  const response = await browser.runtime.sendMessage({
    type: "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP",
    target: PACK_OFFSCREEN_BLOB_URL_TARGET,
    payload: {
      requestId,
      ledgerId,
    },
  });
  return isZipResponse(response, requestId)
    ? { blobUrl: response.blobUrl, zipEntryCount: response.zipEntryCount }
    : null;
}

export async function clearOffscreenFiledReturnLedger(
  ledgerId: string,
): Promise<"cleared" | "failed"> {
  const requestId = createRequestId();
  try {
    await ensureOffscreenDocument();
    const response = await browser.runtime.sendMessage({
      type: "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId,
        ledgerId,
      },
    });
    return isClearedResponse(response, requestId) ? "cleared" : "failed";
  } catch {
    return "failed";
  }
}

export async function revokeOffscreenBlobUrl(blobUrl: string): Promise<void> {
  const requestId = createRequestId();
  try {
    await browser.runtime.sendMessage({
      type: "PACK_OFFSCREEN_REVOKE_BLOB_URL",
      target: PACK_OFFSCREEN_BLOB_URL_TARGET,
      payload: {
        requestId,
        blobUrl,
      },
    });
  } catch {
    // The browser may already have torn down the offscreen document.
  }
}

export async function closeOffscreenBlobDocument(): Promise<void> {
  const offscreenApi = getOffscreenApi();
  try {
    await offscreenApi?.closeDocument();
  } catch {
    // Another extension task or the browser may have already closed it.
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    const offscreenApi = getOffscreenApi();
    if (!offscreenApi) throw new Error("Pack offscreen API unavailable.");
    creatingOffscreenDocument = offscreenApi
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["BLOBS"],
        justification: OFFSCREEN_JUSTIFICATION,
      })
      .finally(() => {
        creatingOffscreenDocument = null;
      });
  }
  await creatingOffscreenDocument;
}

async function hasOffscreenDocument(): Promise<boolean> {
  const runtimeWithContexts = browser.runtime as typeof browser.runtime & {
    getContexts?: (filter: {
      contextTypes: ["OFFSCREEN_DOCUMENT"];
      documentUrls: string[];
    }) => Promise<unknown[]>;
  };
  if (!runtimeWithContexts.getContexts) return false;
  const offscreenUrl = browser.runtime.getURL(
    OFFSCREEN_DOCUMENT_PATH as Parameters<typeof browser.runtime.getURL>[0],
  );
  const contexts = await runtimeWithContexts.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  return contexts.length > 0;
}

function getOffscreenApi(): {
  createDocument(parameters: {
    url: string;
    reasons: ["BLOBS"];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
} | null {
  const browserWithOffscreen = browser as typeof browser & {
    offscreen?: {
      createDocument(parameters: {
        url: string;
        reasons: ["BLOBS"];
        justification: string;
      }): Promise<void>;
      closeDocument(): Promise<void>;
    };
  };
  return browserWithOffscreen.offscreen ?? null;
}

function isBlobUrlResponse(
  response: unknown,
  requestId: string,
): response is Extract<PackOffscreenBlobUrlResponse, { blobUrl: string }> {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return record.ok === true && record.requestId === requestId && typeof record.blobUrl === "string";
}

function isStagedResponse(
  response: unknown,
  requestId: string,
): response is { ok: true; requestId: string; staged: true } {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return record.ok === true && record.requestId === requestId && record.staged === true;
}

function toStageResult(response: unknown, requestId: string): OffscreenFiledReturnStageResult {
  if (isStagedResponse(response, requestId)) return { status: "staged" };
  if (typeof response === "object" && response !== null) {
    const record = response as Record<string, unknown>;
    if (
      record.ok === false &&
      record.requestId === requestId &&
      typeof record.errorCategory === "string"
    ) {
      return { status: "failed", errorCategory: record.errorCategory };
    }
  }
  return { status: "failed" };
}

function isZipResponse(
  response: unknown,
  requestId: string,
): response is { ok: true; requestId: string; blobUrl: string; zipEntryCount: number } {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return (
    record.ok === true &&
    record.requestId === requestId &&
    typeof record.blobUrl === "string" &&
    typeof record.zipEntryCount === "number" &&
    Number.isInteger(record.zipEntryCount) &&
    record.zipEntryCount > 0
  );
}

function isClearedResponse(
  response: unknown,
  requestId: string,
): response is { ok: true; requestId: string; cleared: true } {
  if (typeof response !== "object" || response === null) return false;
  const record = response as Record<string, unknown>;
  return record.ok === true && record.requestId === requestId && record.cleared === true;
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `offscreen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
