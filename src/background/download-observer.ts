import type { UserActionRequired } from "../core/contracts";
import type {
  BrowserDownloadSafeEvidence,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { DownloadObservationContext } from "./download-correlation";
import { beginLiveFiledReturnsDownloadObservation } from "./filed-returns-durable-download-reconciler";
import {
  completedObservation,
  downloadInProgress,
  downloadNotObserved,
  failedObservation,
} from "./download-observer-results";

const DEFAULT_DOWNLOAD_WAIT_MS = 30_000;
const COMPLETED_DOWNLOAD_RECHECK_MS = 500;

export type SafeDownloadObservationState = "completed" | "failed" | "not-observed";

export interface SafeDownloadObservation {
  state: SafeDownloadObservationState;
  safeSignals: string[];
  safeMessage: string;
  userAction?: UserActionRequired;
  safeEvidence?: BrowserDownloadSafeEvidence;
}

export interface DownloadCreatedItem {
  id: number;
  byExtensionId?: string | undefined;
  incognito?: boolean | undefined;
  state?: string | undefined;
  danger?: string | undefined;
  exists?: boolean | undefined;
  error?: string | undefined;
  bytesReceived?: number | undefined;
  fileSize?: number | undefined;
  totalBytes?: number | undefined;
  filename?: string | undefined;
  finalUrl?: string | undefined;
  mime?: string | undefined;
  referrer?: string | undefined;
  startTime?: string | undefined;
  url?: string | undefined;
}

export interface DownloadDelta {
  id: number;
  state?: { current?: string | undefined } | undefined;
  error?: { current?: string | undefined } | undefined;
}

interface DownloadSearchQuery {
  id: number;
}

interface DownloadEvent<T> {
  addListener(listener: (input: T) => void): void;
  removeListener(listener: (input: T) => void): void;
}

export interface DownloadObservationApi {
  onChanged: DownloadEvent<DownloadDelta>;
  search(query: DownloadSearchQuery): Promise<DownloadCreatedItem[]>;
}

export async function observeBrowserDownloadById(
  downloads: DownloadObservationApi,
  downloadId: number,
  context: DownloadObservationContext,
  timeoutMs = DEFAULT_DOWNLOAD_WAIT_MS,
): Promise<SafeDownloadObservation> {
  const [initialItem] = await downloads.search({ id: downloadId }).catch(() => []);
  if (initialItem?.state === "interrupted") {
    return failedObservation(initialItem.error);
  }

  return new Promise<SafeDownloadObservation>((resolve) => {
    let completedItem: DownloadCreatedItem | undefined = initialItem;
    let completedCheckPromise: Promise<void> | null = null;
    let lastUnconfirmedObservation: SafeDownloadObservation | null =
      initialItem?.state === "in_progress" ? downloadInProgress() : null;
    let recheckId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let settled = false;
    // Claim this exact ID for the duration of inline observation so the global
    // durable listener does not reconcile the same download concurrently, and
    // release it on settle so a later terminal event is reconciled durably.
    const endLiveObservation = beginLiveFiledReturnsDownloadObservation(downloadId);

    const cleanup = () => {
      endLiveObservation();
      downloads.onChanged.removeListener(onChanged);
      if (recheckId) globalThis.clearTimeout(recheckId);
      recheckId = null;
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      timeoutId = null;
    };

    const settle = (observation: SafeDownloadObservation) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(observation);
    };

    function onChanged(delta: DownloadDelta) {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        void checkCompletedDownload();
        return;
      }
      if (delta.state?.current === "interrupted") {
        settle(failedObservation(delta.error?.current));
      }
    }

    downloads.onChanged.addListener(onChanged);
    if (initialItem?.state === "complete") {
      void checkCompletedDownload(initialItem);
    }
    void downloads
      .search({ id: downloadId })
      .then(([latestItem]) => {
        if (latestItem?.state === "complete") {
          void checkCompletedDownload(latestItem);
          return;
        }
        if (latestItem?.state === "interrupted") {
          settle(failedObservation(latestItem.error));
          return;
        }
        if (latestItem?.state === "in_progress") lastUnconfirmedObservation = downloadInProgress();
      })
      .catch(() => undefined);
    timeoutId = globalThis.setTimeout(() => void settleFromFinalSearch(), timeoutMs);

    function checkCompletedDownload(fallbackItem = completedItem): Promise<void> {
      if (settled) return Promise.resolve();
      if (completedCheckPromise) return completedCheckPromise;
      completedItem = fallbackItem;
      const checkPromise = evaluateCompletedDownload(fallbackItem);
      completedCheckPromise = checkPromise;
      void checkPromise.then(
        () => {
          if (completedCheckPromise === checkPromise) completedCheckPromise = null;
        },
        () => {
          if (completedCheckPromise === checkPromise) completedCheckPromise = null;
        },
      );
      return checkPromise;
    }

    async function evaluateCompletedDownload(fallbackItem = completedItem) {
      const observation = await completedObservation(downloads, downloadId, context, fallbackItem);
      if (settled) return;
      if (!shouldRecheckCompletedDownload(observation)) {
        settle(observation);
        return;
      }
      lastUnconfirmedObservation = observation;
      if (recheckId) globalThis.clearTimeout(recheckId);
      recheckId = globalThis.setTimeout(() => {
        recheckId = null;
        void checkCompletedDownload();
      }, COMPLETED_DOWNLOAD_RECHECK_MS);
    }

    async function settleFromFinalSearch() {
      if (settled) return;
      const inFlightCheck = completedCheckPromise;
      if (inFlightCheck) await inFlightCheck;
      if (settled) return;
      const [latestItem] = await downloads.search({ id: downloadId }).catch(() => []);
      if (settled) return;
      if (latestItem?.state === "complete") {
        settle(await completedObservation(downloads, downloadId, context, latestItem));
        return;
      }
      if (latestItem?.state === "interrupted") {
        settle(failedObservation(latestItem.error));
        return;
      }
      if (latestItem?.state === "in_progress") {
        settle(downloadInProgress());
        return;
      }
      settle(lastUnconfirmedObservation ?? downloadNotObserved());
    }
  });
}

function shouldRecheckCompletedDownload(observation: SafeDownloadObservation): boolean {
  return (
    observation.state === "not-observed" &&
    observation.safeSignals.some((signal) =>
      [
        "browser-download-search-missing",
        "browser-download-state-unconfirmed",
        "browser-download-size-unknown",
        "browser-download-danger-unknown",
        "browser-download-danger-pending",
      ].includes(signal),
    )
  );
}

export function mergeFlowStepWithDownloadObservation(
  step: PortalFlowStepResult,
  observation: SafeDownloadObservation,
): PortalFlowStepResult {
  if (observation.state === "completed") {
    return {
      ...step,
      state: "downloaded",
      safeSignals: [...step.safeSignals, ...observation.safeSignals],
      safeMessage: observation.safeMessage,
    };
  }

  return {
    ...step,
    state: observation.state === "failed" ? "blocked" : "download-unconfirmed",
    safeSignals: [...step.safeSignals, ...observation.safeSignals],
    safeMessage: observation.safeMessage,
    ...(observation.userAction ? { userAction: observation.userAction } : {}),
  };
}
