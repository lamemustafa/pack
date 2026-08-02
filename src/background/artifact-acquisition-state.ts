import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypes,
  filedReturnsArtifactExtension,
  filedReturnsArtifactMimeTypes,
  isFiledReturnsConcreteArtifactType,
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import { parseDurableFiledReturnsScope } from "../connectors/gst/filed-returns-durable-status";
import { isCanonicalFiledReturnsActionId } from "../connectors/gst/filed-returns-operation-id";
import { isExpectedDownloadCandidate } from "./download-correlation";
import {
  classifyDownloadDanger,
  completedObservation,
  firstKnownSize,
} from "./download-observer-results";

/**
 * Canonical prefix for the per-target session checkpoint family. Exported so the
 * storage-disclosure test can assert the README documents it: this family is
 * generated rather than listed in PACK_SESSION_STORAGE_KEYS, so an inventory
 * test driven only by those objects cannot see it.
 */
export const PACK_ARTIFACT_ACQUISITION_KEY_PREFIX = "pack.artifact-acquisition.v2";

const KEY_PREFIX = PACK_ARTIFACT_ACQUISITION_KEY_PREFIX;
const MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL = {
  schemaVersion: "1.0",
  state: "malformed",
} as const;

export type ArtifactAcquisitionTarget = Pick<
  FiledReturnsDownloadScope,
  "artifactType" | "financialYear" | "period" | "returnType"
>;

export type ArtifactAcquisitionCheckpoint = ArtifactAcquisitionTarget & {
  armedAt: string;
  requestId: string;
  state: "intent" | "download-observing" | "download-unconfirmed";
  downloadId?: number;
};

export type ArtifactAcquisitionCompletionEvidence = {
  artifactType: FiledReturnsConcreteArtifactType;
  downloadId: number;
  requestId: string;
};

export type ArtifactAcquisitionCheckpointInspection =
  | { state: "retry-safe" }
  | { evidence: ArtifactAcquisitionCompletionEvidence; state: "completed" }
  | { state: "needs-review"; safeSignals: string[] };

export type ArtifactAcquisitionCheckpointTarget = {
  key: string;
  target: ArtifactAcquisitionTarget;
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

/**
 * Lists every checkpoint target still owned by this browser session. Startup
 * recovery uses the key as its target boundary, then inspects the record before
 * it can act on the browser download ID inside it.
 */
export async function readArtifactAcquisitionCheckpointTargets(): Promise<
  ArtifactAcquisitionCheckpointTarget[]
> {
  const values = await browser.storage.session.get();
  const targets = new Map<string, ArtifactAcquisitionCheckpointTarget>();
  for (const key of Object.keys(values)) {
    const target = artifactAcquisitionTargetFromKey(key);
    if (target && key === artifactAcquisitionCheckpointKey(target)) {
      targets.set(key, { key, target });
    }
  }
  return [...targets.values()];
}

export async function persistArtifactAcquisitionIntent(
  input: Omit<ArtifactAcquisitionCheckpoint, "armedAt" | "state" | "downloadId">,
): Promise<void> {
  const key = artifactAcquisitionCheckpointKey(input);
  await browser.storage.session.set({
    [key]: {
      ...input,
      armedAt: new Date().toISOString(),
      state: "intent",
    } satisfies ArtifactAcquisitionCheckpoint,
  });
}

export async function persistArtifactAcquisitionDownloadId(
  input: Omit<ArtifactAcquisitionCheckpoint, "armedAt">,
): Promise<void> {
  const key = artifactAcquisitionCheckpointKey(input);
  const stored = await browser.storage.session.get(key);
  await browser.storage.session.set({
    [key]: {
      ...input,
      armedAt: armedAtFromCheckpoint(stored[key]) ?? new Date().toISOString(),
      state: "download-observing",
    } satisfies ArtifactAcquisitionCheckpoint,
  });
}

export async function persistArtifactAcquisitionUnconfirmedDownload(
  input: Omit<ArtifactAcquisitionCheckpoint, "armedAt">,
): Promise<void> {
  const key = artifactAcquisitionCheckpointKey(input);
  const stored = await browser.storage.session.get(key);
  await browser.storage.session.set({
    [key]: {
      ...input,
      armedAt: armedAtFromCheckpoint(stored[key]) ?? new Date().toISOString(),
      state: "download-unconfirmed",
    } satisfies ArtifactAcquisitionCheckpoint,
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
 * Resolves every checkpoint for an explicitly cancelled target review.
 *
 * A completed result is reserved for a scope whose every expected concrete
 * artifact has a distinct, exact-ID browser download that is complete,
 * non-empty, and safe according to the shared observer. Checkpoints that prove
 * completion deliberately remain until the completed summary is durable.
 */
export type ArtifactCheckpointCancellation =
  | { state: "cleared" }
  | { state: "completed"; evidence: ArtifactAcquisitionCompletionEvidence[] }
  | { state: "blocked" };

export async function clearArtifactAcquisitionCheckpoints(
  scope: FiledReturnsDownloadScope,
): Promise<ArtifactCheckpointCancellation> {
  const targets = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  ).map(
    (artifactType) =>
      ({ ...scope, artifactType }) as ArtifactAcquisitionTarget & {
        artifactType: FiledReturnsConcreteArtifactType;
      },
  );
  const keys = targets.map((target) => artifactAcquisitionCheckpointKey(target));
  const completedEvidence: ArtifactAcquisitionCompletionEvidence[] = [];
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
      // The sentinel deliberately carries no recoverable browser identity.
      // It is safe to discard on explicit cancellation without searching or
      // cancelling an ID that may have appeared in the malformed input it
      // replaced.
      if (isMalformedArtifactAcquisitionCheckpointSentinel(checkpoint)) continue;
      if (
        !isArtifactAcquisitionCheckpoint(checkpoint) ||
        !checkpointOwnsTarget(checkpoint, target) ||
        !isCanonicalFiledReturnsActionId(checkpoint.requestId) ||
        !armedAtFromCheckpoint(checkpoint) ||
        typeof checkpoint.downloadId !== "number" ||
        !Number.isSafeInteger(checkpoint.downloadId) ||
        checkpoint.downloadId < 0
      ) {
        return { state: "blocked" };
      }
      const downloadId = checkpoint.downloadId;
      const [download] = await browser.downloads.search({ id: downloadId });
      if (!download?.state) return { state: "blocked" };
      if (download.state === "complete") {
        const armedAt = armedAtFromCheckpoint(checkpoint);
        if (
          !armedAt ||
          !isExpectedDownloadCandidate(download, {
            armedAt: new Date(armedAt),
            expectedFileExtensions: [filedReturnsArtifactExtension(target.artifactType)],
            expectedMimeTypes: filedReturnsArtifactMimeTypes(target.artifactType),
            trustedDownloadIds: new Set([downloadId]),
          })
        ) {
          return { state: "blocked" };
        }
        // Keep this decision coupled to the shared download observer. Unknown
        // danger and size are not evidence in either direction.
        if (classifyDownloadDanger(download) !== "safe") return { state: "blocked" };
        const size = firstKnownSize(download);
        if (size === null || size === 0) return { state: "blocked" };
        completedEvidence.push({
          artifactType: target.artifactType,
          downloadId,
          requestId: checkpoint.requestId,
        });
        continue;
      }
      if (download.state === "in_progress") {
        await browser.downloads.cancel(downloadId);
        const [cancelledDownload] = await browser.downloads.search({ id: downloadId });
        if (cancelledDownload?.state !== "interrupted") return { state: "blocked" };
      } else if (download.state !== "interrupted") {
        return { state: "blocked" };
      }
    }
    if (
      completedEvidence.length === targets.length &&
      new Set(completedEvidence.map(({ downloadId }) => downloadId)).size === targets.length
    ) {
      return { state: "completed", evidence: completedEvidence };
    }
    await browser.storage.session.remove(keys);
    return { state: "cleared" };
  } catch {
    return { state: "blocked" };
  }
}

/** Clears completed exact-ID ownership only after the matching summary is durable. */
export async function clearArtifactAcquisitionCheckpointsAfterPersistedSummary(
  scope: FiledReturnsDownloadScope,
  evidence: readonly ArtifactAcquisitionCompletionEvidence[],
): Promise<void> {
  for (const artifactType of concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  )) {
    const target = { ...scope, artifactType };
    const key = artifactAcquisitionCheckpointKey(target);
    const stored = await browser.storage.session.get(key);
    const checkpoint = stored[key];
    const matchingEvidence = evidence.find((entry) => entry.artifactType === artifactType);
    if (
      matchingEvidence &&
      isArtifactAcquisitionCheckpoint(checkpoint) &&
      (checkpoint.state === "download-observing" || checkpoint.state === "download-unconfirmed") &&
      checkpoint.requestId === matchingEvidence.requestId &&
      checkpoint.downloadId === matchingEvidence.downloadId
    ) {
      await browser.storage.session.remove(key);
    }
  }
}

/** Snapshots exact checkpoint ownership before a normal completion is persisted. */
export async function readArtifactAcquisitionCompletionEvidence(
  scope: FiledReturnsDownloadScope,
): Promise<ArtifactAcquisitionCompletionEvidence[]> {
  const evidence: ArtifactAcquisitionCompletionEvidence[] = [];
  for (const artifactType of concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  )) {
    const target = { ...scope, artifactType } as ArtifactAcquisitionTarget;
    const key = artifactAcquisitionCheckpointKey(target);
    const stored = await browser.storage.session.get(key);
    const checkpoint = stored[key];
    if (
      isArtifactAcquisitionCheckpoint(checkpoint) &&
      checkpointOwnsTarget(checkpoint, target) &&
      checkpoint.state === "download-observing" &&
      typeof checkpoint.downloadId === "number" &&
      Number.isSafeInteger(checkpoint.downloadId) &&
      checkpoint.downloadId >= 0
    ) {
      evidence.push({
        artifactType,
        downloadId: checkpoint.downloadId,
        requestId: checkpoint.requestId,
      });
    }
  }
  return evidence;
}

export async function reconcileArtifactAcquisitionCheckpoint(
  target: ArtifactAcquisitionTarget,
): Promise<{ state: "retry-safe" } | { state: "needs-review"; safeSignals: string[] }> {
  const inspection = await inspectArtifactAcquisitionCheckpoint(target);
  if (inspection.state !== "completed") return inspection;
  // A foreground start must never repeat a download that startup recovery has
  // not yet persisted. The durable reconciler is the sole owner of turning
  // completed evidence into a completion summary.
  return {
    state: "needs-review",
    safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
  };
}

/**
 * Inspects one exact-ID checkpoint for the foreground guard and startup
 * scanner. The scanner opts out of malformed-record preservation because only
 * the foreground guard owns unproven checkpoint recovery.
 */
export async function inspectArtifactAcquisitionCheckpoint(
  target: ArtifactAcquisitionTarget,
  options: { preserveMalformed?: boolean } = {},
): Promise<ArtifactAcquisitionCheckpointInspection> {
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
    if (options.preserveMalformed !== false) {
      await browser.storage.session.set({
        [key]: MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL,
      });
    }
    return { state: "needs-review", safeSignals: ["artifact-acquisition-checkpoint-malformed"] };
  }
  const checkpoint = storedCheckpoint;
  if (!checkpointMatchesTarget(checkpoint, target)) {
    if (options.preserveMalformed !== false) {
      await browser.storage.session.set({
        [key]: MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL,
      });
    }
    return { state: "needs-review", safeSignals: ["artifact-acquisition-checkpoint-malformed"] };
  }
  const artifactType = target.artifactType ?? "PDF";
  const downloadId = checkpoint.downloadId;
  if (
    !isCanonicalFiledReturnsActionId(checkpoint.requestId) ||
    !armedAtFromCheckpoint(checkpoint)
  ) {
    if (options.preserveMalformed !== false) {
      await browser.storage.session.set({
        [key]: MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL,
      });
    }
    return { state: "needs-review", safeSignals: ["artifact-acquisition-checkpoint-malformed"] };
  }
  if (checkpoint.state === "intent") {
    return { state: "needs-review", safeSignals: ["artifact-acquisition-start-unreconciled"] };
  }
  if (checkpoint.state === "download-unconfirmed") {
    return {
      state: "needs-review",
      safeSignals: ["artifact-acquisition-download-unconfirmed"],
    };
  }
  if (
    !isFiledReturnsConcreteArtifactType(artifactType) ||
    typeof downloadId !== "number" ||
    !Number.isSafeInteger(downloadId) ||
    downloadId < 0 ||
    !armedAtFromCheckpoint(checkpoint)
  ) {
    if (options.preserveMalformed !== false) {
      await browser.storage.session.set({
        [key]: MALFORMED_ARTIFACT_ACQUISITION_CHECKPOINT_SENTINEL,
      });
    }
    return { state: "needs-review", safeSignals: ["artifact-acquisition-checkpoint-malformed"] };
  }
  try {
    const [item] = await browser.downloads.search({ id: downloadId });
    if (item?.state === "in_progress" || !item?.state) {
      return { state: "needs-review", safeSignals: ["artifact-acquisition-download-unreconciled"] };
    }
    if (item.state === "complete") {
      const observation = await completedObservation(
        browser.downloads,
        downloadId,
        {
          armedAt: new Date(armedAtFromCheckpoint(checkpoint)!),
          expectedFileExtensions: [filedReturnsArtifactExtension(artifactType)],
          expectedMimeTypes: filedReturnsArtifactMimeTypes(artifactType),
          trustedDownloadIds: new Set([downloadId]),
        },
        item,
      );
      if (
        observation.state !== "completed" ||
        observation.safeEvidence?.downloadId !== downloadId
      ) {
        return {
          state: "needs-review",
          safeSignals: observation.safeSignals,
        };
      }
      return {
        state: "completed",
        evidence: {
          artifactType,
          downloadId,
          requestId: checkpoint.requestId,
        },
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

function artifactAcquisitionTargetFromKey(key: string): ArtifactAcquisitionTarget | null {
  if (!key.startsWith(`${KEY_PREFIX}.`)) return null;
  const encodedParts = key.slice(`${KEY_PREFIX}.`.length).split(".");
  if (encodedParts.length !== 4) return null;
  try {
    const [returnType, financialYear, period, artifactType] = encodedParts.map(decodeURIComponent);
    const scope = parseDurableFiledReturnsScope(
      { artifactType, financialYear, period, returnType },
      false,
    );
    return scope && isFiledReturnsConcreteArtifactType(scope.artifactType)
      ? {
          artifactType: scope.artifactType,
          financialYear: scope.financialYear,
          period: scope.period,
          returnType: scope.returnType,
        }
      : null;
  } catch {
    return null;
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
    checkpointMatchesTarget(checkpoint, target)
  );
}

function checkpointMatchesTarget(
  checkpoint: ArtifactAcquisitionCheckpoint,
  target: ArtifactAcquisitionTarget,
): boolean {
  return (
    checkpoint.returnType === target.returnType &&
    checkpoint.financialYear === target.financialYear &&
    checkpoint.period === target.period &&
    (checkpoint.artifactType ?? "PDF") === (target.artifactType ?? "PDF")
  );
}

function isArtifactAcquisitionCheckpoint(input: unknown): input is ArtifactAcquisitionCheckpoint {
  if (!input || typeof input !== "object") return false;
  const checkpoint = input as Partial<ArtifactAcquisitionCheckpoint>;
  if (typeof checkpoint.armedAt !== "string" || typeof checkpoint.requestId !== "string") {
    return false;
  }
  if (!["intent", "download-observing", "download-unconfirmed"].includes(checkpoint.state ?? "")) {
    return false;
  }
  if (checkpoint.state === "intent") return checkpoint.downloadId === undefined;
  return typeof checkpoint.downloadId === "number";
}

function armedAtFromCheckpoint(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const armedAt = (input as { armedAt?: unknown }).armedAt;
  return typeof armedAt === "string" && Number.isFinite(Date.parse(armedAt)) ? armedAt : null;
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
