# v0.5 Beta Execution Register

This is the source-controlled execution register for the proposed Pack v0.5
beta. It does not authorize a release, a Store submission, or broader public
claims. Use [PUBLICATION_READINESS.md](PUBLICATION_READINESS.md) for the
release checklist and [LIVE_EVIDENCE_PROTOCOL.md](LIVE_EVIDENCE_PROTOCOL.md)
for authorised, redacted browser evidence.

## Beta Decision

**Status: not ready to promote.** Pack may move through the implementation
tranches below, but v0.5 beta requires the exact-candidate evidence and human
gates in this document.

The working product hypothesis is a local, target-bound GST archive with no
Pack account and no normal-operation transmission of selected GST artifacts to
ComplyEaze. This is a product hypothesis, not a legal, DPDP, or no-duplicate
guarantee.

Pack is not affiliated with, endorsed by, or operated by GSTN, CBIC, or the
Government of India.

## Non-Negotiable Boundary

- No new manifest or host permissions, telemetry, backend, remote
  configuration, login, or capture of non-artifact portal responses.
- GST credentials, OTPs, CAPTCHA responses, cookies, tokens, portal HTML, raw
  portal URLs, GSTIN/PAN, taxpayer names, ARN, original filenames, and local
  paths must not be persisted in Pack state or release evidence.
- A target becomes verified only from positive target-bound, non-empty browser
  download evidence. Missing download history is ambiguous, never proof that a
  download did not happen.
- An ambiguous externally visible action is review-required; it is never
  retried automatically.
- GSTR-1 and GSTR-3B are filed returns. GSTR-2B is a statement. A no-record
  result must not say “never filed.”
- Existing target-bound PDF/Excel artifact capture remains local-only: it may
  run only after user initiation, and artifact bytes may be held only in the
  bounded browser-local staging/export lifecycle. It must not expand into
  general portal-response collection.

## Current Source Position

| Area                | Source position                                                                                                                                             | Release interpretation                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store version       | `v0.4.0` is maintainer-reported; no dated dashboard export or read-only status result is recorded.                                                          | Do not use it as current-release proof.                                                                                                                    |
| Full fiscal year    | Archive/recovery code is present, but the background deliberately pauses new full-FY dispatch. Retained saved-run state may only be inspected or discarded. | Do not advertise, unpause, or test it as an available feature until its dedicated gate passes.                                                             |
| Ranges              | Single period and immutable same-FY custom-range planning are implemented.                                                                                  | Needs exact-ZIP browser coverage before Store/beta claims.                                                                                                 |
| Storage/recovery    | Strict local schemas, quarantine, action journal, target review, and explicit resume confirmation are implemented.                                          | Unit/static proof does not replace service-worker and browser-restart evidence.                                                                            |
| Archive UX          | Plan → Run → Results, local-processing acknowledgement, opaque archive paths, safe receipts, and requested-destination preview are implemented.             | Preview is a requested relative name/path; Chrome controls the final download folder.                                                                      |
| Availability floors | The planner bounds GSTR-1/GSTR-3B from July 2017 and GSTR-2B from July 2020.                                                                                | These are implementation bounds, not a claim that any period has an artifact. Record an official-source capture before making a public availability claim. |

## Implementation Tranches

### v0.4.1 — Release Truth and Stabilisation

1. Record a dated Chrome Web Store dashboard export for the reported v0.4.0
   state, listing, assets, permission rationale, and privacy declarations.
2. Configure the read-only Store status environment and record both an observed
   submitted state and an observed published state. An upload success is not
   publication proof.
3. Resolve high-severity dependency findings from the exact candidate lockfile
   and preserve the audit output as release evidence.
4. Run the existing single-period matrix from the exact published ZIP in a clean
   profile. Record sanitized results only.

### v0.4.2 — Durability Evidence

1. The exact-artifact browser verifier exercises synthetic `armed-unbound` and
   `evidence-bound-before-target-completion` action-journal records across an
   isolated browser restart. Each must remain unchanged, block the new flow,
   and create no browser download. Run `pnpm verify:browser`; exact-ZIP
   verification invokes the same matrix.
2. This synthetic matrix does not kill a service worker during a live portal
   action and does not prove a GST artifact outcome. An authorised operator
   must still exercise the remaining externally visible boundaries: before
   dispatch, after dispatch/before evidence binding, after artifact completion
   and before target persistence, and before/after final ZIP dispatch.
3. For that authorised run, kill the service worker and restart the browser
   under the applicable cases. Confirm no completed target is repeated and
   ambiguous actions become review-required.
4. The same synthetic exact-ZIP run stages one non-sensitive Pack-owned file
   through the real offscreen lifecycle, invokes Pack's normal local-data
   cleanup, then checks that extension local/session storage and OPFS are
   empty. This proves cleanup only for the synthetic verifier state; it does
   not inspect a live GST artifact.
5. Inspect extension storage and OPFS after live success, discard, failed cleanup,
   and expiry. Confirm the prohibited data list above is absent.
6. Do not unpause full-FY dispatch based on unit tests, the synthetic matrix,
   or prior source-build
   evidence alone.

### v0.4.3 — Focused Archive Validation

1. Verify GSTR-1 PDF/Excel/combined, GSTR-3B PDF, and GSTR-2B PDF/Excel/
   combined for every scope exposed by the UI.
2. Verify single period and custom same-FY range in clean Chrome and Brave
   profiles from the exact ZIP.
3. Use an authorised QRMP/cadence case where available. Otherwise retain
   review-required handling and narrow the release claim.
4. Test the archive destination preview against Chrome's actual requested
   relative filename, while acknowledging that Chrome controls the final
   download directory.

### v0.5.0 — Beta Promotion

1. Recruit five CA/GST-operations design partners. Use synthetic examples and
   blank templates only; do not request taxpayer files.
2. Validate the archive task and record task completion, developer assistance,
   reuse intent, and desired folder/index outcome manually outside the product.
   Keep only anonymised structured notes: no participant names/contact details,
   client labels, local paths/folder names, taxpayer identifiers, or
   portal-derived material. Product-owner and counsel policy govern any
   participant data handling.
3. Promote only if at least three participants rank the archive among their top
   two problems and all five can complete the repaired core task without
   developer intervention.
4. Build, test, checksum, and clean-profile verify one source-tagged candidate
   ZIP; submit that unchanged ZIP only after every gate is satisfied.

## Review Lanes

Do not turn the whole beta programme into one pull request. It spans runtime,
privacy, storage, UX, and release-copy surfaces that need independent review.
Create task-owned worktrees from the protected base and preserve the dependency
order below.

1. **Durability foundation:** target-bound completion, package-boundary checks,
   acknowledgement, strict local-state quarantine, and action-journal changes.
   Required reviewers: MV3 reliability, download/security, and privacy.
2. **Archive workflow:** safe run receipts, immutable same-FY targets, opaque
   archive paths, explicit resume confirmation, return-versus-statement wording,
   Plan → Run → Results, no-record review, and destination preview. Required
   reviewers: GST workflow, UX, MV3 reliability, and privacy.
3. **Release truth and beta register:** Store/dashboard wording, paused full-FY
   dispatch wording, publication checklist, and this execution register.
   Required reviewers: privacy/legal-claim, release, and product.

Each lane needs its own exact-head review and verification. A later lane must
not be represented as evidence that an earlier lane's browser or Store gate has
passed.

## Deferred Until Validation

- Cross-FY/full-history orchestration. Consider it only if at least three of
  five design partners rank it among their top two needs; keep one return type
  and FY per archive ZIP.
- Persisted archive profiles or client labels. They require a separate privacy
  design because free-form labels can become taxpayer/client identifiers.
- Workbooks, pivots, reconciliation, additional return types, accounting
  integrations, and capture of non-artifact portal responses.
- DPDP-role, compliance, “never processes,” “never filed,” and absolute
  no-duplicate public claims. Legal wording requires counsel review.

## Promotion Gate

All conditions must be proved for the exact candidate ZIP:

- No wrong-period, wrong-type, empty, or ambiguous false completion.
- No automatic retry after an ambiguous action; no repeated verified target
  across service-worker or browser restart.
- Every selected target reaches verified, unavailable with target-bound
  evidence, blocked, failed, or review-required.
- Storage/OPFS scans contain none of the prohibited data listed above, and
  temporary OPFS data is cleared after success, discard, and expiry.
- Package and ZIP verification reject development-only permissions and pass in
  Chrome and Brave clean profiles.
- Dependency, Store privacy declaration, policy, listing, reviewer
  instructions, and runtime behavior agree.
- Government non-affiliation remains visible. Counsel has reviewed any legal or
  DPDP wording.
- A hotfix/rollback playbook exists without a remote kill switch.

## Evidence Owners

| Gate                             | Evidence owner                                 | Cannot be replaced by                           |
| -------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Store state and declarations     | Store publisher                                | Workflow upload result or public-page inference |
| Live GST download/restart matrix | Authorised operator in Chrome/Brave            | DOM replay, in-app browser, or unit tests       |
| Storage and OPFS inspection      | Privacy/security reviewer                      | Regex redaction alone                           |
| QRMP/cadence outcome             | Authorised operator with suitable account      | Calendar/due-date inference                     |
| Availability-floor public claim  | Release owner with official GST source capture | Planner code or a calendar/due-date inference   |
| Design-partner validation        | Product owner                                  | Product telemetry or internal opinion           |
| Legal/DPDP wording               | Qualified counsel                              | Engineering review                              |
