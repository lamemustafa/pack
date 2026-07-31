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

const DEFAULT_TIMEOUT_MS = 30_000;

type DownloadFailure =
  | "checkpoint-failed"
  | "start-rejected"
  | "interrupted"
  | "empty"
  | "timeout"
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
    filenameReservation?.release();
    if (blobUrl) await deps.revokeOffscreenBlobUrl(blobUrl);
    if (offscreenRequested) await deps.closeOffscreenBlobDocument();
  }
}

export function installPortalBlobDownloadSafetyNet(tabId: number): () => void {
  const listener = (item: { id: number; tabId?: number; url?: string }) => {
    if (item.tabId === tabId && item.url?.startsWith("blob:")) {
      void browser.downloads
        .cancel(item.id)
        .then(() => browser.downloads.erase({ id: item.id }))
        .catch(() => undefined);
    }
  };
  browser.downloads.onCreated.addListener(listener);
  return () => browser.downloads.onCreated.removeListener(listener);
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
        .catch(() => finish({ ok: false, reason: "interrupted", safeSignals: [] }));
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
