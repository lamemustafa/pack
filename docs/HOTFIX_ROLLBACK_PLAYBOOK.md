# Pack Hotfix and Rollback Playbook

This playbook is for a released Pack build that may have a privacy, download
integrity, manifest, or availability defect. It is an operational procedure,
not evidence that any release has passed the v0.5 beta gate.

## Safety boundary

Pack has no remote kill switch, remote configuration, telemetry, or backend
control plane. Do not add one during an incident. A Store change cannot erase
an already installed extension, revoke a completed local download, or repair
local state remotely.

Do not place GST credentials, OTPs, CAPTCHA responses, cookies, tokens, GSTIN
or PAN values, taxpayer or client names, ARNs, portal HTML or URLs, original
filenames, local paths, portal screenshots, downloaded files, or browser
profiles in an incident ticket, release note, commit, pull request, or chat.

## Declare and contain

1. Stop release and Store-submission work. Do not run a live GST reproduction
   unless an authorised operator approves it under
   [LIVE_EVIDENCE_PROTOCOL.md](LIVE_EVIDENCE_PROTOCOL.md).
2. Record a sanitized incident identifier, discovery time, affected Pack source
   commit/tag and version if known, exact ZIP SHA-256 if known, impact class,
   and the evidence owner. An unknown version or checksum is a fact to record,
   not a reason to infer one.
3. Classify the report as one of: privacy boundary, wrong/ambiguous completion,
   duplicate external action, artifact integrity, manifest/package policy,
   availability/copy, or other. Escalate any possible data exposure through
   [SECURITY.md](../SECURITY.md).
4. Preserve only safe reproduction material: synthetic fixtures, source diff,
   package-verifier output, and redacted evidence summaries. Keep any live
   artifacts private to the authorised operator and out of the repository.

## Choose the response

| Condition                                              | Response                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candidate ZIP has not been submitted                   | Stop the candidate, fix on a new branch, and produce a new verified ZIP.                                                                                                                                                                                                             |
| Submitted update is pending review                     | The Store publisher decides whether to withdraw it in the Chrome Web Store dashboard. Record the dashboard action privately and do not claim that the existing public version changed until read-only status evidence confirms it.                                                   |
| Published build has a safety defect                    | Stop promotion claims, publish a version-incremented corrective update after the release gate, and use the Store dashboard’s available takedown or visibility controls only with publisher approval. Treat their effect as unverified until the read-only status monitor records it. |
| Report is unverified or affects only a local saved run | Do not erase user data remotely. Ship a reviewed fix that quarantines, blocks, or offers an explicit local discard path when the evidence supports it.                                                                                                                               |

The publisher owns Store dashboard actions. Engineering must not use unpublished
or undocumented Store APIs, a remote script, or a new permission to change an
installed build’s behaviour.

## Produce a corrective update

1. Create a task-owned branch from the protected base; never repair a release
   directly on `master`.
2. Make the smallest fix that restores the violated invariant. Preserve
   target-bound completion, explicit review for ambiguity, and the local-only
   data boundary. A user-visible retry must not become an automatic retry.
3. Add a synthetic regression that fails before the fix and proves the intended
   terminal/review behavior after it. Use a focused MV3, privacy, and GST-flow
   review for download, storage, manifest, or public-claim changes.
4. Run the release gate in [RELEASE.md](RELEASE.md), including the package and
   exact-ZIP verifiers. The corrective ZIP must have a new version and a new
   checksum; never reuse, overwrite, or relabel a prior Store ZIP.
5. Obtain exact-head review and record the source commit, source tag, ZIP
   checksum, verifier output, and disposition of the incident finding. A test
   pass does not substitute for a required live-evidence or Store-status gate.

## Publish, confirm, and close

1. Submit only the unchanged verified corrective ZIP through the protected
   release workflow. Follow [RELEASE.md](RELEASE.md) for the publisher-owned
   Chrome Web Store process.
2. Run the read-only Store status monitor for the corrective version. Record
   whether it is submitted, pending, published, warned, rejected, cancelled,
   failed, or taken down; an upload success alone is not publication proof.
3. If the incident affects an already published build, issue narrowly factual
   public copy only after the publisher and counsel approve it. Do not claim
   automatic removal, universal user update, legal compliance, no data impact,
   or a fix for users who have not installed the corrective update.
4. Close with a sanitized incident summary: impact category, affected version
   range only when evidenced, corrective version, verification references, and
   follow-up owner. Keep the beta execution register’s human-owned gates open
   until their own evidence is recorded.

## Minimum incident record

Keep the record outside public source control unless it is fully synthetic and
approved for publication:

- incident identifier and UTC timestamps;
- discovery and response owners;
- affected source commit/tag, version, and ZIP checksum when known;
- safe impact category and decision rationale;
- corrective commit/tag/version/checksum;
- release-gate, exact-head-review, and Store-status references;
- whether a live run was performed, recorded only as an authorised redacted
  evidence reference; and
- remaining owner and due date for each follow-up.

Never attach raw GST evidence to this record.
