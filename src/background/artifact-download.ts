import { browser } from "wxt/browser";
import { closeOffscreenBlobDocument, createOffscreenBlobUrl, revokeOffscreenBlobUrl } from "./offscreen-blob-url";

const DATA_URL_LIMIT = 1_500_000;
const DEFAULT_TIMEOUT_MS = 30_000;

type DownloadFailure = "start-rejected" | "interrupted" | "empty" | "timeout";
export type ArtifactDownloadResult =
  | { ok: true; downloadId: number; bytesReceived: number; safeSignals: string[] }
  | { ok: false; reason: DownloadFailure; safeSignals: string[] };

type DownloadApi = Pick<typeof browser.downloads, "download" | "search" | "onChanged">;
type DeliveryDeps = {
  downloads: DownloadApi;
  createOffscreenBlobUrl: typeof createOffscreenBlobUrl;
  revokeOffscreenBlobUrl: typeof revokeOffscreenBlobUrl;
  closeOffscreenBlobDocument: typeof closeOffscreenBlobDocument;
  timeoutMs: number;
};

export async function downloadAcquiredArtifact(
  input: { requestId: string; base64: string; mimeType: string; filename: string; onStarted?: (downloadId: number) => Promise<void> },
  overrides: Partial<DeliveryDeps> = {},
): Promise<ArtifactDownloadResult> {
  const deps: DeliveryDeps = {
    downloads: overrides.downloads ?? browser.downloads,
    createOffscreenBlobUrl: overrides.createOffscreenBlobUrl ?? createOffscreenBlobUrl,
    revokeOffscreenBlobUrl: overrides.revokeOffscreenBlobUrl ?? revokeOffscreenBlobUrl,
    closeOffscreenBlobDocument: overrides.closeOffscreenBlobDocument ?? closeOffscreenBlobDocument,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  let blobUrl: string | null = null;
  try {
    const url = input.base64.length <= DATA_URL_LIMIT
      ? `data:${input.mimeType};base64,${input.base64}`
      : (blobUrl = await deps.createOffscreenBlobUrl(`data:${input.mimeType};base64,${input.base64}`));
    if (!url) return { ok: false, reason: "start-rejected", safeSignals: [] };
    let downloadId: number;
    try {
      downloadId = await deps.downloads.download({ conflictAction: "uniquify", filename: input.filename, saveAs: false, url });
      await input.onStarted?.(downloadId);
    } catch {
      return { ok: false, reason: "start-rejected", safeSignals: [] };
    }
    return await awaitCompletion(deps.downloads, downloadId, deps.timeoutMs);
  } finally {
    if (blobUrl) await deps.revokeOffscreenBlobUrl(blobUrl);
    if (blobUrl) await deps.closeOffscreenBlobDocument();
  }
}

export function installPortalBlobDownloadSafetyNet(tabId: number): () => void {
  const listener = (item: { id: number; tabId?: number; url?: string }) => {
    if (item.tabId === tabId && item.url?.startsWith("blob:")) {
      void browser.downloads.cancel(item.id).then(() => browser.downloads.erase({ id: item.id })).catch(() => undefined);
    }
  };
  browser.downloads.onCreated.addListener(listener);
  return () => browser.downloads.onCreated.removeListener(listener);
}

function awaitCompletion(downloads: DownloadApi, downloadId: number, timeoutMs: number): Promise<ArtifactDownloadResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: ArtifactDownloadResult) => {
      if (done) return;
      done = true;
      globalThis.clearTimeout(timer);
      downloads.onChanged.removeListener(listener);
      resolve(result);
    };
    const inspect = () => void downloads.search({ id: downloadId }).then(([item]) => {
      if (!item) return;
      if (item.state === "interrupted") return finish({ ok: false, reason: "interrupted", safeSignals: [] });
      if (item.state === "complete") {
        const bytes = Math.max(item.bytesReceived ?? 0, item.fileSize ?? 0, item.totalBytes ?? 0);
        return finish(bytes > 0 ? { ok: true, downloadId, bytesReceived: bytes, safeSignals: [] } : { ok: false, reason: "empty", safeSignals: [] });
      }
    }).catch(() => finish({ ok: false, reason: "interrupted", safeSignals: [] }));
    const listener = (delta: { id: number }) => { if (delta.id === downloadId) inspect(); };
    const timer = globalThis.setTimeout(() => finish({ ok: false, reason: "timeout", safeSignals: [] }), timeoutMs);
    downloads.onChanged.addListener(listener);
    inspect();
  });
}
