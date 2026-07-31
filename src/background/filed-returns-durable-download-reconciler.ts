import { browser } from "wxt/browser";
import type { FiledReturnsTargetReview } from "../connectors/gst/filed-returns-contracts";
import type { DownloadCreatedItem, DownloadDelta } from "./download-observer";
import { persistFiledReturnsTargetDownloadId } from "./filed-returns-target-download-attempt";
import {
  readCurrentFiledReturnsTargetReview,
  type FiledReturnsTargetReviewDeps,
} from "./filed-returns-target-review";
import { reconcileFiledReturnsTargetDownload } from "./filed-returns-target-download-recovery";
import { PACK_LOCAL_STORAGE_KEYS, PACK_SESSION_STORAGE_KEYS } from "./storage-keys";

interface DownloadChangedEvent {
  addListener(listener: (delta: DownloadDelta) => void): void;
  removeListener(listener: (delta: DownloadDelta) => void): void;
}

interface DownloadCreatedEvent {
  addListener(listener: (item: DownloadCreatedItem) => void): void;
  removeListener(listener: (item: DownloadCreatedItem) => void): void;
}

export interface DurableDownloadReconcilerDownloads {
  onCreated?: DownloadCreatedEvent;
  onChanged: DownloadChangedEvent;
  search(query: { id: number }): Promise<DownloadCreatedItem[]>;
}

export interface DurableDownloadReconcilerDeps extends FiledReturnsTargetReviewDeps {
  extensionId?: string;
  persistDownloadId?: (review: FiledReturnsTargetReview, downloadId: number) => Promise<boolean>;
  readCurrentReview?: () => Promise<FiledReturnsTargetReview | null>;
  reconcile?: (review: FiledReturnsTargetReview) => Promise<unknown>;
}

const liveInlineObservationIds = new Set<number>();
const extensionOwnedCreationIds = new Set<number>();
const terminalChangesAwaitingPersistence = new Set<number>();

/** Keeps the global listener from racing the flow that already owns this exact ID. */
export function beginLiveFiledReturnsDownloadObservation(downloadId: number): () => void {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) return () => undefined;
  extensionOwnedCreationIds.delete(downloadId);
  terminalChangesAwaitingPersistence.delete(downloadId);
  liveInlineObservationIds.add(downloadId);
  return () => {
    liveInlineObservationIds.delete(downloadId);
    extensionOwnedCreationIds.delete(downloadId);
    terminalChangesAwaitingPersistence.delete(downloadId);
  };
}

/**
 * Reconciles only a previously persisted exact browser download ID. It is safe
 * to call at service-worker start, when the popup asks for current state, and
 * for terminal downloads.onChanged events. In-progress downloads are deliberately
 * left untouched so a native Save dialog can remain open as long as the user needs.
 */
export async function reconcileTerminalFiledReturnsDownload(
  downloads: Pick<DurableDownloadReconcilerDownloads, "search">,
  deps: DurableDownloadReconcilerDeps,
): Promise<boolean> {
  const review = await (deps.readCurrentReview
    ? deps.readCurrentReview()
    : readCurrentFiledReturnsTargetReview(deps));
  const attempt = review?.downloadAttempt;
  if (!review || !attempt || attempt.phase !== "download-observing") return false;

  const [item] = await downloads.search({ id: attempt.downloadId }).catch(() => []);
  if (!item || item.id !== attempt.downloadId || !isTerminalDownloadState(item.state)) return false;

  await (deps.reconcile
    ? deps.reconcile(review)
    : reconcileFiledReturnsTargetDownload(review, deps));
  return true;
}

export function installFiledReturnsDurableDownloadReconciler(
  downloads?: DurableDownloadReconcilerDownloads,
  deps: DurableDownloadReconcilerDeps = {
    storageKeys: {
      completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  },
): () => void {
  const downloadApi =
    downloads ?? (browser.downloads as unknown as DurableDownloadReconcilerDownloads | undefined);
  if (
    !downloadApi ||
    !downloadApi.onChanged ||
    typeof downloadApi.onChanged.addListener !== "function" ||
    typeof downloadApi.onChanged.removeListener !== "function" ||
    typeof downloadApi.search !== "function"
  ) {
    return () => undefined;
  }
  let inFlight: Promise<boolean> | null = null;
  let rerunAfterInFlight = false;

  const reconcile = () => {
    if (inFlight) {
      rerunAfterInFlight = true;
      return inFlight;
    }
    inFlight = reconcileTerminalFiledReturnsDownload(downloadApi, deps).finally(() => {
      inFlight = null;
      if (!rerunAfterInFlight) return;
      rerunAfterInFlight = false;
      void reconcile().catch(() => undefined);
    });
    return inFlight;
  };

  const onChanged = (delta: DownloadDelta) => {
    if (!isTerminalDownloadState(delta.state?.current) || liveInlineObservationIds.has(delta.id))
      return;
    if (extensionOwnedCreationIds.has(delta.id)) {
      // A complete event can arrive between onCreated and the persisted exact
      // ID. Remember it and reconcile immediately after persistence instead of
      // dropping the terminal evidence forever.
      terminalChangesAwaitingPersistence.add(delta.id);
      return;
    }
    void reconcile().catch(() => undefined);
  };

  const onCreated = (item: DownloadCreatedItem) => {
    if (liveInlineObservationIds.has(item.id)) return;
    terminalChangesAwaitingPersistence.delete(item.id);
    extensionOwnedCreationIds.add(item.id);
    // Suppression must cover only the gap between creation and persistence.
    // Holding a *persisted* ID suppressed strands its late terminal event: an
    // extension-owned ZIP left in a Save dialog past the inline observation
    // timeout completes with nothing listening, and nothing else releases the
    // ID, so reconciliation waited for a worker restart. Inline observers that
    // still own an ID register in liveInlineObservationIds instead.
    void persistExtensionOwnedDownloadId(item, deps).finally(() => {
      extensionOwnedCreationIds.delete(item.id);
      if (terminalChangesAwaitingPersistence.delete(item.id)) {
        void reconcile().catch(() => undefined);
      }
    });
  };

  downloadApi.onChanged.addListener(onChanged);
  downloadApi.onCreated?.addListener(onCreated);
  void reconcile().catch(() => undefined);
  return () => {
    downloadApi.onChanged.removeListener(onChanged);
    downloadApi.onCreated?.removeListener(onCreated);
  };
}

async function persistExtensionOwnedDownloadId(
  item: DownloadCreatedItem,
  deps: DurableDownloadReconcilerDeps,
): Promise<boolean> {
  const extensionId = deps.extensionId ?? browser.runtime.id;
  if (
    !Number.isSafeInteger(item.id) ||
    item.id < 0 ||
    !extensionId ||
    item.byExtensionId !== extensionId ||
    !startsAfterIntent(item.startTime, new Date(0))
  ) {
    return false;
  }
  const review = await (deps.readCurrentReview
    ? deps.readCurrentReview()
    : readCurrentFiledReturnsTargetReview(deps));
  const attempt = review?.downloadAttempt;
  if (!review || !attempt || attempt.phase !== "download-intent-persisted") return false;
  if (!startsAfterIntent(item.startTime, new Date(attempt.requestedAt))) return false;
  return deps.persistDownloadId
    ? deps.persistDownloadId(review, item.id)
    : persistFiledReturnsTargetDownloadId(review.scope, item.id, deps);
}

function startsAfterIntent(startTime: string | undefined, requestedAt: Date): boolean {
  if (!startTime || !Number.isFinite(requestedAt.getTime())) return false;
  const startedAt = Date.parse(startTime);
  return Number.isFinite(startedAt) && startedAt >= requestedAt.getTime();
}

function isTerminalDownloadState(state: string | undefined): boolean {
  return state === "complete" || state === "interrupted";
}
