// The record a generated-branch rewrite leaves behind so review continuity survives it.
//
// GitHub omits `before_commit_id` on the force-pushes Release Please performs, so the head a
// regeneration discards is named nowhere in the pull request's record: an ordinary push that was
// later rewritten away leaves no timeline entry, and a head that was never reviewed is named by no
// review either. The review gate therefore cannot prove that a finding recorded only on that head
// was carried forward, and refuses.
//
// The workflow that performs the rewrite is ours, so it can record what GitHub does not. This is
// the marker it writes, and the reader both sides share.
//
// It supplies evidence; it does not waive anything. A marker names a commit, and the gate still
// searches that commit for state belonging to that pull request. A marker naming a head with no
// state leaves the gate exactly as unconvinced as it was before.
const MARKER_PATTERN =
  /<!--\s*review-gate-rewrite\s+before=([0-9a-f]{40})\s+after=([0-9a-f]{40})\s*-->/iu;

export function formatReleaseBranchRewriteMarker(before, after) {
  if (!/^[0-9a-f]{40}$/iu.test(before ?? "") || !/^[0-9a-f]{40}$/iu.test(after ?? "")) {
    throw new Error("A release branch rewrite marker needs two full commit SHAs.");
  }
  return `<!-- review-gate-rewrite before=${before.toLowerCase()} after=${after.toLowerCase()} -->`;
}

// Returns `{ before, after }` for a comment that carries the marker, or null. Callers must check
// the comment's author themselves: only a marker written by the workflow that performed the
// rewrite is evidence, and anyone who can comment can write the text.
export function readReleaseBranchRewriteMarker(body) {
  const match = MARKER_PATTERN.exec(body ?? "");
  if (!match) return null;
  return { before: match[1].toLowerCase(), after: match[2].toLowerCase() };
}
