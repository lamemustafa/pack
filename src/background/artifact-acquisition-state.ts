import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";

const KEY_PREFIX = "pack.artifact-acquisition.v2";
const MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL = {
  schemaVersion: "1.0",
  state: "malformed",
} as const;

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

/** True when session recovery still owns a target-bound artifact action. */
export async function hasArtifactAcquisitionCheckpoint(): Promise<boolean> {
  const values = await browser.storage.session.get();
  return Object.keys(values).some((key) => key.startsWith(`${KEY_PREFIX}.`));
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

/**
 * Cancels exact in-progress downloads before clearing every checkpoint for an
 * explicitly cancelled target review. Completed, unknown, and intent-only
 * checkpoints remain fail-closed because they cannot be safely retried.
 */
export async function clearArtifactAcquisitionCheckpoints(
  scope: FiledReturnsDownloadScope,
): Promise<boolean> {
  const targets = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  ).map((artifactType) => ({ ...scope, artifactType }) as ArtifactAcquisitionTarget);
  const keys = targets.map((target) => artifactAcquisitionCheckpointKey(target));
  try {
    const stored = await browser.storage.session.get(keys);
    for (const target of targets) {
      const key = artifactAcquisitionCheckpointKey(target);
      const checkpoint = stored[key];
      // Chrome clears storage.session when the extension is disabled, reloaded
      // or updated and when the browser restarts, while the target review lives
      // in storage.local and survives all four. An absent checkpoint therefore
      // means there is nothing left to clear — that is the success condition,
      // not a failure. Treating it as a failure retained the review forever,
      // because every later attempt read the same absence, and an extension
      // update alone was enough to reach it.
      if (checkpoint === undefined) continue;
      if (
        !isArtifactAcquisitionCheckpoint(checkpoint) ||
        !checkpointOwnsTarget(checkpoint, target) ||
        typeof checkpoint.downloadId !== "number" ||
        !Number.isSafeInteger(checkpoint.downloadId)
      ) {
        return false;
      }
      const downloadId = checkpoint.downloadId;
      const [download] = await browser.downloads.search({ id: downloadId });
      if (download?.state === "complete" || !download?.state) return false;
      if (download.state === "in_progress") {
        await browser.downloads.cancel(downloadId);
        const [cancelledDownload] = await browser.downloads.search({ id: downloadId });
        if (cancelledDownload?.state !== "interrupted") return false;
      } else if (download.state !== "interrupted") {
        return false;
      }
    }
    await browser.storage.session.remove(keys);
    return true;
  } catch {
    return false;
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
  const storedCheckpoint = stored[key];
  if (storedCheckpoint === undefined || storedCheckpoint === null) return { state: "retry-safe" };
  if (isMalformedArtifactAcquisitionCheckpointSentinel(storedCheckpoint)) {
    return { state: "needs-review", safeSignals: ["artifact-acquisition-checkpoint-malformed"] };
  }
  if (!isArtifactAcquisitionCheckpoint(storedCheckpoint)) {
    // Keep a minimal sentinel instead of deleting untrusted recovery metadata:
    // it may be the only evidence that a target-bound browser action started.
    await browser.storage.session.set({
      [key]: MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL,
    });
    return { state: "needs-review", safeSignals: ["artifact-acquisition-checkpoint-malformed"] };
  }
  const checkpoint = storedCheckpoint;
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
    return {
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-interrupted"],
    };
  } catch {
    return {
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-search-unavailable"],
    };
  }
}

/**
 * A stored record is only permission to cancel a browser download if it is the
 * checkpoint for exactly this target. Chrome does not document whether a
 * DownloadItem id is ever reused, so nothing may rely on a stale id being
 * harmless; the id is trusted only when the record it came from still describes
 * the target whose key it sits under, and carries a live acquisition state.
 */
function checkpointOwnsTarget(
  checkpoint: ArtifactAcquisitionCheckpoint,
  target: ArtifactAcquisitionTarget,
): boolean {
  return (
    (checkpoint.state === "download-observing" || checkpoint.state === "download-unconfirmed") &&
    checkpoint.returnType === target.returnType &&
    checkpoint.financialYear === target.financialYear &&
    checkpoint.period === target.period &&
    (checkpoint.artifactType ?? "PDF") === (target.artifactType ?? "PDF")
  );
}

function isArtifactAcquisitionCheckpoint(input: unknown): input is ArtifactAcquisitionCheckpoint {
  if (!input || typeof input !== "object") return false;
  const checkpoint = input as Partial<ArtifactAcquisitionCheckpoint>;
  return typeof checkpoint.requestId === "string" && checkpoint.requestId.length > 0;
}

function isMalformedArtifactAcquisitionCheckpointSentinel(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    Object.keys(value).length === 2 &&
    value.schemaVersion === MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL.schemaVersion &&
    value.state === MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL.state
  );
}
