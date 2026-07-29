import { browser } from "wxt/browser";
import type {
  PackOffscreenBlobUrlMessage,
  PackOffscreenBlobUrlResponse,
} from "../../connectors/gst/offscreen-blob-url";
import {
  isCanonicalFiledReturnZipEntryName,
  isCanonicalFiledReturnsLedgerId,
  isPackOffscreenBlobUrlMessage,
} from "../../connectors/gst/filed-returns-offscreen-validation";
import type { FiledReturnsConcreteArtifactType } from "../../connectors/gst/filed-returns-artifacts";
import type { FiledReturnsReturnType } from "../../connectors/gst/filed-returns-return-types";
import { FILED_RETURNS_MONTHS } from "../../connectors/gst/filed-returns-scope";
import { createZip, type ZipEntry } from "./zip";
import {
  dataUrlChunksToDecoded,
  dataUrlToBlob,
  isExpectedDecodedDataUrlForReturnType,
  isExpectedFiledReturnBytesForReturnType,
} from "./filed-return-data-url";

const blobUrlsByRequest = new Map<string, string>();
const MAX_ZIP_INPUT_BYTES = 100 * 1024 * 1024;
const FILED_RETURN_PERIOD_ORDER = new Map(
  FILED_RETURNS_MONTHS.map((period, index) => [period.toLowerCase(), index]),
);
type StagedFiledReturnPayload = {
  artifactType: FiledReturnsConcreteArtifactType;
  ledgerId: string;
  requestId: string;
  returnType: FiledReturnsReturnType;
  zipPath: string;
};

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isTrustedOffscreenSender(sender) || !isPackOffscreenBlobUrlMessage(message)) return false;

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

  if (message.type === "PACK_OFFSCREEN_CREATE_FILED_RETURN_ZIP") {
    try {
      const directory = await getLedgerDirectory(message.payload.ledgerId, false);
      if ((await stagedZipInputByteLength(directory)) > MAX_ZIP_INPUT_BYTES) {
        return {
          ok: false,
          requestId: message.payload.requestId,
          errorCategory: "zip-too-large",
        };
      }
      const entries = await readZipEntries(directory);
      if (entries.length === 0) {
        return {
          ok: false,
          requestId: message.payload.requestId,
          errorCategory: "zip-empty",
        };
      }
      const expectedReturnType = message.payload.expectedReturnType;
      const expectedEntryCount = message.payload.expectedEntryCount;
      const expectedEntries = message.payload.expectedEntries;
      if (
        entries.length !== expectedEntryCount ||
        !matchesExpectedZipEntryPlan(entries, expectedEntries, expectedReturnType)
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

  if (message.type === "PACK_OFFSCREEN_CLEAR_ALL_FILED_RETURN_LEDGERS") {
    try {
      await clearAllLedgerDirectories();
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
  return packs.getDirectoryHandle(canonicalLedgerDirectoryName(ledgerId), { create });
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
    await packs.removeEntry(canonicalLedgerDirectoryName(ledgerId), { recursive: true });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

async function clearAllLedgerDirectories(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("filed-return-packs", { recursive: true });
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
  if (!isCanonicalFiledReturnZipEntryName(zipPath)) throw new Error("Invalid ZIP entry name.");
  return directory.getFileHandle(zipPath, { create });
}

function matchesExpectedZipEntryPlan(
  entries: readonly ZipEntry[],
  expectedEntries: readonly {
    artifactType: FiledReturnsConcreteArtifactType;
    entryNames: readonly string[];
  }[],
  expectedReturnType: FiledReturnsReturnType,
): boolean {
  if (entries.length !== expectedEntries.length) return false;
  // Staged entries are read back in canonical ZIP order, which is independent of the caller's
  // artifact-acquisition order. Bind each entry to exactly one unconsumed plan slot so a correct
  // artifact set is never rejected for slot ordering alone, while an extra, missing, duplicate, or
  // type-swapped file still leaves a slot unmatched.
  const unmatchedSlots = new Set(expectedEntries.keys());
  for (const entry of entries) {
    const slotIndex = [...unmatchedSlots].find((index) => {
      const expectedSlot = expectedEntries[index];
      return (
        expectedSlot !== undefined &&
        expectedSlot.entryNames.includes(entry.path) &&
        artifactTypeFromZipPath(entry.path) === expectedSlot.artifactType &&
        isExpectedFiledReturnBytesForReturnType(
          entry.bytes,
          expectedSlot.artifactType,
          expectedReturnType,
        )
      );
    });
    if (slotIndex === undefined) return false;
    unmatchedSlots.delete(slotIndex);
  }
  return unmatchedSlots.size === 0;
}

function artifactTypeFromZipPath(zipPath: string): FiledReturnsConcreteArtifactType | null {
  const lowerPath = zipPath.toLowerCase();
  if (lowerPath.endsWith(".pdf")) return "PDF";
  if (lowerPath.endsWith(".xls") || lowerPath.endsWith(".xlsx")) return "EXCEL";
  if (lowerPath.endsWith(".json")) return "JSON";
  return null;
}

async function stagedZipInputByteLength(directory: FileSystemDirectoryHandle): Promise<number> {
  let total = 0;
  for await (const [, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      total += await stagedZipInputByteLength(handle);
    } else {
      total += (await handle.getFile()).size;
    }
    if (total > MAX_ZIP_INPUT_BYTES) return total;
  }
  return total;
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
  return entries.sort(compareFiledReturnZipEntries);
}

function compareFiledReturnZipEntries(left: ZipEntry, right: ZipEntry): number {
  const leftPeriodOrder = filedReturnZipPeriodOrder(left.path);
  const rightPeriodOrder = filedReturnZipPeriodOrder(right.path);
  if (leftPeriodOrder !== rightPeriodOrder) return leftPeriodOrder - rightPeriodOrder;
  const leftArtifactOrder = artifactTypeFromZipPath(left.path) === "PDF" ? 0 : 1;
  const rightArtifactOrder = artifactTypeFromZipPath(right.path) === "PDF" ? 0 : 1;
  if (leftArtifactOrder !== rightArtifactOrder) return leftArtifactOrder - rightArtifactOrder;
  return left.path.localeCompare(right.path);
}

function filedReturnZipPeriodOrder(path: string): number {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  const extensionIndex = fileName.indexOf(".");
  if (extensionIndex < 1) return FILED_RETURNS_MONTHS.length;
  const period = fileName.slice(0, extensionIndex).replace(/-(summary|details|data)$/, "");
  return FILED_RETURN_PERIOD_ORDER.get(period) ?? FILED_RETURNS_MONTHS.length;
}

function isTrustedOffscreenSender(sender: Browser.runtime.MessageSender): boolean {
  return sender.id === browser.runtime.id && sender.tab === undefined;
}

function canonicalLedgerDirectoryName(ledgerId: string): string {
  if (!isCanonicalFiledReturnsLedgerId(ledgerId)) throw new Error("Invalid ledger ID.");
  return ledgerId.replace(":", "_");
}

function hasStorageDirectoryApi(): boolean {
  return typeof navigator.storage?.getDirectory === "function";
}
