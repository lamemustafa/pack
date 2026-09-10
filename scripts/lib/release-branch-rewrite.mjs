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
//
// A record is written in two stages because the rewrite is not atomic with the recording of it.
// The `before` head is written first, while it is still the branch head; the `after` head is added
// once the rewrite has produced one. A record stopped in between names a discarded head and no
// replacement, which identifies nothing on its own -- so the gate ignores it, and the next run
// completes it from the branch head it finds, which is precisely the head that rewrite created.
const MARKER_PATTERN =
  /<!--\s*review-gate-rewrite\s+branch=(\S+)\s+before=([0-9a-f]{40})(?:\s+after=([0-9a-f]{40}))?\s*-->/iu;

const SHA_PATTERN = /^[0-9a-f]{40}$/iu;

export function formatReleaseBranchRewriteMarker({ branch, before, after = null }) {
  if (!branch || /\s/u.test(branch)) {
    throw new Error("A release branch rewrite marker needs a whitespace-free branch name.");
  }
  if (!SHA_PATTERN.test(before ?? "")) {
    throw new Error("A release branch rewrite marker needs a full discarded-head SHA.");
  }
  if (after !== null && !SHA_PATTERN.test(after)) {
    throw new Error("A release branch rewrite marker needs a full created-head SHA or none.");
  }
  const suffix = after === null ? "" : ` after=${after.toLowerCase()}`;
  return `<!-- review-gate-rewrite branch=${branch} before=${before.toLowerCase()}${suffix} -->`;
}

// Returns `{ branch, before, after }` for a comment that carries the marker, or null. `after` is
// null for a record whose rewrite had not produced a head yet. Callers must check the comment's
// author themselves: only a marker written by the workflow that performed the rewrite is evidence,
// and anyone who can comment can write the text.
export function readReleaseBranchRewriteMarker(body) {
  const match = MARKER_PATTERN.exec(body ?? "");
  if (!match) return null;
  return {
    branch: match[1],
    before: match[2].toLowerCase(),
    after: match[3] ? match[3].toLowerCase() : null,
  };
}
