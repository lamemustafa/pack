import type { FiledReturnsTargetDownloadAttempt } from "../connectors/gst/filed-returns-contracts";
import { isFiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import { isCanonicalSinglePeriodLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import { isCanonicalFiledReturnsActionId } from "../connectors/gst/filed-returns-operation-id";
import { MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS } from "../connectors/gst/filed-returns-target-bound-download-candidate";

const COMMON_KEYS = ["artifactType", "kind", "phase", "requestedAt"] as const;

export function isFiledReturnsTargetDownloadAttempt(
  input: unknown,
): input is FiledReturnsTargetDownloadAttempt {
  if (!input || typeof input !== "object") return false;
  const attempt = input as Partial<FiledReturnsTargetDownloadAttempt> & Record<string, unknown>;
  if (!isCanonicalTimestamp(attempt.requestedAt)) return false;
  if (
    attempt.phase !== "download-intent-persisted" &&
    attempt.phase !== "target-bound-candidate-observing" &&
    attempt.phase !== "download-observing"
  ) {
    return false;
  }

  if (attempt.kind === "single-artifact") {
    const allowedKeys = [
      ...COMMON_KEYS,
      "actionId",
      ...(attempt.directDownload === true ? ["directDownload"] : []),
      ...(hasDownloadId(attempt) ? ["downloadId"] : []),
      ...(isTargetBoundCandidateObserving(attempt) ? ["candidateWindowEndsAt"] : []),
    ];
    return (
      hasOnlyKeys(attempt, allowedKeys) &&
      isFiledReturnsConcreteArtifactType(attempt.artifactType) &&
      isCanonicalFiledReturnsActionId(attempt.actionId) &&
      (attempt.directDownload === undefined || attempt.directDownload === true) &&
      hasValidDownloadIdForPhase(attempt) &&
      hasValidCandidateWindow(attempt)
    );
  }

  if (attempt.kind === "single-period-zip") {
    const allowedKeys = [
      ...COMMON_KEYS,
      "stagingLedgerId",
      ...(attempt.extensionBlobUrlFingerprint === undefined ? [] : ["extensionBlobUrlFingerprint"]),
      ...(isObserving(attempt) ? ["downloadId"] : []),
    ];
    return (
      hasOnlyKeys(attempt, allowedKeys) &&
      attempt.artifactType === "ZIP" &&
      isCanonicalSinglePeriodLedgerId(attempt.stagingLedgerId) &&
      hasValidExtensionBlobUrlFingerprint(attempt.extensionBlobUrlFingerprint) &&
      hasValidDownloadIdForPhase(attempt)
    );
  }

  return false;
}

export function toManualReviewDownloadAttempt(
  attempt: FiledReturnsTargetDownloadAttempt,
): FiledReturnsTargetDownloadAttempt {
  if (
    attempt.phase !== "download-observing" &&
    attempt.phase !== "target-bound-candidate-observing"
  ) {
    return attempt;
  }
  if (attempt.kind === "single-artifact") {
    return {
      actionId: attempt.actionId,
      artifactType: attempt.artifactType,
      ...(attempt.directDownload ? { directDownload: true as const } : {}),
      kind: attempt.kind,
      phase: "download-intent-persisted",
      requestedAt: attempt.requestedAt,
    };
  }
  return {
    artifactType: "ZIP",
    ...(attempt.extensionBlobUrlFingerprint
      ? { extensionBlobUrlFingerprint: attempt.extensionBlobUrlFingerprint }
      : {}),
    kind: attempt.kind,
    phase: "download-intent-persisted",
    requestedAt: attempt.requestedAt,
    stagingLedgerId: attempt.stagingLedgerId,
  };
}

function hasValidExtensionBlobUrlFingerprint(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}

function isObserving(
  attempt: Partial<FiledReturnsTargetDownloadAttempt>,
): attempt is Partial<FiledReturnsTargetDownloadAttempt> & {
  phase: "download-observing";
} {
  return attempt.phase === "download-observing";
}

function isTargetBoundCandidateObserving(
  attempt: Partial<FiledReturnsTargetDownloadAttempt>,
): attempt is Partial<FiledReturnsTargetDownloadAttempt> & {
  phase: "target-bound-candidate-observing";
} {
  return attempt.phase === "target-bound-candidate-observing";
}

function hasDownloadId(attempt: Partial<FiledReturnsTargetDownloadAttempt>): boolean {
  return isObserving(attempt) || isTargetBoundCandidateObserving(attempt);
}

function hasValidDownloadIdForPhase(
  attempt: Partial<FiledReturnsTargetDownloadAttempt> & Record<string, unknown>,
): boolean {
  if (attempt.phase === "download-intent-persisted") return attempt.downloadId === undefined;
  return (
    typeof attempt.downloadId === "number" &&
    Number.isSafeInteger(attempt.downloadId) &&
    attempt.downloadId >= 0
  );
}

function hasValidCandidateWindow(
  attempt: Partial<FiledReturnsTargetDownloadAttempt> & Record<string, unknown>,
): boolean {
  if (attempt.phase !== "target-bound-candidate-observing") {
    return attempt.candidateWindowEndsAt === undefined;
  }
  if (!isCanonicalTimestamp(attempt.candidateWindowEndsAt)) return false;
  const requestedAt = Date.parse(String(attempt.requestedAt));
  const windowEndsAt = Date.parse(attempt.candidateWindowEndsAt);
  return (
    windowEndsAt > requestedAt &&
    windowEndsAt - requestedAt <= MAX_TARGET_BOUND_PORTAL_DOWNLOAD_WINDOW_MS
  );
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function isCanonicalTimestamp(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 40) return false;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === input;
}
