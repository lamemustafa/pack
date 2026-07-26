import { browser } from "wxt/browser";

const KEY = "pack.artifact-acquisition.v1";
export type ArtifactAcquisitionCheckpoint = {
  requestId: string;
  artifactType: "PDF" | "JSON";
  state: "intent" | "download-observing";
  downloadId?: number;
};

export async function persistArtifactAcquisitionIntent(
  input: Omit<ArtifactAcquisitionCheckpoint, "state" | "downloadId">,
): Promise<void> {
  await browser.storage.session.set({
    [KEY]: { ...input, state: "intent" } satisfies ArtifactAcquisitionCheckpoint,
  });
}

export async function persistArtifactAcquisitionDownloadId(
  input: ArtifactAcquisitionCheckpoint,
): Promise<void> {
  await browser.storage.session.set({
    [KEY]: { ...input, state: "download-observing" } satisfies ArtifactAcquisitionCheckpoint,
  });
}

export async function clearArtifactAcquisitionCheckpoint(requestId: string): Promise<void> {
  const stored = await browser.storage.session.get(KEY);
  if ((stored[KEY] as { requestId?: unknown } | undefined)?.requestId === requestId)
    await browser.storage.session.remove(KEY);
}

export async function clearCompletedArtifactAcquisitionCheckpoint(): Promise<void> {
  await browser.storage.session.remove(KEY);
}

export async function reconcileArtifactAcquisitionCheckpoint(): Promise<
  { state: "retry-safe" } | { state: "needs-review"; safeSignals: string[] }
> {
  const stored = await browser.storage.session.get(KEY);
  const checkpoint = stored[KEY] as ArtifactAcquisitionCheckpoint | undefined;
  if (!checkpoint || typeof checkpoint.requestId !== "string") return { state: "retry-safe" };
  if (checkpoint.state !== "download-observing" || !Number.isSafeInteger(checkpoint.downloadId)) {
    return { state: "needs-review", safeSignals: ["artifact-acquisition-intent-interrupted"] };
  }
  try {
    const [item] = await browser.downloads.search({ id: checkpoint.downloadId });
    if (
      item?.state === "complete" &&
      Math.max(item.bytesReceived ?? 0, item.fileSize ?? 0, item.totalBytes ?? 0) > 0
    ) {
      return {
        state: "needs-review",
        safeSignals: ["artifact-acquisition-download-complete-unreconciled"],
      };
    }
    return { state: "needs-review", safeSignals: ["artifact-acquisition-download-unreconciled"] };
  } catch {
    return {
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-search-unavailable"],
    };
  }
}
