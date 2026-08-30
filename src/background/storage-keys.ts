export const PACK_LOCAL_STORAGE_KEYS = {
  activeFiledReturnsRun: "pack:active-filed-returns-run",
  allSupportedFullFiscalYearLedgerIndex: "pack:all-supported-full-fiscal-year-ledger-index",
  fullFiscalYearLedger: "pack:full-fiscal-year-ledger",
  fullFiscalYearLedgerIndex: "pack:full-fiscal-year-ledger-index",
  install: "pack:install",
  lastManifest: "pack:last-manifest",
  singlePeriodStaging: "pack:single-period-staging",
  targetReview: "pack:filed-returns-target-review",
} as const;

export const FILED_RETURNS_PLAN_STORAGE_KEY_PREFIX = "pack:filed-returns-plan:";
export const ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_STORAGE_KEY_PREFIX =
  "pack:filed-returns-all-supported-plan:";

export const PACK_SESSION_STORAGE_KEYS = {
  lastContext: "pack:last-context",
  lastFiledReturnsObservation: "pack:last-filed-returns-observation",
  lastFiledReturnsFlowSummary: "pack:last-filed-returns-flow-summary",
  lastGstTabId: "pack:last-gst-tab-id",
  fullFiscalYearTabSession: "pack:full-fiscal-year-tab-session",
} as const;

export const PACK_CLEARABLE_LOCAL_STORAGE_KEYS = Object.values(PACK_LOCAL_STORAGE_KEYS);

export function filedReturnsStorageKeys() {
  return {
    activeRun: PACK_LOCAL_STORAGE_KEYS.activeFiledReturnsRun,
    allSupportedFullFiscalYearLedgerIndex:
      PACK_LOCAL_STORAGE_KEYS.allSupportedFullFiscalYearLedgerIndex,
    completion: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsFlowSummary,
    fullFiscalYearLedger: PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedger,
    fullFiscalYearLedgerIndex: PACK_LOCAL_STORAGE_KEYS.fullFiscalYearLedgerIndex,
    observation: PACK_SESSION_STORAGE_KEYS.lastFiledReturnsObservation,
    targetReview: PACK_LOCAL_STORAGE_KEYS.targetReview,
  };
}
