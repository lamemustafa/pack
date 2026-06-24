import type { UserActionRequired } from "../core/contracts";
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
        "The browser reported a filed GSTR-3B download, but the file appears to be empty. Retry from the GST Portal detail page.",
      userAction: retryPortalGenerationAction(),
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
      "The browser reported that the filed GSTR-3B download completed. Check the local downloads folder for the GST Portal PDF.",
  };
}

export function unconfirmedObservation(signal: string): SafeDownloadObservation {
  return {
    state: "not-observed",
    safeSignals: ["browser-download-created", signal],
    safeMessage:
      "Pack saw a browser download event, but could not prove it was a non-empty filed GSTR-3B PDF from the GST Portal. Retry from the GST Portal detail page.",
    userAction: retryPortalGenerationAction(),
  };
}

export function downloadNotObserved(): SafeDownloadObservation {
  return {
    state: "not-observed",
    safeSignals: ["browser-download-not-observed"],
    safeMessage:
      "Pack clicked the filed GSTR-3B download control, but the browser did not report a download. Allow downloads for the GST Portal, then retry.",
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
      "The browser started the filed GSTR-3B download but reported that it was interrupted. Check browser download permissions and retry.",
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
    message: "Retry the filed GSTR-3B download from the GST Portal detail page.",
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
