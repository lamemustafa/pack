// The marker Codex writes on a clean top-level review, and the commit it names.
//
// One definition, two readers: the evaluator trusts this marker as a current-head review, and the
// scheduled publisher treats the commit it names as a head this pull request had. A second copy
// would drift from the first, and the two readers disagreeing about which commits were reviewed is
// exactly the discontinuity the review gate exists to detect.
export const CODEX_CLEAN_TOP_LEVEL_REVIEW_PATTERN =
  /^Codex Review: Didn't find any major issues\.[^\r\n]*(?:\r?\n)+[\s\S]*?\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,64})`/u;

// Returns the reviewed-commit prefix a clean top-level review names, or null. The marker carries a
// prefix rather than a full SHA, so callers that need to address a commit must resolve it.
export function readCleanTopLevelReviewCommit(body) {
  const match = (body ?? "").trimStart().match(CODEX_CLEAN_TOP_LEVEL_REVIEW_PATTERN);
  return match?.[1]?.toLowerCase() ?? null;
}
