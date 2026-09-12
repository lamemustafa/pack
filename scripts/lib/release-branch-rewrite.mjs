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
// replacement. The gate ignores it until a successful compare-and-swap records the created head;
// timeline events alone cannot safely attribute a later head to this marker.
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

// Only the workflow that performs a rewrite can attest to what it discarded. Anyone who can
// comment can write the marker text, so the author is the whole of its authority: no human can post
// under this login. It lives beside the parser because a parser that cannot check authorship and an
// authority check kept somewhere else is how one of the two readers came to skip it.
const TRUSTED_REWRITE_RECORDER = "github-actions";

export function normaliseGithubLogin(login) {
  return String(login ?? "")
    .toLowerCase()
    .replace(/\[bot\]$/u, "");
}

// A marker is evidence only from this author. Both readers -- the workflow that writes records and
// the gate that reads them -- ask this same question of a comment before trusting its marker.
export function isTrustedRewriteRecord(comment) {
  return normaliseGithubLogin(comment?.user?.login) === TRUSTED_REWRITE_RECORDER;
}

// Returns `{ branch, before, after }` for a comment that carries the marker, or null. `after` is
// null for a record whose rewrite had not produced a head yet. This reads the text only: pair it
// with `isTrustedRewriteRecord` before treating a marker as evidence or as recoverable state.
export function readReleaseBranchRewriteMarker(body) {
  const match = MARKER_PATTERN.exec(body ?? "");
  if (!match) return null;
  return {
    branch: match[1],
    before: match[2].toLowerCase(),
    after: match[3] ? match[3].toLowerCase() : null,
  };
}
