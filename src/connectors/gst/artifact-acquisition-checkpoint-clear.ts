export const ARTIFACT_ACQUISITION_CHECKPOINT_CLEAR_FAILURE_REASONS = [
  "intent-discard-not-approved",
  "checkpoint-invalid",
  "download-missing",
  "download-state-missing",
  "download-target-mismatch",
  "download-danger-unknown",
  "download-danger-pending",
  "download-danger-rejected",
  "download-size-unknown",
  "download-empty",
  "download-cancel-unconfirmed",
  "download-state-unsupported",
  "storage-read-failed",
  "download-search-failed",
  "download-cancel-failed",
  "storage-remove-failed",
] as const;

export type ArtifactAcquisitionCheckpointClearFailureReason =
  (typeof ARTIFACT_ACQUISITION_CHECKPOINT_CLEAR_FAILURE_REASONS)[number];

export function artifactAcquisitionCheckpointClearFailureSignal(
  reason: ArtifactAcquisitionCheckpointClearFailureReason,
): string {
  return `artifact-acquisition-checkpoint-clear-failed:${reason}`;
}
