import { browser } from "wxt/browser";
import {
  closeOffscreenBlobDocument,
  createOffscreenBlobUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";
import { installPackDownloadFilenameReassertion } from "./pack-download-filename-reassertion";
import type { PackDownloadFilenameReservation } from "./pack-download-filename-reassertion";
import { isRequestedFilenameOverridden } from "./download-filename-comparison";
import { classifyDownloadDanger } from "./download-observer-results";
import {
  beginLiveFiledReturnsDownloadObservation,
  extensionBlobUrlFingerprint,
} from "./filed-returns-durable-download-reconciler";

const DEFAULT_TIMEOUT_MS = 30_000;

type DownloadFailure =
  | "checkpoint-failed"
  | "start-rejected"
  | "interrupted"
  | "empty"
  | "timeout"
  | "search-unavailable"
  | "danger-unconfirmed"
  | "danger-rejected";
export type ArtifactDownloadResult =
  | {
      ok: true;
      downloadId: number;
      bytesReceived: number;
      safeMessage?: string;
      safeSignals: string[];
    }
  | { ok: false; reason: DownloadFailure; safeSignals: string[] };

type DownloadApi = Pick<typeof browser.downloads, "download" | "search" | "onChanged">;
type DeliveryDeps = {
  downloads: DownloadApi;
  createOffscreenBlobUrl: typeof createOffscreenBlobUrl;
  revokeOffscreenBlobUrl: typeof revokeOffscreenBlobUrl;
  closeOffscreenBlobDocument: typeof closeOffscreenBlobDocument;
  reserveRequestedFilename: (url: string, filename: string) => PackDownloadFilenameReservation;
  timeoutMs: number;
};

export async function downloadAcquiredArtifact(
  input: {
    requestId: string;
    base64: string;
    mimeType: string;
    filename: string;
    onStarted?: (downloadId: number) => Promise<void>;
    onStartCheckpointFailed?: (downloadId: number) => Promise<void>;
  },
  overrides: Partial<DeliveryDeps> = {},
): Promise<ArtifactDownloadResult> {
  const deps: DeliveryDeps = {
    downloads: overrides.downloads ?? browser.downloads,
    createOffscreenBlobUrl: overrides.createOffscreenBlobUrl ?? createOffscreenBlobUrl,
    revokeOffscreenBlobUrl: overrides.revokeOffscreenBlobUrl ?? revokeOffscreenBlobUrl,
    closeOffscreenBlobDocument: overrides.closeOffscreenBlobDocument ?? closeOffscreenBlobDocument,
    reserveRequestedFilename:
      overrides.reserveRequestedFilename ??
      ((url, filename) => installPackDownloadFilenameReassertion().reserve(url, filename)),
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  let blobUrl: string | null = null;
  let filenameReservation: PackDownloadFilenameReservation | null = null;
  let offscreenRequested = false;
  try {
    offscreenRequested = true;
    blobUrl = await deps.createOffscreenBlobUrl(`data:${input.mimeType};base64,${input.base64}`);
    if (!blobUrl) return { ok: false, reason: "start-rejected", safeSignals: [] };
    filenameReservation = deps.reserveRequestedFilename(blobUrl, input.filename);
    let downloadId: number;
    try {
      downloadId = await deps.downloads.download({
        conflictAction: "uniquify",
        filename: input.filename,
        saveAs: false,
        url: blobUrl,
      });
      filenameReservation.bind(downloadId);
    } catch {
      return { ok: false, reason: "start-rejected", safeSignals: [] };
    }
    // The foreground flow owns this exact ID until its completion observer has
    // persisted the terminal result. The durable scanner must leave that
    // checkpoint alone; if the worker stops, the claim disappears but the
    // checkpoint remains for the next-start guard.
    const endLiveObservation = beginLiveFiledReturnsDownloadObservation(downloadId);
    try {
      try {
        await input.onStarted?.(downloadId);
      } catch {
        try {
          await input.onStartCheckpointFailed?.(downloadId);
        } catch {
          // Keep the original intent checkpoint for fail-closed recovery.
        }
        await awaitCompletion(deps.downloads, downloadId, input.filename, deps.timeoutMs);
        return { ok: false, reason: "checkpoint-failed", safeSignals: [] };
      }
      return await awaitCompletion(deps.downloads, downloadId, input.filename, deps.timeoutMs);
    } finally {
      endLiveObservation();
    }
  } finally {
    filenameReservation?.release();
    if (blobUrl) await deps.revokeOffscreenBlobUrl(blobUrl);
    if (offscreenRequested) await deps.closeOffscreenBlobDocument();
  }
}

export function installPortalBlobDownloadSafetyNet(tabId: number): {
  bind(blobUrl: unknown): Promise<void>;
  remove(): void;
} {
  let expectedFingerprint: string | null = null;
  const candidates = new Map<number, { id: number; tabId?: number; url?: string }>();
  const handle = async (item: { id: number; tabId?: number; url?: string }) => {
    if (item.tabId !== tabId || !item.url?.startsWith("blob:")) return;
    if (!expectedFingerprint) return void candidates.set(item.id, item);
    if ((await extensionBlobUrlFingerprint(item.url)) !== expectedFingerprint) return;
    candidates.delete(item.id);
    try {
      await browser.downloads.cancel(item.id);
    } finally {
      await browser.downloads.erase({ id: item.id });
    }
  };
  const listener = (item: { id: number; tabId?: number; url?: string }) =>
    void handle(item).catch(() => undefined);
  browser.downloads.onCreated.addListener(listener);
  return {
    async bind(blobUrl) {
      if (typeof blobUrl !== "string" || !blobUrl.startsWith("blob:")) return;
      expectedFingerprint = await extensionBlobUrlFingerprint(blobUrl);
      if (!expectedFingerprint) return;
      for (const candidate of candidates.values()) void handle(candidate).catch(() => undefined);
    },
    remove: () => browser.downloads.onCreated.removeListener(listener),
  };
}

function awaitCompletion(
  downloads: DownloadApi,
  downloadId: number,
  requestedFilename: string,
  timeoutMs: number,
): Promise<ArtifactDownloadResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: ArtifactDownloadResult) => {
      if (done) return;
      done = true;
      globalThis.clearTimeout(timer);
      downloads.onChanged.removeListener(listener);
      resolve(result);
    };
    const inspect = () =>
      void downloads
        .search({ id: downloadId })
        .then(([item]) => {
          if (!item) return;
          if (item.state === "interrupted")
            return finish({ ok: false, reason: "interrupted", safeSignals: [] });
          if (item.state === "complete") {
            // A completed, non-empty item is not proof on its own. The shared
            // observer refuses to treat an unclassified, still-scanning or
            // browser-rejected download as evidence, and this path must make
            // the same call from the same predicate rather than restate it.
            const danger = classifyDownloadDanger(item);
            if (danger !== "safe") {
              return finish({
                ok: false,
                reason: danger === "rejected" ? "danger-rejected" : "danger-unconfirmed",
                safeSignals: [
                  danger === "rejected"
                    ? "browser-download-danger-rejected"
                    : danger === "pending"
                      ? "browser-download-danger-pending"
                      : "browser-download-danger-unknown",
                ],
              });
            }
            const bytes = Math.max(
              item.bytesReceived ?? 0,
              item.fileSize ?? 0,
              item.totalBytes ?? 0,
            );
            return finish(
              bytes > 0
                ? completedArtifact(downloadId, bytes, requestedFilename, item.filename)
                : { ok: false, reason: "empty", safeSignals: [] },
            );
          }
        })
        .catch(() =>
          finish({
            ok: false,
            reason: "search-unavailable",
            safeSignals: ["browser-download-search-unavailable"],
          }),
        );
    const listener = (delta: { id: number }) => {
      if (delta.id === downloadId) inspect();
    };
    const timer = globalThis.setTimeout(
      () => finish({ ok: false, reason: "timeout", safeSignals: [] }),
      timeoutMs,
    );
    downloads.onChanged.addListener(listener);
    inspect();
  });
}

function completedArtifact(
  downloadId: number,
  bytesReceived: number,
  requestedFilename: string,
  observedFilename: string | undefined,
): Extract<ArtifactDownloadResult, { ok: true }> {
  if (!isRequestedFilenameOverridden(requestedFilename, observedFilename)) {
    return { ok: true, downloadId, bytesReceived, safeSignals: [] };
  }
  return {
    ok: true,
    downloadId,
    bytesReceived,
    safeMessage:
      "Another extension changed where this file was saved. Check browser Downloads before using it.",
    safeSignals: ["download-filename-overridden"],
  };
}
