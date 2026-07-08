import { browser } from "wxt/browser";
import {
  isPackOffscreenBlobUrlMessage,
  type PackOffscreenBlobUrlMessage,
  type PackOffscreenBlobUrlResponse,
} from "../../core/offscreen-blob-url";
import { createZip, type ZipEntry } from "./zip";

const blobUrlsByRequest = new Map<string, string>();
const chunkedFiledReturnsByTransfer = new Map<
  string,
  {
    chunks: string[];
    ledgerId: string;
    totalChunks: number;
    zipPath: string;
  }
>();

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
    const blob = dataUrlToBlob(message.payload.dataUrl);
    if (!blob || blob.size === 0) {
      return {
        ok: false,
        requestId: message.payload.requestId,
        errorCategory: "invalid-data-url",
      };
    }
    try {
      const directory = await getLedgerDirectory(message.payload.ledgerId, true);
      const fileHandle = await getLedgerFileHandle(directory, message.payload.zipPath, true);
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {
        ok: true,
        requestId: message.payload.requestId,
        staged: true,
        byteCountClass: "non-empty",
      };
    } catch {
      return {
        ok: false,
        requestId: message.payload.requestId,
        errorCategory: hasStorageDirectoryApi() ? "stage-failed" : "opfs-unavailable",
      };
    }
  }

  if (message.type === "PACK_OFFSCREEN_STAGE_FILED_RETURN_CHUNK") {
    const key = message.payload.transferId;
    const existing = chunkedFiledReturnsByTransfer.get(key);
    const transfer =
      existing ??
      {
        chunks: [],
        ledgerId: message.payload.ledgerId,
        totalChunks: message.payload.totalChunks,
        zipPath: safeZipEntryFilename(message.payload.zipPath),
      };
    if (
      transfer.ledgerId !== message.payload.ledgerId ||
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

    if (transfer.chunks.filter((chunk) => typeof chunk === "string").length < transfer.totalChunks) {
      return {
        ok: true,
        requestId: message.payload.requestId,
        staged: true,
        byteCountClass: "non-empty",
      };
    }

    const blob = dataUrlToBlob(transfer.chunks.join(""));
    chunkedFiledReturnsByTransfer.delete(key);
    if (!blob || blob.size === 0) {
      return {
        ok: false,
        requestId: message.payload.requestId,
        errorCategory: "invalid-data-url",
      };
    }
    try {
      const directory = await getLedgerDirectory(message.payload.ledgerId, true);
      const fileHandle = await getLedgerFileHandle(directory, message.payload.zipPath, true);
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {
        ok: true,
        requestId: message.payload.requestId,
        staged: true,
        byteCountClass: "non-empty",
      };
    } catch {
      return {
        ok: false,
        requestId: message.payload.requestId,
        errorCategory: hasStorageDirectoryApi() ? "stage-failed" : "opfs-unavailable",
      };
    }
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

async function clearLedgerDirectory(ledgerId: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const packs = await root.getDirectoryHandle("filed-return-packs", { create: false });
  await packs.removeEntry(safeDirectorySegment(ledgerId), { recursive: true });
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

function dataUrlToBlob(dataUrl: string): Blob | null {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex <= 5) return null;

  const metadata = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const mimeType = metadata.split(";")[0] || "application/octet-stream";
  try {
    if (metadata.toLowerCase().includes(";base64")) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch {
    return null;
  }
}
