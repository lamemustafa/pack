import { browser } from "wxt/browser";
import {
  isPackOffscreenBlobUrlMessage,
  type PackOffscreenBlobUrlMessage,
  type PackOffscreenBlobUrlResponse,
} from "../../core/offscreen-blob-url";

const blobUrlsByRequest = new Map<string, string>();

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
      const fileHandle = await getNestedFileHandle(directory, message.payload.zipPath, true);
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

interface ZipEntry {
  path: string;
  bytes: Uint8Array;
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

async function getNestedFileHandle(
  directory: FileSystemDirectoryHandle,
  zipPath: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const segments = zipPath.split("/");
  let currentDirectory = directory;
  for (const segment of segments.slice(0, -1)) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment, { create });
  }
  const fileName = segments.at(-1);
  if (!fileName) throw new Error("Missing filename.");
  return currentDirectory.getFileHandle(fileName, { create });
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

function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path);
    const crc = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, name.length, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.bytes.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + entry.bytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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
