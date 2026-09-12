// The signals that say why an artifact acquisition was refused.
//
// A leaf module with no imports, because two places need the same list: the code that emits each
// signal, and the durable allowlist that decides whether a refusal can be persisted.
//
// That coupling is the point. An unregistered signal does not degrade gracefully -- it rejects the
// whole durable array, and the run then halts on non-canonical recovery metadata instead of
// recording the refusal the signal was describing. Emitting and persisting therefore read from one
// list rather than two that can drift, which is how the first version of these diagnostics broke
// the full-year run it was built to explain.
//
// The coupling is enforced by the types below rather than by asking each emitter to import a
// constant: an emitter declares it returns one of these, so a literal that is not on the list
// fails to compile. That is the level the last failure of this kind needed -- the list was right
// and the emitter simply wrote a string nobody had registered.
//
// Every entry is a Pack-owned constant. None carries portal text, a field value, or a path, so
// nothing portal-derived reaches durable state through them.
export const JSON_ARTIFACT_REJECTION_SIGNALS = [
  // No longer emitted: the size floor it described was removed once a live capture showed a valid
  // sub-100-byte envelope. It stays registered because durable state written by an earlier build
  // can still contain it, and an unregistered token rejects the whole array it travels in.
  "json-body-under-minimum",
  "json-body-empty",
  "json-body-oversized",
  "json-parse-failed",
  "json-status-unexpected",
  "json-envelope-missing",
  "json-period-field-missing",
  "json-period-mismatch",
  "json-contract-satisfied",
] as const;

export const GSTR1_ACQUISITION_DIAGNOSTIC_SIGNALS = [
  "gstr1-summary-preflight-rejected",
  "gstr1-pdf-expects-summary-page",
  "gstr1-excel-expects-detail-page",
  "gstr1-on-detail-page",
  "gstr1-on-other-page",
  "gstr1-control-label-unmatched",
  "gstr1-control-label-ambiguous",
] as const;

export const ARTIFACT_ACQUISITION_DIAGNOSTIC_SIGNALS = [
  ...JSON_ARTIFACT_REJECTION_SIGNALS,
  ...GSTR1_ACQUISITION_DIAGNOSTIC_SIGNALS,
] as const;

export type JsonArtifactRejectionSignal = (typeof JSON_ARTIFACT_REJECTION_SIGNALS)[number];
export type Gstr1AcquisitionDiagnosticSignal =
  (typeof GSTR1_ACQUISITION_DIAGNOSTIC_SIGNALS)[number];

// The portal's own refusals to produce an artifact: a filed GSTR-1 with no e-invoices to report,
// and a GSTR-2B the portal did not draft. Both are answers rather than faults, and a run records
// the artifact as unavailable and carries on.
//
// Three structures held this pair before -- a signal set, a reason set, and a map between them --
// in two modules, with the `artifact-` prefix that relates them stated nowhere. Adding the second
// refusal meant editing all three, and the relationship was only ever visible by reading them side
// by side.
export const DECLINED_ARTIFACT_SIGNALS = [
  "filed-gstr1-excel-no-details-available",
  "filed-gstr2b-not-generated",
] as const;

export type DeclinedArtifactSignal = (typeof DECLINED_ARTIFACT_SIGNALS)[number];

/** The reason recorded against the artifact, derived from the flow signal that carried it. */
export function declinedArtifactReason(
  signal: DeclinedArtifactSignal,
): `artifact-${DeclinedArtifactSignal}` {
  return `artifact-${signal}`;
}

export const DECLINED_ARTIFACT_REASONS = DECLINED_ARTIFACT_SIGNALS.map(declinedArtifactReason);
