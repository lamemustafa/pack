import { browser } from "wxt/browser";
import {
  isPackOffscreenBlobUrlMessage,
  type PackOffscreenBlobUrlMessage,
  type PackOffscreenBlobUrlResponse,
} from "../../core/offscreen-blob-url";
import type { FiledReturnsConcreteArtifactType } from "../../core/filed-returns-artifacts";
import type { FiledReturnsReturnType } from "../../core/filed-returns-return-types";
import { createZip, type ZipEntry } from "./zip";
import {
  dataUrlChunksToDecoded,
  dataUrlToBlob,
  isExpectedDecodedDataUrlForReturnType,
  isExpectedFiledReturnBytesForReturnType,
} from "./filed-return-data-url";

const blobUrlsByRequest = new Map<string, string>();
const chunkedFiledReturnsByTransfer = new Map<
  string,
  {
    chunks: string[];
    artifactType: FiledReturnsConcreteArtifactType;
    ledgerId: string;
    returnType: FiledReturnsReturnType;
    totalChunks: number;
    zipPath: string;
  }
>();
type StagedFiledReturnPayload = {
  artifactType: FiledReturnsConcreteArtifactType;
  ledgerId: string;
  requestId: string;
  returnType: FiledReturnsReturnType;
  zipPath: string;
};

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPackOffscreenBlobUrlMessage(message)) return false;

  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch(() =>
      sendResponse({
        ok: false,
        errorCategory: "blob-url-failed",
      } satisfies PackOffscreenBlobUrlResponse),
    );
  return true;
});

async function handleMessage(
  message: PackOffscreenBlobUrlMessage,
): Promise<PackOffscreenBlobUrlResponse> {
  if (message.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN") {
    return stageFiledReturnDataUrl(message.payload, [message.payload.dataUrl]);
  }

  if (message.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK") {
    const key = message.payload.transferId;
    const existing = chunkedFiledReturnsByTransfer.get(key);
    const transfer = existing ?? {
      chunks: [],
      artifactType: message.payload.artifactType,
      ledgerId: message.payload.ledgerId,
      returnType: message.payload.returnType,
      totalChunks: message.payload.totalChunks,
      zipPath: safeZipEntryFilename(message.payload.zipPath),
    };
    if (
      transfer.artifactType !== message.payload.artifactType ||
      transfer.ledgerId !== message.payload.ledgerId ||
      transfer.returnType !== message.payload.returnType ||
      transfer.zipPath !== safeZipEntryFilename(message.payload.zipPath) ||
      transfer.totalChunks !== message.payload.totalChunks
    ) {
      chunkedFiledReturnsByTransfer.delete(key);
      return {
        ok: false,
        requestId: message.payload.requestId,
        errorCategory: "stage-chunk-failed",
      };
    }
    transfer.chunks[message.payload.index] = message.payload.chunk;
    chunkedFiledReturnsByTransfer.set(key, transfer);

    if (
      transfer.chunks.filter((chunk) => typeof chunk === "string").length < transfer.totalChunks
    ) {
      return {
        ok: true,
        requestId: message.payload.requestId,
        staged: true,
        byteCountClass: "non-empty",
      };
    }

    chunkedFiledReturnsByTransfer.delete(key);
    return stageFiledReturnDataUrl(message.payload, transfer.chunks);
  }

  if (message.type === "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP") {
    try {
      const directory = await getLedgerDirectory(message.payload.ledgerId, false);
      const entries = await readZipEntries(directory);
      if (entries.length === 0) {
        return {
          ok: false,
          requestId: message.payload.requestId,
          errorCategory: "zip-empty",
        };
      }
      const expectedReturnType = message.payload.expectedReturnType;
      const expectedArtifactTypes = message.payload.expectedArtifactTypes;
      if (
        expectedReturnType &&
        expectedArtifactTypes &&
        !entries.every((entry) =>
          isExpectedZipEntry(entry, expectedArtifactTypes, expectedReturnType),
        )
      ) {
        return {
          ok: false,
          requestId: message.payload.requestId,
          errorCategory: "zip-invalid-entry",
        };
      }
      const zipBytes = createZip(entries);
      const zipBuffer = new ArrayBuffer(zipBytes.byteLength);
      new Uint8Array(zipBuffer).set(zipBytes);
      const zipBlob = new Blob([zipBuffer], { type: "application/zip" });
      const blobUrl = URL.createObjectURL(zipBlob);
      blobUrlsByRequest.set(message.payload.requestId, blobUrl);
      return {
        ok: true,
        requestId: message.payload.requestId,
        blobUrl,
        zipEntryCount: entries.length,
      };
    } catch {
      return {
        ok: false,
        requestId: message.payload.requestId,
        errorCategory: hasStorageDirectoryApi() ? "zip-failed" : "opfs-unavailable",
      };
    }
  }

  if (message.type === "PACK_OFFSCREEN_CLEAR_FILED_RETURN_LEDGER") {
    try {
      await clearLedgerDirectory(message.payload.ledgerId);
      return {
        ok: true,
        requestId: message.payload.requestId,
        cleared: true,
      };
    } catch {
      return {
        ok: false,
        requestId: message.payload.requestId,
        errorCategory: hasStorageDirectoryApi() ? "clear-failed" : "opfs-unavailable",
      };
    }
  }

  if (message.type === "PACK_OFFSCREEN_REVOKE_BLOB_URL") {
    for (const [requestId, blobUrl] of blobUrlsByRequest.entries()) {
      if (blobUrl !== message.payload.blobUrl) continue;
      URL.revokeObjectURL(blobUrl);
      blobUrlsByRequest.delete(requestId);
      break;
    }
    return {
      ok: true,
      requestId: message.payload.requestId,
      revoked: true,
    };
  }

  const blob = dataUrlToBlob(message.payload.dataUrl);
  if (!blob) {
    return {
      ok: false,
      requestId: message.payload.requestId,
      errorCategory: "invalid-data-url",
    };
  }
  const previousBlobUrl = blobUrlsByRequest.get(message.payload.requestId);
  if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl);

  const blobUrl = URL.createObjectURL(blob);
  blobUrlsByRequest.set(message.payload.requestId, blobUrl);
  return {
    ok: true,
    requestId: message.payload.requestId,
    blobUrl,
  };
}

async function getLedgerDirectory(
  ledgerId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const packs = await root.getDirectoryHandle("filed-return-packs", { create });
  return packs.getDirectoryHandle(safeDirectorySegment(ledgerId), { create });
}

async function stageFiledReturnDataUrl(
  payload: StagedFiledReturnPayload,
  dataUrlChunks: string[],
): Promise<PackOffscreenBlobUrlResponse> {
  const decoded = dataUrlChunksToDecoded(dataUrlChunks);
  if (
    !decoded ||
    decoded.blob.size === 0 ||
    !isExpectedDecodedDataUrlForReturnType(
      decoded.metadata,
      decoded.bytes,
      payload.artifactType,
      payload.returnType,
    )
  ) {
    return {
      ok: false,
      requestId: payload.requestId,
      errorCategory: "invalid-data-url",
    };
  }

  try {
    const directory = await getLedgerDirectory(payload.ledgerId, true);
    const fileHandle = await getLedgerFileHandle(directory, payload.zipPath, true);
    const writable = await fileHandle.createWritable();
    await writable.write(decoded.blob);
    await writable.close();
    return {
      ok: true,
      requestId: payload.requestId,
      staged: true,
      byteCountClass: "non-empty",
    };
  } catch {
    return {
      ok: false,
      requestId: payload.requestId,
      errorCategory: hasStorageDirectoryApi() ? "stage-failed" : "opfs-unavailable",
    };
  }
}

async function clearLedgerDirectory(ledgerId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const packs = await root.getDirectoryHandle("filed-return-packs", { create: false });
    await packs.removeEntry(safeDirectorySegment(ledgerId), { recursive: true });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "NotFoundError"
  );
}

async function getLedgerFileHandle(
  directory: FileSystemDirectoryHandle,
  zipPath: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  return directory.getFileHandle(safeZipEntryFilename(zipPath), { create });
}

function safeZipEntryFilename(zipPath: string): string {
  const fileName = zipPath.split("/").at(-1);
  if (!fileName) throw new Error("Missing filename.");
  return fileName;
}

function isExpectedZipEntry(
  entry: ZipEntry,
  expectedArtifactTypes: readonly FiledReturnsConcreteArtifactType[],
  expectedReturnType: FiledReturnsReturnType,
): boolean {
  const artifactType = artifactTypeFromZipPath(entry.path);
  return (
    artifactType !== null &&
    expectedArtifactTypes.includes(artifactType) &&
    isExpectedFiledReturnBytesForReturnType(entry.bytes, artifactType, expectedReturnType)
  );
}

function artifactTypeFromZipPath(zipPath: string): FiledReturnsConcreteArtifactType | null {
  const lowerPath = zipPath.toLowerCase();
  if (lowerPath.endsWith(".pdf")) return "PDF";
  if (lowerPath.endsWith(".xls") || lowerPath.endsWith(".xlsx")) return "EXCEL";
  return null;
}

async function readZipEntries(
  directory: FileSystemDirectoryHandle,
  prefix = "",
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      entries.push(...(await readZipEntries(handle, `${prefix}${name}/`)));
      continue;
    }
    const file = await handle.getFile();
    entries.push({
      path: `${prefix}${name}`,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function safeDirectorySegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function hasStorageDirectoryApi(): boolean {
  return typeof navigator.storage?.getDirectory === "function";
}
