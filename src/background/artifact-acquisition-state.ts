import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";

const KEY_PREFIX = "pack.artifact-acquisition.v2";

export type ArtifactAcquisitionTarget = Pick<
  FiledReturnsDownloadScope,
  "artifactType" | "financialYear" | "period" | "returnType"
>;

export type ArtifactAcquisitionCheckpoint = ArtifactAcquisitionTarget & {
  requestId: string;
  state: "intent" | "download-observing" | "download-unconfirmed";
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

export async function persistArtifactAcquisitionUnconfirmedDownload(
  input: ArtifactAcquisitionCheckpoint,
): Promise<void> {
  const key = artifactAcquisitionCheckpointKey(input);
  await browser.storage.session.set({
    [key]: { ...input, state: "download-unconfirmed" } satisfies ArtifactAcquisitionCheckpoint,
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

/** Clears completed exact-ID ownership only after the matching summary is durable. */
export async function clearArtifactAcquisitionCheckpointsAfterPersistedSummary(
  scope: FiledReturnsDownloadScope,
): Promise<void> {
  for (const artifactType of concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  )) {
    const target = { ...scope, artifactType };
    const key = artifactAcquisitionCheckpointKey(target);
    const stored = await browser.storage.session.get(key);
    const checkpoint = stored[key] as ArtifactAcquisitionCheckpoint | undefined;
    if (checkpoint?.state === "download-observing" && Number.isSafeInteger(checkpoint.downloadId)) {
      await browser.storage.session.remove(key);
    }
  }
}

export async function reconcileArtifactAcquisitionCheckpoint(
  target: ArtifactAcquisitionTarget,
): Promise<{ state: "retry-safe" } | { state: "needs-review"; safeSignals: string[] }> {
  const key = artifactAcquisitionCheckpointKey(target);
  const stored = await browser.storage.session.get(key);
  const checkpoint = stored[key] as ArtifactAcquisitionCheckpoint | undefined;
  if (!checkpoint || typeof checkpoint.requestId !== "string") return { state: "retry-safe" };
  if (checkpoint.state === "intent" || !Number.isSafeInteger(checkpoint.downloadId)) {
    return { state: "needs-review", safeSignals: ["artifact-acquisition-start-unreconciled"] };
  }
  if (checkpoint.state === "download-unconfirmed") {
    return {
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unconfirmed"],
    };
  }
  try {
    const [item] = await browser.downloads.search({ id: checkpoint.downloadId });
    if (item?.state === "in_progress" || !item?.state) {
      return { state: "needs-review", safeSignals: ["artifact-acquisition-download-unreconciled"] };
    }
    // A terminal `complete` item means the externally visible download already
    // happened; the worker simply stopped before persisting that success.
    // Clearing the checkpoint here would hand the next start a clean slate and
    // repeat a download that already succeeded, so route it to review instead.
    // Only a genuinely interrupted download is safe to retry.
    if (item.state === "complete") {
      return {
        state: "needs-review",
        safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
      };
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
