import { FILED_RETURNS_WORKBOOK_ABSENCE_OUTCOMES } from "./offscreen-blob-url";
import { FILED_RETURNS_MONTHS } from "./filed-returns-scope";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";
import { ARTIFACT_FAILURE_MESSAGES } from "./artifact-source";
import {
  ARTIFACT_ACQUISITION_CHECKPOINT_CLEAR_FAILURE_REASONS,
  artifactAcquisitionCheckpointClearFailureSignal,
} from "./artifact-acquisition-checkpoint-clear";
import {
  FILED_RETURNS_ARTIFACT_PROGRESS_FAILURE_REASONS,
  filedReturnsArtifactProgressFailureSignal,
} from "./filed-returns-artifact-progress-recovery";
import { isSafeDashboardSelectedValue } from "./dashboard-selected-signal-values";
import { FILED_RETURNS_OBSERVATION_SIGNALS } from "./filed-returns-observer-signals";
import {
  PACK_OFFSCREEN_FILED_RETURN_SUMMARY_ERROR_CATEGORIES,
  PACK_OFFSCREEN_FILED_RETURN_ZIP_ERROR_CATEGORIES,
} from "./offscreen-blob-url";
import { FILED_RETURNS_SUMMARY_RESPONSE_INVALID_CATEGORY } from "./filed-returns-summary-status";
import {
  SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES,
  singlePeriodCleanupCheckpointFailureSignal,
} from "./single-period-cleanup-checkpoint";
import {
  FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES,
  filedReturnsTargetReviewClearFailureSignal,
} from "./filed-returns-target-review-clear";

const MAX_DURABLE_SIGNAL_COUNT = 32;

const UNCONFIRMED_BROWSER_DOWNLOAD_SIGNALS = new Set([
  "browser-download-not-observed",
  "browser-download-size-unknown",
  "browser-download-interrupted",
  "browser-download-in-progress",
  "browser-download-correlation-rejected",
  "browser-download-search-unavailable",
  "browser-download-search-missing",
  "browser-download-zero-bytes",
  "browser-download-zero-size",
  "filed-return-download-trigger-ambiguous",
  "filed-gstr3b-download-trigger-ambiguous",
]);

export function isUnconfirmedFiledReturnsDownloadSignal(signal: string): boolean {
  return UNCONFIRMED_BROWSER_DOWNLOAD_SIGNALS.has(signal);
}

export type DurableFiledReturnsSignalRejectionReason =
  | "duplicate"
  | "non-string"
  | "not-array"
  | "over-cap"
  | "unknown-artifact"
  | "unknown-detail-identity"
  | "unknown-flow"
  | "unknown-navigation"
  | "unknown";

export const GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL =
  "filed-gstr1-period-mismatch-recovery-stopped";
export const RETURN_TYPE_MISMATCH_RECOVERY_STOPPED_SIGNAL =
  "filed-return-type-mismatch-recovery-stopped";
export const FILED_RETURN_ROUTE_MISMATCH_SIGNALS = {
  "GSTR-1": "gstr1-route-mismatched-return",
  "GSTR-2B": "gstr2b-summary-route-mismatched-return",
  "GSTR-3B": "gstr3b-route-mismatched-return",
} as const satisfies Record<FiledReturnsReturnType, string>;

export const FILED_RETURNS_FILENAME_UNAVAILABLE_SIGNALS = [
  "download-filename-unavailable",
  "zip-download-filename-item-unavailable",
  "zip-download-filename-search-unavailable",
  "zip-download-filename-unavailable",
] as const;
export const FILED_RETURNS_FILENAME_OVERRIDDEN_SIGNALS = [
  "download-filename-overridden",
  "zip-download-filename-overridden",
] as const;

const EXACT_DURABLE_SIGNALS = new Set([
  "artifact-acquisition-malformed-reference-unavailable",
  "filed-returns-active-run-malformed",
  "filed-returns-target-review-malformed",
  "filed-returns-target-review-not-found",
  "gstr2b-full-fiscal-year-acquisition-not-wired",
  "no-filed-returns-candidate",
  "result-row-gstr1",
  ...FILED_RETURNS_OBSERVATION_SIGNALS,
  "browser-download-completed",
  "browser-download-correlation-rejected",
  "browser-download-created",
  "browser-download-danger-pending",
  "browser-download-danger-rejected",
  "browser-download-danger-unknown",
  "browser-download-existence-unknown",
  "browser-download-file-missing",
  "browser-download-interrupted",
  "browser-download-in-progress",
  "browser-download-non-empty",
  "browser-download-not-observed",
  "browser-download-save-dialog-may-be-open",
  "browser-download-search-missing",
  "browser-download-search-unavailable",
  "browser-download-size-unknown",
  "browser-download-state-unconfirmed",
  "browser-download-zero-bytes",
  "detail-summary-modal",
  "detail-summary-modal-close-blocked",
  "detail-summary-modal-close-clicked",
  "detail-summary-modal-close-control-not-found",
  "detail-summary-modal-dismissed",
  "detail-summary-modal-open",
  "detail-ready-step-limit-reached",
  "download-excel-gstr1-visible",
  "download-excel-gstr2b-visible",
  ...FILED_RETURNS_FILENAME_UNAVAILABLE_SIGNALS,
  ...FILED_RETURNS_FILENAME_OVERRIDDEN_SIGNALS,
  "download-filed-gstr1-visible",
  "download-filed-gstr2b-visible",
  "download-filed-gstr3b-visible",
  "download-pdf-gstr1-visible",
  "download-pdf-gstr2b-visible",
  "excluded-filing-or-navigation-action",
  "excluded-missing-download-term",
  "excluded-pdf-download",
  "excluded-structured-data-download",
  "excluded-summary-dialog-portal-action",
  "excluded-system-generated-gstr3b",
  "filed-gstr1-controls-pending",
  "filed-gstr1-download-clicked",
  "filed-gstr1-download-status-not-filed",
  "filed-gstr1-download-trigger-ambiguous",
  "filed-gstr1-excel-control-pending",
  "filed-gstr1-excel-no-details-available",
  GSTR1_PERIOD_MISMATCH_RECOVERY_STOPPED_SIGNAL,
  "filed-gstr1-result-view-auto-attempt-failed",
  "filed-gstr1-result-view-auto-clicked",
  "filed-gstr1-result-view-navigation-pending",
  "filed-gstr1-result-view-user-action-required",
  "filed-gstr1-scope-switch-navigation",
  "filed-gstr1-summary-back-clicked",
  "filed-gstr1-summary-back-unavailable",
  "filed-gstr1-summary-period-mismatch",
  "filed-gstr1-summary-view-clicked",
  "filed-gstr1-summary-view-pending",
  "filed-gstr1-target-bound-detail",
  "filed-gstr1-visible-scope-mismatch",
  "filed-gstr3b-download-clicked",
  "filed-gstr3b-download-trigger-ambiguous",
  "filed-gstr3b-direct-download-action-mismatch",
  "filed-gstr3b-direct-download-authorized",
  "filed-gstr3b-direct-download-detail-unverified",
  "filed-gstr3b-direct-download-start-rejected",
  "filed-gstr3b-direct-download-started",
  "filed-gstr3b-direct-download-target-rejected",
  "filed-return-api-result-ambiguous",
  "filed-return-api-result-found",
  "filed-return-api-result-posted",
  "filed-return-api-result-role-status-unavailable",
  "filed-return-api-searched",
  "filed-return-detail-back-clicked",
  "filed-return-detail-back-not-found",
  "filed-return-detail-financial-year-missing",
  "filed-return-detail-period-missing",
  "filed-return-detail-period-unverified",
  "filed-return-detail-type-missing",
  "filed-return-download-clicked",
  "filed-return-download-diagnostics-rejected",
  "filed-return-download-id-persist-failed",
  "filed-return-download-ready",
  "filed-return-download-recovery-checkpoint",
  "filed-return-download-state-persist-failed",
  "filed-return-download-target-mismatch",
  "filed-return-download-trigger-ambiguous",
  "filed-return-durable-status-rejected",
  "filed-return-durable-status-rejected:duplicate",
  "filed-return-durable-status-rejected:non-string",
  "filed-return-durable-status-rejected:not-array",
  "filed-return-durable-status-rejected:over-cap",
  "filed-return-durable-status-rejected:unknown-artifact",
  "filed-return-durable-status-rejected:unknown-detail-identity",
  "filed-return-durable-status-rejected:unknown-flow",
  "filed-return-durable-status-rejected:unknown-navigation",
  "filed-return-durable-status-rejected:unknown",
  "filed-return-filter-bound-result-view-clicked",
  "filed-return-filter-bound-result-view-ready",
  "filed-return-filter-candidate-not-found",
  "filed-return-filter-selection-in-progress",
  "filed-return-filters-selected",
  "filed-return-offscreen-blob-url-rejected",
  "filed-return-portal-click-evidence-unavailable",
  "filed-return-positively-not-filed",
  "filed-return-result-row-ambiguous",
  "page-generated-excel-ready",
  "page-generated-pdf-ready",
  "filed-return-result-row-not-found",
  "filed-return-result-view-clicked",
  "filed-return-result-view-not-found",
  "filed-return-results-visible",
  "filed-return-search-results-pending",
  "filed-return-search-results-unchanged",
  RETURN_TYPE_MISMATCH_RECOVERY_STOPPED_SIGNAL,
  ...Object.values(FILED_RETURN_ROUTE_MISMATCH_SIGNALS),
  "filed-returns-candidate-clicked",
  "filed-returns-download-attempt-clear-failed",
  "filed-returns-download-id-not-found",
  "filed-returns-download-id-not-persisted",
  "filed-returns-download-intent-persisted",
  "filed-returns-download-manual-review-required",
  "filed-returns-download-reconciled-by-id",
  "filed-returns-download-reconciliation-required",
  "filed-returns-target-local-cleanup-required",
  "filed-returns-download-search-unavailable",
  "filed-returns-download-state-unknown",
  "filed-returns-gst-tab-focus-unavailable",
  "filed-returns-heading",
  "filed-returns-opfs-clear-failed",
  "filed-returns-opfs-clear-offscreen-unreachable",
  "filed-returns-opfs-clear-offscreen-response-invalid",
  "filed-returns-opfs-cleared",
  "filed-returns-page-settling",
  "filed-returns-route",
  "filed-returns-run-acknowledged",
  "filed-returns-run-active",
  "filed-returns-run-needs-review",
  "filed-returns-target-cancelled",
  "filed-returns-target-manually-observed",
  "filed-returns-target-bound-candidate-window-interrupted",
  "filed-returns-target-review-clear-failed",
  "filed-returns-target-review-storage-unavailable",
  ...FILED_RETURNS_TARGET_REVIEW_CLEAR_FAILURE_STAGES.map(
    filedReturnsTargetReviewClearFailureSignal,
  ),
  "filed-returns-target-review-required",
  "financial-year-selected",
  "flow-step-limit-reached",
  "all-supported-full-fiscal-year-no-zip-artifacts",
  "all-supported-full-fiscal-year-no-eligible-periods",
  "all-supported-full-fiscal-year-opfs-cleared",
  "all-supported-full-fiscal-year-opfs-staged",
  "all-supported-full-fiscal-year-opfs-retained",
  "all-supported-full-fiscal-year-artifact-staging-incomplete",
  "all-supported-full-fiscal-year-artifact-snapshot-mismatch",
  "all-supported-full-fiscal-year-complete",
  "all-supported-full-fiscal-year-final-zip-manual-review",
  "all-supported-full-fiscal-year-local-cleanup-retry",
  "all-supported-full-fiscal-year-plan-no-full-fiscal-year-returns",
  "all-supported-full-fiscal-year-plan-index-malformed",
  "all-supported-full-fiscal-year-plan-return-has-no-offered-artifacts",
  "all-supported-full-fiscal-year-restart-local-cleanup-failed",
  "all-supported-full-fiscal-year-restart-plan-not-found",
  "all-supported-full-fiscal-year-restart-plan-not-terminal",
  "all-supported-full-fiscal-year-restart-plan-superseded",
  "all-supported-full-fiscal-year-run-active",
  "all-supported-full-fiscal-year-run-interrupted",
  "all-supported-full-fiscal-year-run-needs-action",
  "all-supported-full-fiscal-year-target-artifact-staging-incomplete",
  "all-supported-full-fiscal-year-target-error",
  "all-supported-full-fiscal-year-target-running",
  "all-supported-full-fiscal-year-targets-complete",
  "all-supported-full-fiscal-year-zip-artifact-staging-incomplete",
  "all-supported-full-fiscal-year-zip-download-id-missing",
  "all-supported-full-fiscal-year-zip-download-id-not-found",
  "all-supported-full-fiscal-year-zip-download-search-unavailable",
  "all-supported-full-fiscal-year-zip-download-started",
  "all-supported-full-fiscal-year-zip-download-state-unknown",
  "all-supported-full-fiscal-year-zip-download-unconfirmed",
  "all-supported-full-fiscal-year-zip-downloaded",
  "all-supported-full-fiscal-year-zip-entry-count-mismatch",
  "all-supported-full-fiscal-year-zip-ledger-invalid",
  "all-supported-full-fiscal-year-zip-reconciled-by-id",
  "all-supported-full-fiscal-year-zip-target-plan-invalid",
  "full-fiscal-year-artifact-staging-incomplete",
  "full-fiscal-year-complete",
  "full-fiscal-year-completed-staging-cleanup-failed",
  "full-fiscal-year-download-unconfirmed",
  "full-fiscal-year-final-zip-manual-review",
  "full-fiscal-year-final-zip-retry",
  "full-fiscal-year-gst-tab-session-unavailable",
  "full-fiscal-year-ledger-malformed",
  "full-fiscal-year-local-cleanup-retry",
  "full-fiscal-year-manual-observation-needs-restaging",
  "full-fiscal-year-no-zip-artifacts",
  "full-fiscal-year-opfs-clear-failed",
  "full-fiscal-year-opfs-clear-offscreen-unreachable",
  "full-fiscal-year-opfs-clear-offscreen-response-invalid",
  "full-fiscal-year-opfs-cleared",
  "full-fiscal-year-opfs-retained",
  "full-fiscal-year-opfs-staged",
  "full-fiscal-year-pinned-gst-tab-unavailable",
  "full-fiscal-year-plan-narrower-than-eligible",
  "full-fiscal-year-target-plan-invalid",
  "full-fiscal-year-restaging-required",
  "full-fiscal-year-resume-confirmation-required",
  "full-fiscal-year-retained-staging-scope-conflict",
  "full-fiscal-year-run-active",
  "full-fiscal-year-run-discard-cleanup-failed",
  "full-fiscal-year-run-discarded",
  "full-fiscal-year-run-interrupted",
  "full-fiscal-year-run-needs-action",
  "full-fiscal-year-target-error",
  "full-fiscal-year-target-retry-approved",
  "full-fiscal-year-target-running",
  "full-fiscal-year-zip-artifact-staging-incomplete",
  "full-fiscal-year-zip-cleanup-pending",
  "full-fiscal-year-zip-download-id-missing",
  "full-fiscal-year-zip-download-id-not-found",
  "full-fiscal-year-zip-download-search-unavailable",
  "full-fiscal-year-zip-download-started",
  "full-fiscal-year-zip-download-state-unknown",
  "full-fiscal-year-zip-download-unconfirmed",
  "full-fiscal-year-zip-downloaded",
  "full-fiscal-year-zip-entry-count-mismatch",
  "full-fiscal-year-zip-export-pending",
  "full-fiscal-year-zip-reconciled-by-id",
  "full-fiscal-year-zip-target-state-invalid",
  "gst-login-tab-opened",
  "gst-portal-tab-required",
  "gstr1-dashboard-period-select-found",
  "gstr1-dashboard-period-select-missing",
  "gstr1-dashboard-quarter-select-found",
  "gstr1-dashboard-quarter-select-missing",
  "gstr1-dashboard-root-found",
  "gstr1-dashboard-root-missing",
  "gstr1-dashboard-search-found",
  "gstr1-dashboard-search-missing",
  "gstr1-dashboard-view-unchanged-after-search",
  "gstr1-dashboard-view-unscoped",
  "gstr1-dashboard-year-select-found",
  "gstr1-dashboard-year-select-missing",
  "gstr1-filed-returns-route-mismatched",
  "gstr1-return-dashboard-filter-selection-in-progress",
  "gstr1-return-dashboard-filters-selected",
  "gstr1-return-dashboard-route",
  "gstr1-return-dashboard-search-results-pending",
  "gstr1-detail-heading",
  "gstr1-detail-route",
  "gstr1-dashboard-view-clicked",
  "gstr1-artifact-content-unavailable",
  "gstr1-artifact-period-invalid",
  "gstr1-artifact-response-missing",
  "gstr1-artifact-state-invalid",
  "gstr2b-detail-heading",
  "gstr2b-detail-route",
  "gstr2b-dashboard-period-select-found",
  "gstr2b-dashboard-period-select-missing",
  "gstr2b-dashboard-quarter-select-found",
  "gstr2b-dashboard-quarter-select-missing",
  "gstr2b-dashboard-root-found",
  "gstr2b-dashboard-root-missing",
  "gstr2b-dashboard-search-found",
  "gstr2b-dashboard-search-missing",
  "gstr2b-dashboard-view-clicked",
  "gstr2b-dashboard-view-unchanged-after-search",
  "gstr2b-dashboard-view-unscoped",
  "gstr2b-dashboard-year-select-found",
  "gstr2b-dashboard-year-select-missing",
  "gstr2b-artifact-content-unavailable",
  "gstr2b-artifact-period-invalid",
  "gstr2b-artifact-response-missing",
  "gstr2b-artifact-state-invalid",
  "gstr2b-dialog-free-capture-unsupported",
  "gstr2b-download-clicked",
  "gstr2b-portal-blob-download-clicked",
  "gstr2b-return-dashboard-filter-selection-in-progress",
  "gstr2b-return-dashboard-filters-selected",
  "gstr2b-return-dashboard-loading",
  "gstr2b-return-dashboard-route",
  "gstr2b-return-dashboard-search-results-pending",
  "gstr3b-detail-heading",
  "gstr3b-detail-route",
  "hidden-filed-returns-candidate-clicked",
  "month-selected",
  "no-files-available-for-download",
  "page-identity-region-not-found",
  "page-target-unverified",
  "period-selected",
  "quarter-selected",
  "portal-blocked-or-session-expired",
  "portal-scheduled-downtime",
  "portal-system-error",
  "return-dashboard-candidate-clicked",
  "return-dashboard-after-returns-menu",
  "return-dashboard-after-services-menu",
  "return-dashboard-initial-scan",
  "returns-dashboard-anchor-ambiguous",
  "returns-dashboard-anchor-not-found",
  "returns-dashboard-anchor-timeout",
  "returns-dashboard-anchor-unavailable",
  "return-filing-period-left-unselected",
  "return-type-selected",
  "safe-dialog-dismissed",
  "no-return-dashboard-candidate",
  "wrong-origin-open-returns-dashboard",
  "search-clicked",
  "single-period-bundle-artifact-pending",
  "single-period-bundle-artifact-result-unavailable",
  "single-period-bundle-artifact-review-required",
  "single-period-bundle-artifact-running",
  "single-period-bundle-artifact-staged",
  "single-period-bundle-artifact-unavailable",
  "single-period-bundle-ledger-malformed",
  "single-period-bundle-recovered",
  "single-period-bundle-resume-pending",
  "single-period-bundle-revision-conflict",
  "single-period-bundle-running-ambiguous",
  "single-period-bundle-scope-conflict",
  "single-period-bundle-state-persist-failed",
  "single-period-bundle-state-read-failed",
  "single-period-cleanup-checkpoint-failed",
  ...SINGLE_PERIOD_CLEANUP_CHECKPOINT_FAILURE_STAGES.map(
    singlePeriodCleanupCheckpointFailureSignal,
  ),
  "single-period-cleanup-checkpoints-cleared",
  "single-period-opfs-cleanup-completed",
  "single-period-opfs-cleanup-required",
  "single-period-opfs-clear-failed",
  "single-period-opfs-clear-offscreen-unreachable",
  "single-period-opfs-clear-offscreen-response-invalid",
  "single-period-opfs-cleared",
  "single-period-opfs-retained",
  "single-period-opfs-staged",
  "single-period-zip-cancel-cleanup-failed",
  "single-period-zip-cleanup-without-download",
  "single-period-zip-download-reconciliation-required",
  "single-period-zip-download-started",
  "single-period-zip-downloaded",
  "single-period-zip-entry-plan-invalid",
  "single-period-zip-incomplete",
  "single-period-zip-recovery-checkpoint-missing",
  "single-period-zip-retry-cleanup-failed",
  "status-filed",
  "summary-dialog-close",
  "summary-dialog-close-class",
  "summary-dialog-x",
  "text-details-excel-gstr2b",
  "text-download-einvoice-gstr1",
  "text-download-einvoice-gstr2b",
  "text-download-excel-gstr1",
  "text-download-excel-gstr2b",
  "text-download-filed",
  "text-download-filed-gstr1",
  "text-download-filed-gstr2b",
  "text-download-filed-gstr3b",
  "text-download-gstr1",
  "text-download-gstr2b",
  "text-download-gstr3b",
  "text-download-pdf-gstr1",
  "text-download-pdf-gstr2b",
  "text-summary-pdf-gstr2b",
  "target-period-verified",
]);

/**
 * Sanity ceilings for a persisted ZIP entry count, one per plan kind.
 *
 * These bound an *observed* count -- the value comes off the assembled ZIP, not from a
 * prediction -- so their job is to refuse an implausible number, not to cap a run. Each is
 * the largest legitimate bundle for its kind plus the derived entries Pack writes itself,
 * and `tests/connectors/filed-returns-zip-entry-ceilings.test.ts`
 * re-derives the artifact half from the catalogue so adding a return type or a format fails
 * that test rather than silently exceeding a bound.
 *
 * Deliberately per kind. Sharing one ceiling across `full-fiscal-year` and
 * `all-supported-full-fiscal-year` raised the single-return ceiling from 38 to 108 as a side
 * effect of admitting the cross-return bundle -- widening a guard on a shipped path by three
 * times to make room for a new one.
 */
const ZIP_ENTRY_COUNT_CEILINGS = {
  // One period, every format a return type offers.
  "single-period": 3,
  // 36 artifacts (GSTR-2B, the widest single return: 12 periods x 3 formats) + 2 derived.
  "full-fiscal-year": 38,
  // 84 artifacts (GSTR-3B 24 + GSTR-1 24 + GSTR-2B 36) + one mixed-plan summary. Mixed plans
  // do not receive a return-specific workbook. Not 108: that assumed three formats for all
  // three return types, and only GSTR-2B offers three.
  "all-supported-full-fiscal-year": 85,
} as const;

const BROWSER_DOWNLOAD_ERROR_SUFFIXES = new Set([
  "file-blocked",
  "file-failed",
  "file-no-space",
  "file-too-large",
  "file-transient-error",
  "network-disconnected",
  "network-failed",
  "network-invalid-request",
  "network-server-down",
  "network-timeout",
  "network-unauthorized",
  "server-bad-content",
  "server-cert-problem",
  "server-content-length-mismatch",
  "server-cross-origin-redirect",
  "server-failed",
  "server-forbidden",
  "server-no-range",
  "server-precondition",
  "server-unauthorized",
  "user-canceled",
  "user-shutdown",
]);

const CAPTURE_PREFIXES = ["filed-gstr1", "filed-gstr2b", "filed-gstr3b", "gstr2b"];
const CAPTURE_SUFFIXES = [
  "blob-bytes-accepted",
  "blob-capture-failed",
  "blob-content-type-rejected",
  "blob-oversized-rejected",
  "blob-url-fetch-failed",
  "blob-url-fetch-rejected",
  "blob-url-fetch-unavailable",
  "blob-url-observed",
  "blob-zero-byte-rejected",
  "capture-control-ambiguous",
  "capture-control-artifact-mismatch",
  "capture-control-click-threw",
  "capture-control-fingerprint-mismatch",
  "capture-control-not-actionable",
  "capture-control-not-found",
  "capture-hook-install-failed",
  "capture-target-binding-missing",
  "capture-target-binding-invalid",
  "capture-target-evidence-conflict",
  "capture-target-identity-mismatch",
  "capture-target-identity-missing",
  "capture-target-path-mismatch",
  "captured-download-data-url-rejected",
  "chunk-count-rejected",
  "create-object-url-observed",
  "create-object-url-oversized",
  "create-object-url-zero-byte",
  "data-url-content-type-rejected",
  "data-url-observed",
  "data-url-rejected",
  "extension-download-requested",
  "extension-download-start-rejected",
  "extension-download-started",
  "fetch-artifact-response-observed",
  "fetch-content-type-rejected",
  "file-reader-error",
  "file-reader-result-rejected",
  "full-fiscal-year-zip-staged",
  "main-world-capture",
  "main-world-capture-armed",
  "main-world-capture-exception",
  "main-world-capture-result-rejected",
  "main-world-capture-timeout",
  "native-blob-click-suppressed",
  "native-data-click-suppressed",
  "native-https-download-suppressed",
  "native-window-open-suppressed",
  "opfs-chunk-stage-failed",
  "portal-blob-captured",
  "portal-blob-download-captured",
  "portal-data-url-captured",
  "portal-filename-observed",
  "single-period-zip-staged",
  "target-bound-native-blob-click-delegated",
  "unbound-blob-ignored",
  "unbound-blob-url-ignored",
  "unbound-create-object-url-ignored",
  "unbound-create-object-url-no-open-selection",
  "unbound-create-object-url-selection-open-invalid-context",
  "unbound-create-object-url-selection-open-no-context",
  "unbound-create-object-url-selection-open-valid-inactive-context",
  "unbound-data-url-ignored",
  "window-open-observed",
  "xhr-action-binding-ambiguous",
  "xhr-artifact-response-observed",
  "xhr-content-type-rejected",
  "xhr-page-callback-bound-load",
  "xhr-page-callback-bound-loadend",
  "xhr-page-callback-bound-readystatechange",
  "xhr-selection-closed-with-context",
  "xhr-selection-closed-without-context",
];
const CAPTURE_SIGNALS = new Set(
  CAPTURE_PREFIXES.flatMap((prefix) => CAPTURE_SUFFIXES.map((suffix) => `${prefix}-${suffix}`)),
);
const ZIP_SIGNAL_SUFFIXES = [
  "download-checkpoint-incomplete",
  "download-id-invalid",
  "download-id-persist-failed",
  "download-start-rejected",
  "download-started",
  "download-state-persist-failed",
  "download-unconfirmed",
  "downloaded",
  "entry-count-mismatch",
  "entry-plan-invalid",
  "export-failed",
];
const ZIP_SIGNALS = new Set(
  ["full-fiscal-year", "single-period"].flatMap((prefix) =>
    ZIP_SIGNAL_SUFFIXES.map((suffix) => `${prefix}-zip-${suffix}`),
  ),
);
const ZIP_EXPORT_ERROR_CATEGORIES = new Set<string>(
  PACK_OFFSCREEN_FILED_RETURN_ZIP_ERROR_CATEGORIES,
);
const SUMMARY_ERROR_CATEGORIES = new Set<string>([
  ...PACK_OFFSCREEN_FILED_RETURN_SUMMARY_ERROR_CATEGORIES,
  FILED_RETURNS_SUMMARY_RESPONSE_INVALID_CATEGORY,
]);
const OPFS_STAGE_ERROR_CATEGORIES = new Set([
  "blob-url-failed",
  "clear-failed",
  "invalid-data-url",
  "opfs-unavailable",
  "stage-failed",
  "zip-empty",
  "zip-failed",
  "zip-invalid-entry",
]);
const OPFS_CLEAR_ERROR_CATEGORIES = new Set(["clear-failed", "opfs-unavailable"]);

const SCOPED_RETURN_SIGNAL_SUFFIXES = new Set([
  "artifact-unsupported",
  "blob-capture-failed",
  "download-candidate-ambiguous",
  "download-candidate-pre-delegation",
  "download-candidate-missing",
  "download-candidate-not-found",
  "download-clicked",
  "download-ready",
  "extension-download-requested",
  "portal-blob-download-captured",
]);
const ARTIFACT_FAILURE_SIGNALS = new Set([
  "artifact-acquisition-failed",
  "artifact-filed-gstr1-excel-no-details-available",
  // Artifact-acquisition recovery exists to survive service-worker death, so
  // its outcomes must be persistable. Without these the blocked summary that
  // routes an interrupted acquisition to review is rejected by
  // parseDurableFiledReturnsSignals and dropped, which is the one case the
  // recovery path exists to handle.
  "artifact-acquisition-checkpoint-malformed",
  "artifact-acquisition-checkpoint-storage-unavailable",
  "artifact-acquisition-checkpoint-clear-failed",
  ...ARTIFACT_ACQUISITION_CHECKPOINT_CLEAR_FAILURE_REASONS.map(
    artifactAcquisitionCheckpointClearFailureSignal,
  ),
  ...FILED_RETURNS_ARTIFACT_PROGRESS_FAILURE_REASONS.map(filedReturnsArtifactProgressFailureSignal),
  // Marks a completion rebuilt from the review's own durable marker after the
  // browser session ended between persisting the summary and removing the
  // review. The exact download IDs lived in the cleared session checkpoints, so
  // this records that the completion is restored rather than re-observed.
  "artifact-acquisition-completion-restored",
  "artifact-acquisition-completion-pending-summary",
  "artifact-acquisition-session-proof-expired",
  "artifact-acquisition-start-unreconciled",
  "artifact-acquisition-download-interrupted",
  "artifact-acquisition-download-unconfirmed",
  "artifact-acquisition-download-unreconciled",
  "artifact-acquisition-download-search-unavailable",
  "artifact-acquisition-download-completed-unpersisted",
  "artifact-acquisition-download-reconciled",
  ...Object.keys(ARTIFACT_FAILURE_MESSAGES).map((reason) => `artifact-${reason}`),
]);

export function parseDurableFiledReturnsSignals(input: unknown): string[] | null {
  if (durableFiledReturnsSignalRejectionReason(input)) return null;
  return [...(input as string[])];
}

export function durableFiledReturnsSignalRejectionReason(
  input: unknown,
): DurableFiledReturnsSignalRejectionReason | null {
  if (!Array.isArray(input)) return "not-array";
  if (input.length > MAX_DURABLE_SIGNAL_COUNT) return "over-cap";
  for (const signal of input) {
    if (typeof signal !== "string") return "non-string";
  }
  if (new Set(input).size !== input.length) return "duplicate";
  const unknownSignal = input.find((signal) => !isDurableFiledReturnsSignal(signal));
  return unknownSignal === undefined ? null : durableUnknownSignalCategory(unknownSignal);
}

// This is intentionally a fixed projection: the rejected token is never
// persisted or rendered. It distinguishes Pack-owned producer families during
// live recovery without admitting portal-derived text into durable state.
function durableUnknownSignalCategory(signal: string): DurableFiledReturnsSignalRejectionReason {
  if (signal.startsWith("filed-return-detail-")) return "unknown-detail-identity";
  if (
    /^(?:artifact-|filed-gstr|page-|browser-download|full-fiscal-year-opfs|single-period-opfs)/.test(
      signal,
    )
  ) {
    return "unknown-artifact";
  }
  if (/^(?:filed-return|filed-returns|flow-|detail-ready|main-world)/.test(signal)) {
    return "unknown-flow";
  }
  if (/^(?:gstr|returns-dashboard|wrong-origin|portal-)/.test(signal)) {
    return "unknown-navigation";
  }
  return "unknown";
}

export function isDurableFiledReturnsSignal(signal: string): boolean {
  if (
    EXACT_DURABLE_SIGNALS.has(signal) ||
    CAPTURE_SIGNALS.has(signal) ||
    ZIP_SIGNALS.has(signal) ||
    ARTIFACT_FAILURE_SIGNALS.has(signal)
  ) {
    return true;
  }
  if (isDurableGstr2bDashboardSelectionSignal(signal)) return true;
  const artifactSignal =
    /^filed-return-artifact-(?:clicked|downloaded|failed|unavailable|unconfirmed):(PDF|JSON|EXCEL)$/.exec(
      signal,
    );
  if (artifactSignal) return true;
  const stagedArtifact =
    /^(?:all-supported-full-fiscal-year|full-fiscal-year|single-period)-opfs-staged:(PDF|JSON|EXCEL)$/.exec(
      signal,
    );
  if (stagedArtifact) return true;
  const missingArtifact =
    /^(?:all-supported-full-fiscal-year|full-fiscal-year)-artifact-not-staged:(PDF|JSON|EXCEL)$/.exec(
      signal,
    );
  if (missingArtifact) return true;
  const systemErrorPredecessor =
    /^(?:all-supported-full-fiscal-year|full-fiscal-year)-system-error-preceded-by:(artifact-trigger|detail-navigation|initial|other|portal-navigation)$/.exec(
      signal,
    );
  if (systemErrorPredecessor) return true;
  const periodSignal = /^filed-return-(?:detail|result)-period:([A-Za-z]+)$/.exec(signal);
  if (periodSignal) return FILED_RETURNS_MONTHS.includes(periodSignal[1] as never);
  const financialYearSignal = /^filed-return-detail-financial-year:(20\d{2})-(\d{2})$/.exec(signal);
  if (financialYearSignal) {
    return Number(financialYearSignal[2]) === (Number(financialYearSignal[1]) + 1) % 100;
  }
  if (/^filed-return-detail-type:(GSTR-1|GSTR-2B|GSTR-3B)$/.test(signal)) return true;
  const downloadIdSignal = /^browser-download-id:(\d{1,10})$/.exec(signal);
  if (downloadIdSignal) return Number.isSafeInteger(Number(downloadIdSignal[1]));
  const browserError = /^browser-download-error-([a-z0-9-]+)$/.exec(signal);
  if (browserError) return BROWSER_DOWNLOAD_ERROR_SUFFIXES.has(browserError[1] ?? "");
  const zipCount =
    /^(all-supported-full-fiscal-year|full-fiscal-year|single-period)-zip-(?:actual-entry-count|entry-count|expected-entry-count):(\d{1,3})$/.exec(
      signal,
    );
  if (zipCount) {
    const count = Number(zipCount[2]);
    const ceiling = ZIP_ENTRY_COUNT_CEILINGS[zipCount[1] as keyof typeof ZIP_ENTRY_COUNT_CEILINGS];
    return ceiling !== undefined && count <= ceiling;
  }
  if (
    // `workbook-only` is listed with the summary signals, not matched by a
    // prefix: it says which files the ZIP holds, not which outcome the workbook
    // reached. Omitting it made `persistLedgerAndSummary` reject the whole
    // signal array for every successful GSTR-2B run, which removed the canonical
    // session summary and let a download proceed with no recoverable intent.
    //
    // The modelled outcomes, not any suffix. Matching `[a-z-]+` was the wrong
    // correction for a real problem: it stopped a new value being dropped, but
    // it also accepted a stale or corrupted token such as
    // `full-fiscal-year-workbook-includded` as canonical, which the renderer
    // then reads as evidence that the workbook is absent.
    new RegExp(
      `^(?:full-fiscal-year-summary-included|full-fiscal-year-summary-outcomes-only|full-fiscal-year-summary-workbook-only|full-fiscal-year-summary-failed|full-fiscal-year-workbook-(?:${FILED_RETURNS_WORKBOOK_ABSENCE_OUTCOMES.join("|")}))$`,
    ).test(signal)
  ) {
    return true;
  }
  const summaryError = /^full-fiscal-year-summary-error:([a-z-]+)$/.exec(signal);
  if (summaryError) return SUMMARY_ERROR_CATEGORIES.has(summaryError[1] ?? "");
  const summaryParsedPeriodCount = /^full-fiscal-year-summary-parsed-period-count:(\d{1,2})$/.exec(
    signal,
  );
  if (summaryParsedPeriodCount) return Number(summaryParsedPeriodCount[1]) <= 12;
  const summaryRowCount = /^full-fiscal-year-summary-row-count:(\d{1,6})$/.exec(signal);
  if (summaryRowCount) {
    const count = Number(summaryRowCount[1]);
    return count >= 1 && count <= 100_000;
  }
  const opfsStageError =
    /^(all-supported-full-fiscal-year|full-fiscal-year|single-period)-opfs-stage-error:([a-z-]+)$/.exec(
      signal,
    );
  if (opfsStageError) return OPFS_STAGE_ERROR_CATEGORIES.has(opfsStageError[2] ?? "");
  const opfsClearError =
    /^(all-supported-full-fiscal-year|filed-returns|full-fiscal-year|single-period)-opfs-clear-error:([a-z-]+)$/.exec(
      signal,
    );
  if (opfsClearError) return OPFS_CLEAR_ERROR_CATEGORIES.has(opfsClearError[2] ?? "");
  const zipExportError =
    /^(all-supported-full-fiscal-year|full-fiscal-year|single-period)-zip-export-error:([a-z-]+)$/.exec(
      signal,
    );
  if (zipExportError) return ZIP_EXPORT_ERROR_CATEGORIES.has(zipExportError[2] ?? "");
  const scopedReturnSignal = /^filed-(gstr1|gstr2b|gstr3b)-(.+)$/.exec(signal);
  if (scopedReturnSignal) {
    return SCOPED_RETURN_SIGNAL_SUFFIXES.has(scopedReturnSignal[2] ?? "");
  }
  return [
    "full-fiscal-year-zip-phase:download-intent-persisted",
    "full-fiscal-year-zip-phase:download-observing",
    "full-fiscal-year-zip-phase:download-started",
    "full-fiscal-year-zip-phase:downloaded-cleanup-pending",
    "full-fiscal-year-zip-phase:no-artifacts-cleanup-pending",
    "full-fiscal-year-zip-phase:export-retry-pending",
    "full-fiscal-year-zip-phase:legacy-cleanup-pending",
    "pack-error:CONTENT_SCRIPT_UNAVAILABLE",
  ].includes(signal);
}

function isDurableGstr2bDashboardSelectionSignal(signal: string): boolean {
  const year = /^gstr2b-dashboard-selected-year:([a-z0-9-]{1,40})$/.exec(signal)?.[1];
  if (year) return isSafeDashboardSelectedValue("year", year);

  const quarter = /^gstr2b-dashboard-selected-quarter:([a-z0-9-]{1,40})$/.exec(signal)?.[1];
  if (quarter) return isSafeDashboardSelectedValue("quarter", quarter);

  const period = /^gstr2b-dashboard-selected-period:([a-z0-9-]{1,40})$/.exec(signal)?.[1];
  return Boolean(period && isSafeDashboardSelectedValue("period", period));
}
