import type {
  BrowserDownloadSafeEvidence,
  FiledReturnsDownloadByteCountClass,
  FiledReturnsDownloadMimeClass,
  UserActionRequired,
} from "../core/contracts";
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
  context: DownloadObservationContext | null = null,
  fallbackItem?: DownloadCreatedItem,
): Promise<SafeDownloadObservation> {
  const { failed: searchFailed, items } = await safeDownloadSearch(downloads, downloadId);
  if (searchFailed) return unconfirmedObservation("browser-download-search-unavailable");
  const [searchItem] = items;
  const item = mergeDownloadEvidence(fallbackItem, searchItem);
  if (!item) return unconfirmedObservation("browser-download-search-missing");
  if (context && !isExpectedDownloadCandidate(item, context)) {
    return unconfirmedObservation("browser-download-correlation-rejected");
  }
  const knownSize = firstKnownSize(item);

  if (knownSize === null) return unconfirmedObservation("browser-download-size-unknown");

  if (knownSize === 0) {
    return {
      state: "failed",
      safeSignals: ["browser-download-completed", "browser-download-zero-bytes"],
      safeMessage:
        "The browser reported a filed-return PDF download, but the file appears to be empty. Retry from the GST Portal detail page.",
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
      "The browser reported that the filed-return PDF download completed. Check the local downloads folder for the GST Portal PDF.",
    safeEvidence: safeEvidenceForDownload(downloadId, item, "non-empty"),
  };
}

export function unconfirmedObservation(signal: string): SafeDownloadObservation {
  return {
    state: "not-observed",
    safeSignals: ["browser-download-created", signal],
    safeMessage:
      "Pack saw a browser download event, but could not prove it was a non-empty filed-return PDF from the GST Portal. Retry from the GST Portal detail page.",
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

export function failedObservation(errorCode?: string): SafeDownloadObservation {
  return {
    state: "failed",
    safeSignals: [
      "browser-download-created",
      "browser-download-interrupted",
      ...(errorCode ? [`browser-download-error-${normaliseSignal(errorCode)}`] : []),
    ],
    safeMessage:
      "The browser started the filed-return PDF download but reported that it was interrupted. Check browser download permissions and retry.",
    userAction: {
      type: "ALLOW_MULTIPLE_DOWNLOADS",
      message: "Allow browser downloads for the GST Portal, then start the Pack download again.",
      canResume: true,
    },
  };
}

export function shouldSettleUnconfirmed(observation: SafeDownloadObservation): boolean {
  return !observation.safeSignals.some((signal) =>
    [
      "browser-download-correlation-rejected",
      "browser-download-search-missing",
      "browser-download-search-unavailable",
    ].includes(signal),
  );
}

function firstKnownSize(item: DownloadCreatedItem | undefined): number | null {
  const knownSizes = [item?.fileSize, item?.totalBytes, item?.bytesReceived].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  if (knownSizes.length === 0) return null;
  return Math.max(...knownSizes);
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
  return {
    ...fallbackItem,
    ...searchItem,
    startTime: searchItem.startTime ?? fallbackItem.startTime,
  };
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
