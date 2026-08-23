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
  buildFiledReturnsSummarySheet,
  FiledReturnsSummaryForbiddenFieldError,
  FiledReturnsSummaryIdentityConflictError,
  FiledReturnsSummaryInvalidGstinError,
  FiledReturnsSummaryUncanonicalIdentityError,
  FILED_RETURNS_SUMMARY_SHEET_PATH,
} from "../../connectors/gst/filed-returns-summary-sheet";
import {
  buildFiledReturnsFullYearWorkbook,
  FILED_RETURNS_FULL_YEAR_WORKBOOK_PATH,
} from "../../connectors/gst/filed-returns-full-year-workbook";
import {
  buildFiledReturnsGstr2bWorkbook,
  FiledReturnsGstr2bWorkbookIdentityError,
  FiledReturnsGstr2bWorkbookPrivacyError,
  FiledReturnsGstr2bWorkbookSchemaError,
} from "../../connectors/gst/filed-returns-gstr2b-workbook";
import { XlsxSizeLimitError } from "../../core/xlsx";
import type { PackOffscreenFiledReturnSummaryResult } from "../../connectors/gst/offscreen-blob-url";
import {
  dataUrlChunksToDecoded,
  dataUrlToBlob,
  isExpectedDecodedDataUrlForReturnType,
  isExpectedFiledReturnBytesForReturnType,
} from "./filed-return-data-url";

const blobUrlsByRequest = new Map<string, string>();
const MAX_ZIP_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_SUMMARY_SOURCE_BYTES = 25 * 1024 * 1024;
// Derived artifacts may be at most as large as the source they are derived from.
// Tying the two removes a magic number: 5 MiB was calibrated for a CSV of mapped
// GSTR-3B statement lines and is far too small for an invoice-level annual
// workbook, which was refused at ordinary sizes. A synthetic twelve-period,
// thousand-invoice year measures 13.2 MiB, and the GST portal treats a thousand
// documents in a period as the point where Excel/JSON becomes necessary rather
// than as an extreme. This ceiling admits that with headroom and still sits four
// times under MAX_ZIP_INPUT_BYTES.
const MAX_SUMMARY_SHEET_BYTES = MAX_SUMMARY_SOURCE_BYTES;
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
      const stagedInputBytes = await stagedZipInputByteLength(directory);
      if (stagedInputBytes > MAX_ZIP_INPUT_BYTES) {
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
      const generatedAt = new Date(message.payload.generatedAt);
      const summary = message.payload.summaryPlan
        ? createSummaryEntry(message.payload.summaryPlan, entries, stagedInputBytes, generatedAt)
        : null;
      const archiveEntries = summary?.entries ? [...entries, ...summary.entries] : entries;
      const summaryEntryCount: 0 | 1 | 2 =
        summary?.entries?.length === 2 ? 2 : summary?.entries?.length === 1 ? 1 : 0;
      const zipBytes = createZip(archiveEntries, generatedAt);
      const zipBuffer = new ArrayBuffer(zipBytes.byteLength);
      new Uint8Array(zipBuffer).set(zipBytes);
      const zipBlob = new Blob([zipBuffer], { type: "application/zip" });
      const blobUrl = URL.createObjectURL(zipBlob);
      blobUrlsByRequest.set(message.payload.requestId, blobUrl);
      return {
        ok: true,
        requestId: message.payload.requestId,
        blobUrl,
        zipEntryCount: archiveEntries.length,
        artifactEntryCount: entries.length,
        summaryEntryCount,
        ...(summary ? { summary: summary.result } : {}),
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

function createSummaryEntry(
  plan: Parameters<typeof buildFiledReturnsSummarySheet>[0],
  entries: readonly ZipEntry[],
  stagedInputBytes: number,
  generatedAt: Date,
): { entries?: ZipEntry[]; result: PackOffscreenFiledReturnSummaryResult } {
  try {
    const summarySourcePaths = new Set(
      plan
        .filter((entry) => entry.artifactType === "JSON" && entry.outcomeCategory === "staged")
        .flatMap((entry) => entry.entryNames),
    );
    const summarySourceBytes = entries.reduce(
      (total, entry) => total + (summarySourcePaths.has(entry.path) ? entry.bytes.byteLength : 0),
      0,
    );
    if (summarySourceBytes > MAX_SUMMARY_SOURCE_BYTES) {
      return { result: { status: "failed", reasonCategory: "too-large" } };
    }
    const summary = buildFiledReturnsSummarySheet(plan, entries, MAX_SUMMARY_SHEET_BYTES);
    const remainingZipBudget = Math.max(0, MAX_ZIP_INPUT_BYTES - stagedInputBytes);
    const gstr3bWorkbookApplicable = plan.every((entry) => entry.returnType === "GSTR-3B");
    const gstr2bWorkbookApplicable = plan.every((entry) => entry.returnType === "GSTR-2B");
    if (!gstr3bWorkbookApplicable && !gstr2bWorkbookApplicable) {
      if (
        summary.dataBytes.byteLength > MAX_SUMMARY_SHEET_BYTES ||
        summary.dataBytes.byteLength > remainingZipBudget
      ) {
        return { result: { status: "failed", reasonCategory: "too-large" } };
      }
      return {
        entries: [{ path: FILED_RETURNS_SUMMARY_SHEET_PATH, bytes: summary.dataBytes }],
        result: {
          status: "included",
          outcomeOnly: summary.outcomeOnly,
          parsedPeriodCount: summary.parsedPeriodCount,
          rowCount: summary.rowCount,
          workbookOutcome: "not-applicable",
        },
      };
    }
    const workbookBudget = Math.min(
      Math.max(0, MAX_SUMMARY_SHEET_BYTES - summary.dataBytes.byteLength),
      Math.max(0, remainingZipBudget - summary.dataBytes.byteLength),
    );
    let workbookBytes: Uint8Array | null;
    try {
      workbookBytes = gstr3bWorkbookApplicable
        ? buildFiledReturnsFullYearWorkbook(summary, plan, {
            generatedAt,
            maxOutputBytes: workbookBudget,
          })
        : buildFiledReturnsGstr2bWorkbook(plan, entries, {
            generatedAt,
            maxOutputBytes: workbookBudget,
          });
    } catch (error) {
      // A schema rejection is a statement about the workbook alone: the tidy
      // CSV beside it was already built and already privacy-screened, and does
      // not depend on the shape the workbook could not render. Failing the whole
      // derived-summary path discarded that CSV as well.
      //
      // Deliberately only this one. A privacy or identity rejection is a
      // statement about the source document and still fails closed; size and
      // unexpected failures keep their existing terminal outcomes, which other
      // tests pin.
      // A TypeError from createXlsx is a cell-validation failure: a text field
      // past Excel's 32,767-character limit, or an XML-forbidden control
      // character. That says the workbook cannot hold this document, not that
      // the run failed -- and README and the privacy QA both promise the CSV
      // survives exactly that case.
      if (
        error instanceof FiledReturnsGstr2bWorkbookSchemaError ||
        (gstr2bWorkbookApplicable && error instanceof TypeError)
      ) {
        if (summary.dataBytes.byteLength > remainingZipBudget) {
          return { result: { status: "failed", reasonCategory: "too-large" } };
        }
        return {
          entries: [{ path: FILED_RETURNS_SUMMARY_SHEET_PATH, bytes: summary.dataBytes }],
          result: {
            status: "included",
            outcomeOnly: summary.outcomeOnly,
            parsedPeriodCount: summary.parsedPeriodCount,
            rowCount: summary.rowCount,
            workbookOutcome: "unavailable",
          },
        };
      }
      return {
        result: {
          status: "failed",
          reasonCategory:
            error instanceof XlsxSizeLimitError
              ? "too-large"
              : error instanceof FiledReturnsGstr2bWorkbookPrivacyError
                ? "privacy-rejected"
                : error instanceof FiledReturnsGstr2bWorkbookIdentityError
                  ? "identity-rejected"
                  : "workbook-generation-failed",
        },
      };
    }
    if (!workbookBytes) {
      // The same ceiling as the workbook branch below. Both CSV-only returns
      // skipped it, so a run whose staged artifacts had already consumed the
      // budget could pass more than MAX_ZIP_INPUT_BYTES into createZip.
      if (summary.dataBytes.byteLength > remainingZipBudget) {
        return { result: { status: "failed", reasonCategory: "too-large" } };
      }
      return {
        entries: [{ path: FILED_RETURNS_SUMMARY_SHEET_PATH, bytes: summary.dataBytes }],
        result: {
          status: "included",
          outcomeOnly: summary.outcomeOnly,
          parsedPeriodCount: summary.parsedPeriodCount,
          rowCount: summary.rowCount,
          // GSTR-2B does produce workbooks, so "not-applicable" would give the
          // wrong reason: nothing here is inapplicable to the return type, this
          // document simply carried no invoice-level record.
          workbookOutcome: gstr2bWorkbookApplicable ? "no-records" : "not-applicable",
        },
      };
    }
    const summaryByteLength = summary.dataBytes.byteLength + workbookBytes.byteLength;
    if (summaryByteLength > MAX_SUMMARY_SHEET_BYTES || summaryByteLength > remainingZipBudget) {
      return { result: { status: "failed", reasonCategory: "too-large" } };
    }
    return {
      entries: [
        { path: FILED_RETURNS_SUMMARY_SHEET_PATH, bytes: summary.dataBytes },
        { path: FILED_RETURNS_FULL_YEAR_WORKBOOK_PATH, bytes: workbookBytes },
      ],
      result: {
        status: "included",
        outcomeOnly: summary.outcomeOnly,
        parsedPeriodCount: summary.parsedPeriodCount,
        rowCount: summary.rowCount,
      },
    };
  } catch (error) {
    return {
      result: {
        status: "failed",
        reasonCategory:
          error instanceof FiledReturnsSummaryForbiddenFieldError
            ? "privacy-rejected"
            : error instanceof FiledReturnsSummaryInvalidGstinError
              ? "identity-rejected"
              : error instanceof FiledReturnsSummaryUncanonicalIdentityError
                ? "identity-unverified"
                : error instanceof FiledReturnsSummaryIdentityConflictError
                  ? "identity-conflict"
                  : error instanceof Error && error.name === "FiledReturnsSummaryTooLargeError"
                    ? "too-large"
                    : "generation-failed",
      },
    };
  }
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
    const fileHandle = await getLedgerFileHandle(
      directory,
      payload.zipPath,
      payload.returnType,
      true,
    );
    const writable = await fileHandle.createWritable();
    await writable.write(decoded.blob);
    await writable.close();
    const stagedBytes = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
    if (
      stagedBytes.byteLength !== decoded.bytes.byteLength ||
      !isExpectedFiledReturnBytesForReturnType(
        stagedBytes,
        payload.artifactType,
        payload.returnType,
      )
    ) {
      return {
        ok: false,
        requestId: payload.requestId,
        errorCategory: "stage-failed",
      };
    }
    return {
      ok: true,
      requestId: payload.requestId,
      staged: true,
      byteCountClass: "non-empty",
      byteCount: stagedBytes.byteLength,
      artifactType: payload.artifactType,
      ledgerId: payload.ledgerId,
      returnType: payload.returnType,
      zipPath: payload.zipPath,
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
  returnType: FiledReturnsReturnType,
  create: boolean,
): Promise<FileSystemFileHandle> {
  if (!isCanonicalFiledReturnZipEntryName(zipPath, returnType)) {
    throw new Error("Invalid ZIP entry name.");
  }
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
  const period = fileName.slice(0, extensionIndex).replace(/-(summary|details|data|return)$/, "");
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
