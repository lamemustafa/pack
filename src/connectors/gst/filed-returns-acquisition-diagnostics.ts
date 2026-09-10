// The signals that say why an artifact acquisition was refused.
//
// A leaf module with no imports, because three places need the same list: the code that emits
// each signal, and the durable allowlist that decides whether a refusal can be persisted.
//
// That coupling is the point. An unregistered signal does not degrade gracefully -- it rejects the
// whole durable array, and the run then halts on non-canonical recovery metadata instead of
// recording the refusal the signal was describing. Emitting and persisting therefore read from one
// list rather than two that can drift, which is how the first version of these diagnostics broke
// the full-year run it was built to explain.
//
// Every entry is a Pack-owned constant. None carries portal text, a field value, or a path, so
// nothing portal-derived reaches durable state through them.
export const JSON_ARTIFACT_REJECTION_SIGNALS = [
  // No longer emitted: the size floor it described was removed once a live capture showed a valid
  // sub-100-byte envelope. It stays registered because durable state written by an earlier build
  // can still contain it, and an unregistered token rejects the whole array it travels in.
  "json-body-under-minimum",
  "json-body-empty",
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
