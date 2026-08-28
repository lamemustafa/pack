import { browser } from "wxt/browser";
import {
  closeOffscreenBlobDocument,
  createOffscreenBlobUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";
import { installPackDownloadFilenameReassertion } from "./pack-download-filename-reassertion";
import type { PackDownloadFilenameReservation } from "./pack-download-filename-reassertion";
import { classifyRequestedFilenameOutcome } from "./download-filename-comparison";
import { classifyDownloadDanger } from "./download-observer-results";
import { extensionBlobUrlFingerprint } from "./filed-returns-durable-download-reconciler";
import { artifactFailureMessage } from "../connectors/gst/artifact-source";

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
  | { ok: false; reason: DownloadFailure; safeMessage: string; safeSignals: string[] };

const ARTIFACT_DOWNLOAD_FAILURE_MESSAGES = {
  "checkpoint-failed":
    "Pack started the browser download but could not save its exact recovery record. Check browser Downloads before retrying.",
  "start-rejected":
    "Pack could not start the local filed-return download. Check browser Downloads, then retry.",
  interrupted:
    "The browser interrupted the filed-return download, so Pack did not mark the target saved. Check browser Downloads before retrying.",
  empty:
    "The browser completed an empty filed-return download, so Pack did not mark the target saved.",
  timeout:
    "Pack could not confirm the exact browser download result, so it did not mark the target saved. Check browser Downloads before retrying.",
  "search-unavailable":
    "Pack could not query the exact browser download, so it did not mark the target saved. Check browser Downloads before retrying.",
} satisfies Record<Exclude<DownloadFailure, "danger-unconfirmed" | "danger-rejected">, string>;

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
    if (!blobUrl) return failedArtifactDownload("start-rejected");
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
      return failedArtifactDownload("start-rejected");
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
      return failedArtifactDownload("checkpoint-failed");
    }
    return await awaitCompletion(deps.downloads, downloadId, input.filename, deps.timeoutMs);
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
          if (item.state === "interrupted") return finish(failedArtifactDownload("interrupted"));
          if (item.state === "complete") {
            // A completed, non-empty item is not proof on its own. The shared
            // observer refuses to treat an unclassified, still-scanning or
            // browser-rejected download as evidence, and this path must make
            // the same call from the same predicate rather than restate it.
            const danger = classifyDownloadDanger(item);
            if (danger !== "safe") {
              return finish(
                failedArtifactDownload(
                  danger === "rejected" ? "danger-rejected" : "danger-unconfirmed",
                  [
                    danger === "rejected"
                      ? "browser-download-danger-rejected"
                      : danger === "pending"
                        ? "browser-download-danger-pending"
                        : "browser-download-danger-unknown",
                  ],
                ),
              );
            }
            const bytes = Math.max(
              item.bytesReceived ?? 0,
              item.fileSize ?? 0,
              item.totalBytes ?? 0,
            );
            return finish(
              bytes > 0
                ? completedArtifact(downloadId, bytes, requestedFilename, item.filename)
                : failedArtifactDownload("empty"),
            );
          }
        })
        .catch(() =>
          finish(
            failedArtifactDownload("search-unavailable", ["browser-download-search-unavailable"]),
          ),
        );
    const listener = (delta: { id: number }) => {
      if (delta.id === downloadId) inspect();
    };
    const timer = globalThis.setTimeout(() => finish(failedArtifactDownload("timeout")), timeoutMs);
    downloads.onChanged.addListener(listener);
    inspect();
  });
}

function failedArtifactDownload(
  reason: DownloadFailure,
  safeSignals: string[] = [],
): ArtifactDownloadResult {
  return {
    ok: false,
    reason,
    safeMessage: artifactDownloadFailureMessage(reason),
    safeSignals,
  };
}

function artifactDownloadFailureMessage(reason: DownloadFailure): string {
  if (reason === "danger-unconfirmed" || reason === "danger-rejected") {
    return artifactFailureMessage(reason);
  }
  return ARTIFACT_DOWNLOAD_FAILURE_MESSAGES[reason];
}

function completedArtifact(
  downloadId: number,
  bytesReceived: number,
  requestedFilename: string,
  observedFilename: string | undefined,
): Extract<ArtifactDownloadResult, { ok: true }> {
  const filenameOutcome = classifyRequestedFilenameOutcome(requestedFilename, observedFilename);
  if (filenameOutcome === "matched") {
    return { ok: true, downloadId, bytesReceived, safeSignals: [] };
  }
  if (filenameOutcome === "unavailable") {
    return {
      ok: true,
      downloadId,
      bytesReceived,
      safeMessage:
        "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file.",
      safeSignals: ["download-filename-unavailable"],
    };
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
