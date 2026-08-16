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

export interface DurableDownloadReconcilerDeps extends Omit<
  FiledReturnsTargetReviewDeps,
  "storageKeys"
> {
  storageKeys: FiledReturnsTargetReviewDeps["storageKeys"] & { activeRun?: string };
  extensionId?: string;
  persistDownloadId?: (review: FiledReturnsTargetReview, downloadId: number) => Promise<boolean>;
  readCurrentReview?: () => Promise<FiledReturnsTargetReview | null>;
  reconcile?: (review: FiledReturnsTargetReview) => Promise<unknown>;
  reconcileFullFiscalYearZip?: (downloadId: number) => Promise<boolean>;
}

const liveInlineObservationIds = new Set<number>();
const extensionOwnedCreationIds = new Set<number>();
const extensionBlobCreationCandidates = new Set<number>();
const terminalChangesAwaitingPersistence = new Set<number>();
const pendingExtensionDownloadUrls = new Set<string>();

/**
 * Produces a non-reversible local correlation value for an extension Blob URL.
 * The raw URL stays in memory only; the selected-ZIP recovery checkpoint stores
 * this digest so a restarted MV3 worker can still match its onCreated event.
 */
export async function extensionBlobUrlFingerprint(url: string): Promise<string | null> {
  if (!url.startsWith("blob:")) return null;
  try {
    const bytes = new TextEncoder().encode(url);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}

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

/** Registers one extension Blob URL for the brief onCreated-to-ID-persistence gap. */
export function beginPendingExtensionDownloadUrl(url: string): () => void {
  if (!url.startsWith("blob:chrome-extension://")) return () => undefined;
  pendingExtensionDownloadUrls.add(url);
  return () => pendingExtensionDownloadUrls.delete(url);
}

/**
 * Reconciles only a persisted target-review download ID. It is safe
 * to call at service-worker start, when the popup asks for current state, and
 * for terminal downloads.onChanged events. In-progress downloads are deliberately
 * left untouched so a native Save dialog can remain open as long as the user needs.
 */
export async function reconcileTerminalFiledReturnsDownload(
  downloads: Pick<DurableDownloadReconcilerDownloads, "search">,
  deps: DurableDownloadReconcilerDeps,
): Promise<boolean> {
  return reconcileCurrentTargetReview(downloads, deps);
}

async function reconcileCurrentTargetReview(
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
      activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun,
      completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
      targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  },
): () => void {
  void removeLegacyArtifactAcquisitionCompletionMarkers(deps.storageKeys.targetReview).catch(
    () => undefined,
  );
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
  const terminalDownloadIds = new Set<number>();

  const reconcile = (terminalDownloadId?: number) => {
    if (terminalDownloadId !== undefined) terminalDownloadIds.add(terminalDownloadId);
    if (inFlight) {
      rerunAfterInFlight = true;
      return inFlight;
    }
    const pendingTerminalDownloadIds = Array.from(terminalDownloadIds);
    terminalDownloadIds.clear();
    inFlight = Promise.all([
      reconcileTerminalFiledReturnsDownload(downloadApi, deps),
      pendingTerminalDownloadIds.length === 0 || !deps.reconcileFullFiscalYearZip
        ? Promise.resolve(false)
        : Promise.all(
            pendingTerminalDownloadIds.map((downloadId) =>
              deps.reconcileFullFiscalYearZip!(downloadId),
            ),
          ).then((results) => results.some(Boolean)),
    ])
      .then((results) => results.some(Boolean))
      .finally(() => {
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
    if (extensionOwnedCreationIds.has(delta.id) || extensionBlobCreationCandidates.has(delta.id)) {
      // A complete event can arrive between onCreated and the persisted exact
      // ID. Remember it and reconcile immediately after persistence instead of
      // dropping the terminal evidence forever.
      terminalChangesAwaitingPersistence.add(delta.id);
      return;
    }
    void reconcile(delta.id).catch(() => undefined);
  };

  const onCreated = (item: DownloadCreatedItem) => {
    if (liveInlineObservationIds.has(item.id)) return;
    if (!isExtensionBlobCreationCandidate(item, deps)) return;
    // Claim synchronously before the async fingerprint/storage reads. A ZIP can
    // reach a terminal browser state before this listener has resolved either.
    terminalChangesAwaitingPersistence.delete(item.id);
    extensionBlobCreationCandidates.add(item.id);
    void claimPendingExtensionDownload(item, deps, reconcile);
  };

  downloadApi.onChanged.addListener(onChanged);
  downloadApi.onCreated?.addListener(onCreated);
  void reconcile().catch(() => undefined);
  return () => {
    downloadApi.onChanged.removeListener(onChanged);
    downloadApi.onCreated?.removeListener(onCreated);
  };
}

async function removeLegacyArtifactAcquisitionCompletionMarkers(
  targetReviewKey: string | undefined,
): Promise<void> {
  if (!targetReviewKey) return;
  const values = await browser.storage.local.get();
  const prefix = `${targetReviewKey}:completion:`;
  const keys = Object.keys(values).filter((key) => key.startsWith(prefix));
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

async function claimPendingExtensionDownload(
  item: DownloadCreatedItem,
  deps: DurableDownloadReconcilerDeps,
  reconcile: (terminalDownloadId?: number) => Promise<boolean>,
): Promise<void> {
  if (!item.url) return;
  const liveMatch = pendingExtensionDownloadUrls.has(item.url);
  const fingerprint = liveMatch ? null : await extensionBlobUrlFingerprint(item.url);
  const review = await (deps.readCurrentReview
    ? deps.readCurrentReview()
    : readCurrentFiledReturnsTargetReview(deps));
  const attempt = review?.downloadAttempt;
  const durableMatch =
    attempt?.kind === "single-period-zip" &&
    attempt.phase === "download-intent-persisted" &&
    Boolean(fingerprint) &&
    fingerprint === attempt.extensionBlobUrlFingerprint;
  if (!liveMatch && !durableMatch) {
    extensionBlobCreationCandidates.delete(item.id);
    terminalChangesAwaitingPersistence.delete(item.id);
    return;
  }

  extensionBlobCreationCandidates.delete(item.id);
  extensionOwnedCreationIds.add(item.id);
  // Suppression must cover only the gap between creation and persistence.
  // Holding a *persisted* ID suppressed strands its late terminal event: an
  // extension-owned ZIP left in a Save dialog past the inline observation
  // timeout completes with nothing listening, and nothing else releases the
  // ID, so reconciliation waited for a worker restart. Inline observers that
  // still own an ID register in liveInlineObservationIds instead.
  await persistExtensionOwnedDownloadId(item, deps).finally(() => {
    extensionOwnedCreationIds.delete(item.id);
    if (terminalChangesAwaitingPersistence.delete(item.id)) {
      void reconcile(item.id).catch(() => undefined);
    }
  });
}

function isExtensionBlobCreationCandidate(
  item: DownloadCreatedItem,
  deps: DurableDownloadReconcilerDeps,
): boolean {
  const extensionId = deps.extensionId ?? browser.runtime.id;
  return Boolean(
    item.url?.startsWith("blob:chrome-extension://") &&
    extensionId &&
    item.byExtensionId === extensionId,
  );
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
