import type { UserActionRequired } from "../core/contracts";
import type {
  BrowserDownloadSafeEvidence,
  FiledReturnsDownloadByteCountClass,
  FiledReturnsDownloadMimeClass,
} from "../connectors/gst/filed-returns-contracts";
import {
  isExpectedDownloadCandidate,
  type DownloadObservationContext,
} from "./download-correlation";
import type {
  DownloadCreatedItem,
  DownloadObservationApi,
  SafeDownloadObservation,
} from "./download-observer";

export async function completedObservation(
  downloads: Pick<DownloadObservationApi, "search">,
  downloadId: number,
  context: DownloadObservationContext,
  fallbackItem?: DownloadCreatedItem,
): Promise<SafeDownloadObservation> {
  const { failed: searchFailed, items } = await safeDownloadSearch(downloads, downloadId);
  if (searchFailed) return unconfirmedObservation("browser-download-search-unavailable");
  const [searchItem] = items;
  if (!searchItem) return unconfirmedObservation("browser-download-search-missing");
  if (searchItem.state === "interrupted") return failedObservation(searchItem.error);
  if (searchItem.state !== "complete") {
    return unconfirmedObservation("browser-download-state-unconfirmed");
  }
  const item = mergeDownloadEvidence(fallbackItem, searchItem);
  if (!item) return unconfirmedObservation("browser-download-search-missing");
  if (!isExpectedDownloadCandidate(item, context)) {
    return unconfirmedObservation("browser-download-correlation-rejected");
  }
  // Chrome documents DownloadItem.exists as eventual metadata: search() only
  // starts a throttled filesystem check and can return the previous value. A
  // completed, exact-ID, target-correlated, safe, non-empty download is the
  // durable proof; treating a stale `false` as retry permission can duplicate
  // the externally visible download action.
  if (!item.danger) return unconfirmedObservation("browser-download-danger-unknown");
  if (isPendingDangerClassification(item.danger)) {
    return unconfirmedObservation("browser-download-danger-pending");
  }
  if (hasRejectedDangerClassification(item)) return rejectedDangerObservation();
  const knownSize = firstKnownSize(item);

  if (knownSize === null) return unconfirmedObservation("browser-download-size-unknown");

  if (knownSize === 0) {
    return {
      state: "failed",
      safeSignals: ["browser-download-completed", "browser-download-zero-bytes"],
      safeMessage:
        "The browser reported a filed-return download, but the file appears to be empty. Retry from the GST Portal detail page.",
      userAction: retryPortalGenerationAction(),
      safeEvidence: safeEvidenceForDownload(downloadId, item, "zero"),
    };
  }

  return {
    state: "completed",
    safeSignals: [
      "browser-download-created",
      "browser-download-completed",
      `browser-download-id:${downloadId}`,
      ...(knownSize > 0 ? ["browser-download-non-empty"] : []),
    ],
    safeMessage:
      "The browser reported that the filed-return download completed. Check the local downloads folder for the GST Portal file.",
    safeEvidence: safeEvidenceForDownload(downloadId, item, "non-empty"),
  };
}

function hasRejectedDangerClassification(item: DownloadCreatedItem): boolean {
  return typeof item.danger !== "string" || !["safe", "deepScannedSafe"].includes(item.danger);
}

function isPendingDangerClassification(danger: string): boolean {
  return [
    "asyncScanning",
    "asyncLocalPasswordScanning",
    "promptForScanning",
    "promptForLocalPasswordScanning",
  ].includes(danger);
}

function rejectedDangerObservation(): SafeDownloadObservation {
  return {
    state: "failed",
    safeSignals: [
      "browser-download-created",
      "browser-download-completed",
      "browser-download-danger-rejected",
    ],
    safeMessage:
      "The browser did not classify this filed-return download as safe, so Pack did not mark the target complete. Review the item in browser Downloads before deciding whether to retry.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message:
        "Review the browser download warning. Cancel the unresolved Pack target before starting another download.",
      canResume: true,
    },
  };
}

export function unconfirmedObservation(signal: string): SafeDownloadObservation {
  return {
    state: "not-observed",
    safeSignals: ["browser-download-created", signal],
    safeMessage:
      "Pack saw a browser download event, but could not prove it was a non-empty filed-return file from the GST Portal. Retry from the GST Portal detail page.",
    userAction: retryPortalGenerationAction(),
  };
}

export function downloadNotObserved(): SafeDownloadObservation {
  return {
    state: "not-observed",
    safeSignals: ["browser-download-not-observed"],
    safeMessage:
      "Pack clicked the filed-return download control, but the browser did not report a download. Allow downloads for the GST Portal, then retry.",
    userAction: {
      type: "ALLOW_MULTIPLE_DOWNLOADS",
      message: "Allow browser downloads for the GST Portal, then start the Pack download again.",
      canResume: true,
    },
  };
}

export function downloadInProgress(): SafeDownloadObservation {
  return {
    state: "not-observed",
    safeSignals: [
      "browser-download-created",
      "browser-download-in-progress",
      "browser-download-save-dialog-may-be-open",
    ],
    safeMessage:
      "The exact browser download is still in progress. Finish or cancel the browser Save dialog, then ask Pack to reconcile the saved download.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Finish or cancel the Save dialog, then reconcile the saved browser download.",
      canResume: true,
    },
  };
}

export function failedObservation(errorCode?: string): SafeDownloadObservation {
  return {
    state: "failed",
    safeSignals: [
      "browser-download-created",
      "browser-download-interrupted",
      ...(errorCode ? [`browser-download-error-${normaliseSignal(errorCode)}`] : []),
    ],
    safeMessage:
      "The browser started the filed-return download but reported that it was interrupted. Check browser download permissions and retry.",
    userAction: {
      type: "ALLOW_MULTIPLE_DOWNLOADS",
      message: "Allow browser downloads for the GST Portal, then start the Pack download again.",
      canResume: true,
    },
  };
}

function firstKnownSize(item: DownloadCreatedItem | undefined): number | null {
  const fileSize = item?.fileSize;
  if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize >= 0) {
    return fileSize;
  }
  const transferSizes = [item?.totalBytes, item?.bytesReceived].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  if (transferSizes.length === 0) return null;
  return Math.max(...transferSizes);
}

function safeEvidenceForDownload(
  downloadId: number,
  item: DownloadCreatedItem,
  byteCountClass: FiledReturnsDownloadByteCountClass,
): BrowserDownloadSafeEvidence {
  return {
    downloadId,
    urlClass: classifyUrl(item),
    mimeClass: classifyMime(item.mime),
    byteCountClass,
  };
}

function classifyUrl(item: DownloadCreatedItem): BrowserDownloadSafeEvidence["urlClass"] {
  const schemes = [item.url, item.finalUrl, item.referrer].map((value) => parseScheme(value));
  if (schemes.includes("blob")) return "blob";
  if (schemes.includes("data")) return "data";
  if (schemes.includes("http") || schemes.includes("https")) return "https";
  return "unknown";
}

function parseScheme(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}

function classifyMime(mime: string | undefined): FiledReturnsDownloadMimeClass {
  const value = mime?.toLowerCase().trim();
  if (!value) return "missing";
  if (value.includes("pdf")) return "pdf";
  if (
    value.includes("spreadsheet") ||
    value.includes("excel") ||
    value.includes("officedocument")
  ) {
    return "spreadsheet";
  }
  if (
    [
      "application/octet-stream",
      "binary/octet-stream",
      "application/download",
      "application/force-download",
      "application/x-download",
    ].includes(value)
  ) {
    return "generic-binary";
  }
  if (value.includes("html")) return "html";
  if (value.includes("json")) return "json";
  if (value.startsWith("text/")) return "text";
  if (value.startsWith("image/")) return "image";
  return "other";
}

async function safeDownloadSearch(
  downloads: Pick<DownloadObservationApi, "search">,
  downloadId: number,
): Promise<{ failed: boolean; items: DownloadCreatedItem[] }> {
  try {
    return { failed: false, items: await downloads.search({ id: downloadId }) };
  } catch {
    return { failed: true, items: [] };
  }
}

function mergeDownloadEvidence(
  fallbackItem: DownloadCreatedItem | undefined,
  searchItem: DownloadCreatedItem | undefined,
): DownloadCreatedItem | undefined {
  if (!fallbackItem) return searchItem;
  if (!searchItem) return fallbackItem;
  return Object.assign(
    {},
    fallbackItem,
    Object.fromEntries(Object.entries(searchItem).filter(([, value]) => value !== undefined)),
  ) as DownloadCreatedItem;
}

function retryPortalGenerationAction(): UserActionRequired {
  return {
    type: "RETRY_PORTAL_GENERATION",
    message: "Retry the filed-return download from the GST Portal detail page.",
    canResume: true,
  };
}

function normaliseSignal(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
