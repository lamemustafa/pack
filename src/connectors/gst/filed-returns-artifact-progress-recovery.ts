export const FILED_RETURNS_ARTIFACT_PROGRESS_FAILURE_REASONS = [
  "malformed-summary",
  "storage-read-failed",
  "storage-write-failed",
] as const;

export type FiledReturnsArtifactProgressFailureReason =
  (typeof FILED_RETURNS_ARTIFACT_PROGRESS_FAILURE_REASONS)[number];

const SIGNAL_PREFIX = "filed-return-artifact-progress-";

export function filedReturnsArtifactProgressFailureSignal(
  reason: FiledReturnsArtifactProgressFailureReason,
): string {
  return `${SIGNAL_PREFIX}${reason}`;
}

export function filedReturnsArtifactProgressFailureReasonFromSignal(
  signal: string,
): FiledReturnsArtifactProgressFailureReason | null {
  if (!signal.startsWith(SIGNAL_PREFIX)) return null;
  const reason = signal.slice(SIGNAL_PREFIX.length);
  return FILED_RETURNS_ARTIFACT_PROGRESS_FAILURE_REASONS.includes(
    reason as FiledReturnsArtifactProgressFailureReason,
  )
    ? (reason as FiledReturnsArtifactProgressFailureReason)
    : null;
}
