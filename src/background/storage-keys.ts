export const PACK_LOCAL_STORAGE_KEYS = {
  activeFiledReturnsRun: "pack:active-filed-returns-run",
  fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
  install: "pack:install",
  lastManifest: "pack:last-manifest",
  singlePeriodStaging: "pack:single-period-staging",
  targetReview: "pack:filed-returns-target-review",
} as const;

export const PACK_SESSION_STORAGE_KEYS = {
  lastContext: "pack:last-context",
  lastFiledReturnsObservation: "pack:last-filed-returns-observation",
  lastFiledReturnsFlowSummary: "pack:last-filed-returns-flow-summary",
  lastGstTabId: "pack:last-gst-tab-id",
} as const;

export const PACK_CLEARABLE_LOCAL_STORAGE_KEYS = Object.values(PACK_LOCAL_STORAGE_KEYS);

export function filedReturnsStorageKeys() {
  return {
    activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun,
    completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
    fullFiscalYearLedger: PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedger,
    observation: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation,
    targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
  };
}
