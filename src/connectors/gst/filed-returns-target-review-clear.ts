export const FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES = [
  "storage-key-missing",
  "expected-revision-invalid",
  "review-missing",
  "review-malformed",
  "scope-mismatch",
  "revision-mismatch",
  "storage-read-failed",
  "storage-write-failed",
  "storage-remove-failed",
] as const;

export type FiledReturnsTargetReviewClearFailureStage =
  (typeof FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES)[number];

export class FiledReturnsTargetReviewClearError extends Error {
  constructor(readonly stage: FiledReturnsTargetReviewClearFailureStage) {
    super("Filed-returns target review clear failed.");
    this.name = "FiledReturnsTargetReviewClearError";
  }
}

export type FiledReturnsTargetReviewClearResult =
  { ok: true } | { error: FiledReturnsTargetReviewClearError; ok: false };

export function filedReturnsTargetReviewClearFailureSignal(
  stage: FiledReturnsTargetReviewClearFailureStage,
): `filed-returns-target-review-clear-failed:${FiledReturnsTargetReviewClearFailureStage}` {
  return `filed-returns-target-review-clear-failed:${stage}`;
}
