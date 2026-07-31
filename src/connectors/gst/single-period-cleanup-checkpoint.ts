export const SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES = [
  "bundle-missing",
  "bundle-mismatch",
  "completion-evidence-missing",
  "completion-persist-failed",
  "completion-mismatch",
  "canonical-completion-persist-failed",
  "bundle-clear-failed",
  "target-review-clear-failed",
  "callback-missing",
  "callback-failed",
] as const;

export type SinglePeriodCleanupCheckpointFailureStage =
  (typeof SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES)[number];

export class SinglePeriodCleanupCheckpointError extends Error {
  constructor(readonly stage: SinglePeriodCleanupCheckpointFailureStage) {
    super("Single-period cleanup checkpoint failed.");
    this.name = "SinglePeriodCleanupCheckpointError";
  }
}

export function singlePeriodCleanupCheckpointFailureSignal(
  stage: SinglePeriodCleanupCheckpointFailureStage,
): `single-period-cleanup-checkpoint-failed:${SinglePeriodCleanupCheckpointFailureStage}` {
  return `single-period-cleanup-checkpoint-failed:${stage}`;
}
