import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";

const KEY_PREFIX = "pack.artifact-acquisition.v2";

export type ArtifactAcquisitionTarget = Pick<
  FiledReturnsDownloadScope,
  "artifactType" | "financialYear" | "period" | "returnType"
>;

export type ArtifactAcquisitionCheckpoint = ArtifactAcquisitionTarget & {
  requestId: string;
  state: "intent" | "download-observing";
  downloadId?: number;
};

export function artifactAcquisitionCheckpointKey(target: ArtifactAcquisitionTarget): string {
  const artifactType = target.artifactType ?? "PDF";
  return [KEY_PREFIX, target.returnType, target.financialYear, target.period, artifactType]
    .map((value) => encodeURIComponent(value ?? ""))
    .join(".");
}

export async function persistArtifactAcquisitionIntent(
  input: Omit<ArtifactAcquisitionCheckpoint, "state" | "downloadId">,
): Promise<void> {
  const key = artifactAcquisitionCheckpointKey(input);
  await browser.storage.session.set({
    [key]: { ...input, state: "intent" } satisfies ArtifactAcquisitionCheckpoint,
  });
}

export async function persistArtifactAcquisitionDownloadId(
  input: ArtifactAcquisitionCheckpoint,
): Promise<void> {
  const key = artifactAcquisitionCheckpointKey(input);
  await browser.storage.session.set({
    [key]: { ...input, state: "download-observing" } satisfies ArtifactAcquisitionCheckpoint,
  });
}

export async function clearArtifactAcquisitionCheckpoint(
  target: ArtifactAcquisitionTarget,
  requestId: string,
): Promise<void> {
  const key = artifactAcquisitionCheckpointKey(target);
  const stored = await browser.storage.session.get(key);
  if ((stored[key] as { requestId?: unknown } | undefined)?.requestId === requestId) {
    await browser.storage.session.remove(key);
  }
}

export async function reconcileArtifactAcquisitionCheckpoint(
  target: ArtifactAcquisitionTarget,
): Promise<{ state: "retry-safe" } | { state: "needs-review"; safeSignals: string[] }> {
  const key = artifactAcquisitionCheckpointKey(target);
  const stored = await browser.storage.session.get(key);
  const checkpoint = stored[key] as ArtifactAcquisitionCheckpoint | undefined;
  if (!checkpoint || typeof checkpoint.requestId !== "string") return { state: "retry-safe" };
  if (checkpoint.state !== "download-observing" || !Number.isSafeInteger(checkpoint.downloadId)) {
    await browser.storage.session.remove(key);
    return { state: "retry-safe" };
  }
  try {
    const [item] = await browser.downloads.search({ id: checkpoint.downloadId });
    if (item?.state === "in_progress" || !item?.state) {
      return { state: "needs-review", safeSignals: ["artifact-acquisition-download-unreconciled"] };
    }
    await browser.storage.session.remove(key);
    return { state: "retry-safe" };
  } catch {
    return {
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-search-unavailable"],
    };
  }
}
