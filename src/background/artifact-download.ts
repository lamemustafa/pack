import { browser } from "wxt/browser";
import {
  closeOffscreenBlobDocument,
  createOffscreenBlobUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";
import { installPackDownloadFilenameReassertion } from "./pack-download-filename-reassertion";

const DEFAULT_TIMEOUT_MS = 30_000;

type DownloadFailure = "checkpoint-failed" | "start-rejected" | "interrupted" | "empty" | "timeout";
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
  releaseRequestedFilename: (downloadId: number) => void;
  trackRequestedFilename: (downloadId: number, filename: string) => void;
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
    releaseRequestedFilename:
      overrides.releaseRequestedFilename ??
      ((downloadId) => installPackDownloadFilenameReassertion().release(downloadId)),
    trackRequestedFilename:
      overrides.trackRequestedFilename ??
      ((downloadId, filename) =>
        installPackDownloadFilenameReassertion().track(downloadId, filename)),
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  let blobUrl: string | null = null;
  let trackedDownloadId: number | null = null;
  let offscreenRequested = false;
  try {
    offscreenRequested = true;
    blobUrl = await deps.createOffscreenBlobUrl(`data:${input.mimeType};base64,${input.base64}`);
    if (!blobUrl) return { ok: false, reason: "start-rejected", safeSignals: [] };
    let downloadId: number;
    try {
      downloadId = await deps.downloads.download({
        conflictAction: "uniquify",
        filename: input.filename,
        saveAs: false,
        url: blobUrl,
      });
      deps.trackRequestedFilename(downloadId, input.filename);
      trackedDownloadId = downloadId;
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
    if (trackedDownloadId !== null) deps.releaseRequestedFilename(trackedDownloadId);
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
  const observedBasename = filenameBasename(normaliseFilenamePath(observedFilename ?? ""));
  return {
    ok: true,
    downloadId,
    bytesReceived,
    safeMessage:
      `Another extension changed where this file was saved; Pack asked for ${requestedFilename}; ` +
      `the browser saved it elsewhere as ${observedBasename}.`,
    safeSignals: ["download-filename-overridden"],
  };
}

function isRequestedFilenameOverridden(
  requestedFilename: string,
  observedFilename: string | undefined,
): boolean {
  if (!observedFilename) return false;
  const requestedPath = normaliseFilenamePath(requestedFilename);
  const observedPath = normaliseFilenamePath(observedFilename);
  const expectedBasename = filenameBasename(requestedPath);
  const observedBasename = filenameBasename(observedPath);
  const requestedDirectory = requestedPath.slice(0, requestedPath.lastIndexOf("/"));
  const observedDirectory = observedPath.slice(0, observedPath.lastIndexOf("/"));
  const relativeDirectoryMatches =
    observedDirectory === requestedDirectory ||
    observedDirectory.endsWith(`/${requestedDirectory}`);
  return !relativeDirectoryMatches || !matchesRequestedBasename(expectedBasename, observedBasename);
}

function matchesRequestedBasename(requested: string, observed: string): boolean {
  if (observed === requested) return true;
  const extensionIndex = requested.lastIndexOf(".");
  const base = extensionIndex > 0 ? requested.slice(0, extensionIndex) : requested;
  const extension = extensionIndex > 0 ? requested.slice(extensionIndex) : "";
  return (
    observed.startsWith(`${base} (`) &&
    observed.endsWith(`)${extension}`) &&
    /^\d+$/.test(observed.slice(base.length + 2, observed.length - extension.length - 1))
  );
}

function filenameBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function normaliseFilenamePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}
