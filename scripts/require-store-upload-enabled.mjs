#!/usr/bin/env node
// Fail-closed gate for a real Chrome Web Store upload.
//
// Invoked twice by `chrome-web-store.yml`, deliberately:
//
//   1. In the ungated `enablement` job, so a disabled upload fails immediately without
//      consuming a maintainer's deployment approval. GitHub evaluates `environment:` at
//      the job level, so a guard inside the protected job cannot report until after the
//      approval it exists to avoid.
//   2. In the `submit` job, immediately before the publisher. The first check is
//      check-time; this one is use-time. A protected-environment approval can sit pending
//      for days -- one sat for 22 in this repo (#336) -- and revoking the variable during
//      that window must revoke the upload. The submit job never re-reads repository
//      variables on its own, so without this the pending approval would still publish.
//
// One script rather than two copies of the same shell: a hand-maintained duplicate of a
// fact that already has a canonical source is the shape this repository's defects keep
// taking, and the release-pipeline copy of the whole submission job had already drifted
// (it passed no `--dry-run` flag) before it was deleted in this change.

const dryRun = process.env.CWS_DRY_RUN;
const enabled = process.env.CWS_SUBMIT_ENABLED;
const stage = process.env.CWS_GUARD_STAGE ?? "upload";

if (dryRun === "true") {
  console.log(`Dry run requested; no upload will occur. Enablement not required (${stage}).`);
  process.exit(0);
}

if (enabled !== "true") {
  console.error(
    `::error title=Chrome Web Store upload refused::A real upload was requested (dry_run=false) but the repository or organization variable CWS_SUBMIT_ENABLED is not exactly 'true' (${stage}). Nothing was uploaded. Re-run with dry_run=true to validate the package without uploading, or set the variable deliberately before retrying.`,
  );
  process.exit(1);
}

console.log(`CWS_SUBMIT_ENABLED is set; proceeding (${stage}).`);
