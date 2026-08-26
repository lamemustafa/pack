import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";
import type { ArtifactAcquisitionCheckpointClearFailureReason } from "../connectors/gst/artifact-acquisition-checkpoint-clear";
import {
  concreteFiledReturnsArtifactTypesForSelection,
  filedReturnsArtifactExtension,
  filedReturnsArtifactMimeTypes,
  isFiledReturnsConcreteArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import { isCanonicalFiledReturnsActionId } from "../connectors/gst/filed-returns-operation-id";
import { parseDurableFiledReturnsScope } from "../connectors/gst/filed-returns-durable-status";
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
/** Session-only mapping that binds a malformed checkpoint to an opaque review reference. */
export const PACK_MALFORMED_ARTIFACT_ACQUISITION_REVIEW_REFERENCE_KEY_PREFIX =
  "pack.artifact-acquisition-review.v1";

const KEY_PREFIX = PACK_ARTIFACT_ACQUISITION_KEY_PREFIX;
const MALFORMED_REVIEW_REFERENCE_KEY_PREFIX =
  PACK_MALFORMED_ARTIFACT_ACQUISITION_REVIEW_REFERENCE_KEY_PREFIX;
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

export type RetainedArtifactAcquisitionCheckpoint =
  { key: string; state: "malformed" } | { state: "target"; target: ArtifactAcquisitionTarget };

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
 * Lists structurally valid retained targets without inspecting or changing their
 * browser downloads. The flow runner uses this to surface the original target
 * before it accepts a different one.
 */
export async function readArtifactAcquisitionCheckpoints(): Promise<
  RetainedArtifactAcquisitionCheckpoint[]
> {
  const values = await browser.storage.session.get();
  const retained: RetainedArtifactAcquisitionCheckpoint[] = [];
  for (const [key] of Object.entries(values)) {
    if (!key.startsWith(`${KEY_PREFIX}.`)) continue;
    const target = checkpointTargetFromKey(key);
    if (!target) {
      retained.push({ key, state: "malformed" });
      continue;
    }
    // Keep a canonical-key target recoverable even when the value is malformed
    // or describes another target: inspection will convert that exact record to
    // a sentinel and keep the resulting target review fail-closed.
    retained.push({ state: "target", target });
  }
  return retained;
}

/**
 * Keeps an unparseable checkpoint key in session storage while a durable review
 * holds only an opaque reference to it.
 */
export async function createMalformedArtifactAcquisitionCheckpointReference(
  key: string,
): Promise<string | null> {
  if (!isArtifactAcquisitionCheckpointStorageKey(key)) return null;
  const keyDigest = await malformedCheckpointKeyDigest(key);
  if (!keyDigest) return null;
  const reference = createMalformedCheckpointReference();
  try {
    await browser.storage.session.set({
      [malformedCheckpointReferenceStorageKey(reference)]: { keyDigest },
    });
    return reference;
  } catch {
    return null;
  }
}

/** Removes the one malformed checkpoint bound to an explicit review. */
export async function clearMalformedArtifactAcquisitionCheckpoint(
  reference: string,
): Promise<boolean> {
  try {
    const referenceKey = malformedCheckpointReferenceStorageKey(reference);
    const values = await browser.storage.session.get(referenceKey);
    const keyDigest = malformedCheckpointKeyDigestFromReference(values[referenceKey]);
    // storage.session is cleared with the checkpoint itself. The durable review
    // can therefore be safely cancelled when its session-only binding is gone.
    if (!keyDigest) {
      await browser.storage.session.remove(referenceKey);
      return true;
    }
    const allValues = await browser.storage.session.get();
    const checkpointKeys = Object.keys(allValues).filter(isArtifactAcquisitionCheckpointStorageKey);
    const candidates = await Promise.all(
      checkpointKeys.map(async (key) => ({
        key,
        keyDigest: await malformedCheckpointKeyDigest(key),
      })),
    );
    if (candidates.some((candidate) => !candidate.keyDigest)) return false;
    const matchingKeys = candidates
      .filter((candidate) => candidate.keyDigest === keyDigest)
      .map((candidate) => candidate.key);
    if (matchingKeys.length === 0) {
      await browser.storage.session.remove(referenceKey);
      return true;
    }
    if (matchingKeys.length !== 1) return false;
    const [checkpointKey] = matchingKeys;
    if (!checkpointKey) return false;
    const value = allValues[checkpointKey];
    const target = checkpointTargetFromKey(checkpointKey);
    if (
      target &&
      isArtifactAcquisitionCheckpoint(value) &&
      checkpointMatchesTarget(value, target)
    ) {
      return false;
    }
    await browser.storage.session.remove([checkpointKey, referenceKey]);
    return true;
  } catch {
    return false;
  }
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
  | { state: "blocked"; reason: ArtifactAcquisitionCheckpointClearFailureReason };

export async function clearArtifactAcquisitionCheckpoints(
  scope: FiledReturnsDownloadScope,
  options: { discardCompleted?: boolean; discardIntent?: boolean; discardMissing?: boolean } = {},
): Promise<ArtifactCheckpointCancellation> {
  const targets = concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
  ).map(
    (artifactType) =>
      ({ ...scope, artifactType }) as ArtifactAcquisitionTarget & {
        artifactType: FiledReturnsConcreteArtifactType;
      },
  );
  const keys = targets.map((target) => artifactAcquisitionCheckpointKey(target));
  const completedEvidence: ArtifactAcquisitionCompletionEvidence[] = [];
  let operationFailureReason: ArtifactAcquisitionCheckpointClearFailureReason =
    "storage-read-failed";
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
      if (isArtifactAcquisitionIntent(checkpoint, target)) {
        if (!options.discardIntent) return blockedCancellation("intent-discard-not-approved");
        continue;
      }
      if (
        !isArtifactAcquisitionCheckpoint(checkpoint) ||
        !checkpointOwnsTarget(checkpoint, target) ||
        !isCanonicalFiledReturnsActionId(checkpoint.requestId) ||
        !armedAtFromCheckpoint(checkpoint) ||
        typeof checkpoint.downloadId !== "number" ||
        !Number.isSafeInteger(checkpoint.downloadId) ||
        checkpoint.downloadId < 0
      ) {
        return blockedCancellation("checkpoint-invalid");
      }
      const downloadId = checkpoint.downloadId;
      operationFailureReason = "download-search-failed";
      const [download] = await browser.downloads.search({ id: downloadId });
      if (!download) {
        if (!options.discardMissing) return blockedCancellation("download-missing");
        continue;
      }
      if (!download.state) return blockedCancellation("download-state-missing");
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
          return blockedCancellation("download-target-mismatch");
        }
        // Keep this decision coupled to the shared download observer. Unknown
        // danger and size are not evidence in either direction.
        const danger = classifyDownloadDanger(download);
        if (danger !== "safe") return blockedCancellation(`download-danger-${danger}`);
        const size = firstKnownSize(download);
        if (size === null) return blockedCancellation("download-size-unknown");
        if (size === 0) return blockedCancellation("download-empty");
        completedEvidence.push({
          artifactType: target.artifactType,
          downloadId,
          requestId: checkpoint.requestId,
        });
        continue;
      }
      if (download.state === "in_progress") {
        operationFailureReason = "download-cancel-failed";
        await browser.downloads.cancel(downloadId);
        operationFailureReason = "download-search-failed";
        const [cancelledDownload] = await browser.downloads.search({ id: downloadId });
        if (cancelledDownload?.state !== "interrupted") {
          return blockedCancellation("download-cancel-unconfirmed");
        }
      } else if (download.state !== "interrupted") {
        return blockedCancellation("download-state-unsupported");
      }
    }
    if (
      completedEvidence.length === targets.length &&
      new Set(completedEvidence.map(({ downloadId }) => downloadId)).size === targets.length
    ) {
      if (options.discardCompleted) {
        operationFailureReason = "storage-remove-failed";
        await browser.storage.session.remove(keys);
        return { state: "cleared" };
      }
      return { state: "completed", evidence: completedEvidence };
    }
    operationFailureReason = "storage-remove-failed";
    await browser.storage.session.remove(keys);
    return { state: "cleared" };
  } catch {
    return blockedCancellation(operationFailureReason);
  }
}

function blockedCancellation(
  reason: ArtifactAcquisitionCheckpointClearFailureReason,
): ArtifactCheckpointCancellation {
  return { reason, state: "blocked" };
}

function checkpointTargetFromKey(key: string): ArtifactAcquisitionTarget | null {
  const encodedParts = key.slice(`${KEY_PREFIX}.`.length).split(".");
  if (encodedParts.length !== 4) return null;
  try {
    const [returnType, financialYear, period, artifactType] = encodedParts.map(decodeURIComponent);
    const target = checkpointTarget({ artifactType, financialYear, period, returnType });
    return target && artifactAcquisitionCheckpointKey(target) === key ? target : null;
  } catch {
    return null;
  }
}

function checkpointTarget(input: {
  artifactType?: unknown;
  financialYear?: unknown;
  period?: unknown;
  returnType?: unknown;
}): ArtifactAcquisitionTarget | null {
  const scope = parseDurableFiledReturnsScope(input, false);
  if (!scope || !isFiledReturnsConcreteArtifactType(scope.artifactType)) {
    return null;
  }
  return {
    artifactType: scope.artifactType,
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
  };
}

function isArtifactAcquisitionCheckpointStorageKey(key: unknown): key is string {
  return typeof key === "string" && key.startsWith(`${KEY_PREFIX}.`);
}

function malformedCheckpointReferenceStorageKey(reference: string): string {
  return `${MALFORMED_REVIEW_REFERENCE_KEY_PREFIX}.${reference}`;
}

function createMalformedCheckpointReference(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `malformed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function malformedCheckpointKeyDigestFromReference(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const keyDigest = (value as { keyDigest?: unknown }).keyDigest;
  return typeof keyDigest === "string" && /^[a-f0-9]{64}$/.test(keyDigest) ? keyDigest : null;
}

async function malformedCheckpointKeyDigest(key: string): Promise<string | null> {
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function isArtifactAcquisitionIntent(
  checkpoint: unknown,
  target: ArtifactAcquisitionTarget,
): checkpoint is ArtifactAcquisitionCheckpoint {
  return (
    isArtifactAcquisitionCheckpoint(checkpoint) &&
    checkpoint.state === "intent" &&
    checkpointMatchesTarget(checkpoint, target) &&
    isCanonicalFiledReturnsActionId(checkpoint.requestId) &&
    Boolean(armedAtFromCheckpoint(checkpoint))
  );
}

/** Clears completed exact-ID ownership only after the matching summary is durable. */
export async function clearArtifactAcquisitionCheckpointsAfterPersistedSummary(
  scope: FiledReturnsDownloadScope,
  evidence: readonly ArtifactAcquisitionCompletionEvidence[],
): Promise<void> {
  for (const artifactType of concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
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
  for (const artifactType of concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
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
  // A foreground start must never repeat a download whose exact-ID evidence
  // has not yet been resolved by its target-scoped recovery path.
  return {
    state: "needs-review",
    safeSignals: ["artifact-acquisition-download-completed-unpersisted"],
  };
}

/**
 * Inspects one exact-ID checkpoint for the foreground guard, which owns every
 * unproven checkpoint recovery and preserves malformed records for review.
 */
export async function inspectArtifactAcquisitionCheckpoint(
  target: ArtifactAcquisitionTarget,
  options: { preserveMalformed?: boolean } = {},
): Promise<ArtifactAcquisitionCheckpointInspection> {
  const key = artifactAcquisitionCheckpointKey(target);
  const stored = await browser.storage.session.get(key);
  const storedCheckpoint = stored[key];
  if (storedCheckpoint === undefined) return { state: "retry-safe" };
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
