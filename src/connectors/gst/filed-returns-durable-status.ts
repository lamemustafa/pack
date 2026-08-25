import type { UserActionRequired } from "../../core/contracts";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearTargetStatus,
} from "./filed-returns-contracts";
import {
  isFiledReturnsArtifactType,
  normaliseFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "./filed-returns-artifacts";
import { filedReturnsArtifactProgressFailureReasonFromSignal } from "./filed-returns-artifact-progress-recovery";
import {
  isFiledReturnsReturnType,
  type FiledReturnsReturnType,
} from "./filed-returns-return-types";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
  isFiledReturnsFinancialYear,
} from "./filed-returns-scope";
import {
  FILED_RETURNS_FILENAME_OVERRIDDEN_SIGNALS,
  FILED_RETURNS_FILENAME_UNAVAILABLE_SIGNALS,
  FILED_RETURN_ROUTE_MISMATCH_SIGNALS,
  RETURN_TYPE_MISMATCH_RECOVERY_STOPPED_SIGNAL,
  durableFiledReturnsSignalRejectionReason,
  isUnconfirmedFiledReturnsDownloadSignal,
  parseDurableFiledReturnsSignals,
} from "./filed-returns-durable-signals";
import {
  filedReturnsSummaryStatusMessage,
  type FiledReturnsSummaryLifecycle,
} from "./filed-returns-summary-status";
import {
  FILED_RETURNS_PORTAL_BLOCKED_OR_SESSION_EXPIRED_MESSAGE,
  FILED_RETURNS_PORTAL_SCHEDULED_DOWNTIME_MESSAGE,
  FILED_RETURNS_PORTAL_SYSTEM_ERROR_MESSAGE,
} from "./filed-returns-portal-availability";

type DurableMessageKey =
  | "complete"
  | "durable-status-rejected"
  | "full-year-active"
  | "full-year-complete-download-unconfirmed"
  | "full-year-downloaded-cleanup-blocked"
  | "full-year-interrupted"
  | "full-year-needs-action"
  | "full-year-no-artifacts"
  | "full-year-resume"
  | "full-year-zip-review"
  | "not-filed"
  | "partial"
  | "target-cancelled"
  | "target-blocked"
  | "target-blocked-or-session-expired"
  | "target-checkpoint-clear-cancel"
  | "target-checkpoint-clear-checkpoint"
  | "target-checkpoint-clear-danger"
  | "target-checkpoint-clear-download"
  | "target-checkpoint-clear-size"
  | "target-checkpoint-clear-state"
  | "target-checkpoint-clear-storage-read"
  | "target-checkpoint-clear-storage-remove"
  | "target-checkpoint-clear-target"
  | "target-artifact-progress-malformed-summary"
  | "target-artifact-progress-storage-read-failed"
  | "target-artifact-progress-storage-write-failed"
  | "target-completion-pending-summary"
  | "target-cleanup-blocked"
  | "target-downloaded"
  | "target-downloaded-cleanup-blocked"
  | "target-failed"
  | "target-manually-observed"
  | "target-pending"
  | "target-restaging"
  | "target-retry-approved"
  | "target-review"
  | "target-running"
  | "target-scheduled-downtime"
  | "target-system-error";

export function canonicalDurableTargetStatus(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFullFiscalYearTargetStatus | "target-review",
  inputSignals: unknown,
): { safeMessage: string; safeSignals: string[] } {
  const safeSignals = parseDurableFiledReturnsSignals(inputSignals);
  if (!safeSignals) {
    const reason = durableFiledReturnsSignalRejectionReason(inputSignals) ?? "unknown";
    return {
      safeSignals: [
        "filed-return-durable-status-rejected",
        `filed-return-durable-status-rejected:${reason}`,
      ],
      safeMessage: renderDurableMessage("durable-status-rejected", scope),
    };
  }
  return {
    safeSignals,
    safeMessage: canonicalDurableTargetMessage(scope, status, safeSignals),
  };
}

export function parseDurableTargetStatus(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFullFiscalYearTargetStatus | "target-review",
  inputSignals: unknown,
): { safeMessage: string; safeSignals: string[] } | null {
  const safeSignals = parseDurableFiledReturnsSignals(inputSignals);
  if (!safeSignals) return null;
  return {
    safeSignals,
    safeMessage: canonicalDurableTargetMessage(scope, status, safeSignals),
  };
}

export function isHistoricalDurableTargetMessage(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFullFiscalYearTargetStatus | "target-review",
  signals: readonly string[],
  safeMessage: string,
): boolean {
  // This one-way migration admits only the old derived target-review cache for the
  // newly distinct blocked/failed message keys. The exact-match guard otherwise rejects
  // stale or arbitrary text; remove this once no persisted ledger can carry that cache.
  const messageKey = messageKeyForTarget(status, signals);
  if (
    filenameOutcomeMessage(signals, "download") &&
    safeMessage === renderDurableMessage(messageKey, scope)
  ) {
    return true;
  }
  if (
    ![
      "target-blocked",
      "target-blocked-or-session-expired",
      "target-failed",
      "target-scheduled-downtime",
      "target-system-error",
    ].includes(messageKey)
  ) {
    return false;
  }
  return safeMessage === renderDurableMessage("target-review", scope);
}

export function canonicalDurableSummaryMessage(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFlowSummary["status"],
  signals: readonly string[],
): string {
  const mismatchedReturnType = visibleReturnTypeMismatch(scope, status, signals);
  if (mismatchedReturnType) {
    return incompleteReturnTypeMismatchRecoveryMessage(scope, mismatchedReturnType);
  }
  const mismatchedGstr1Period = visibleGstr1MismatchPeriod(scope, status, signals);
  if (mismatchedGstr1Period) {
    return incompleteGstr1PeriodMismatchRecoveryMessage(scope, mismatchedGstr1Period);
  }
  let partialMessage: string | null = null;
  if (status === "partial") {
    const missingArtifacts = signals
      .map((signal) => /^filed-return-artifact-unavailable:(PDF|JSON|EXCEL)$/.exec(signal)?.[1])
      .filter((artifactType): artifactType is string => Boolean(artifactType));
    const missingReasons = signals.filter((signal) => /^artifact-[a-z0-9-]+$/.test(signal));
    if (missingArtifacts.length > 0 && missingArtifacts.length === missingReasons.length) {
      partialMessage = `Pack prepared a partial ZIP; missing ${missingArtifacts
        .map((artifactType, index) => `${artifactType} (${missingReasons[index]})`)
        .join(", ")}.`;
    }
  }
  const durableMessageKey = messageKeyForSummary(scope, status, signals);
  const durableMessage = partialMessage ?? renderDurableMessage(durableMessageKey, scope);
  const summaryMessage = filedReturnsSummaryStatusMessage(
    signals,
    summaryLifecycleForDurableSignals(signals),
  );
  const filenameMessage =
    durableMessageKey === "full-year-complete-download-unconfirmed" ||
    durableMessageKey === "full-year-no-artifacts" ||
    durableMessageKey === "not-filed"
      ? ""
      : filenameOutcomeMessage(signals, "download");
  return [durableMessage, summaryMessage, filenameMessage].filter(Boolean).join(" ");
}

function canonicalDurableTargetMessage(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFullFiscalYearTargetStatus | "target-review",
  signals: readonly string[],
): string {
  return [
    renderDurableMessage(messageKeyForTarget(status, signals), scope),
    filenameOutcomeMessage(signals, status === "downloaded" ? "download" : "unresolved-target"),
  ]
    .filter(Boolean)
    .join(" ");
}

function filenameOutcomeMessage(
  signals: readonly string[],
  context: "download" | "unresolved-target",
): string {
  if (FILED_RETURNS_FILENAME_OVERRIDDEN_SIGNALS.some((signal) => signals.includes(signal))) {
    return context === "download"
      ? "Pack completed the download, but the browser saved it under a different name. Check browser Downloads before using the file."
      : "The browser may have used a different saved name, but Pack could not verify that any file belongs to this unresolved target. Check browser Downloads before using a file.";
  }
  if (FILED_RETURNS_FILENAME_UNAVAILABLE_SIGNALS.some((signal) => signals.includes(signal))) {
    return context === "download"
      ? "Pack completed the download, but could not confirm its saved filename. Check browser Downloads before using the file."
      : "Pack could not confirm the saved filename for this unresolved target. Check browser Downloads before using a file.";
  }
  return "";
}

function summaryLifecycleForDurableSignals(
  signals: readonly string[],
): FiledReturnsSummaryLifecycle {
  if (signals.includes("full-fiscal-year-zip-downloaded")) return "confirmed";
  if (
    signals.includes("full-fiscal-year-zip-phase:download-observing") ||
    signals.some(isUnconfirmedFiledReturnsDownloadSignal) ||
    signals.some((signal) =>
      [
        "full-fiscal-year-zip-download-id-invalid",
        "full-fiscal-year-zip-download-id-persist-failed",
      ].includes(signal),
    )
  ) {
    return "unconfirmed";
  }
  if (signals.includes("full-fiscal-year-zip-phase:download-intent-persisted")) return "intent";
  return "unconfirmed";
}

export function incompleteReturnTypeMismatchRecoveryMessage(
  scope: FiledReturnsDownloadScope,
  visibleReturnType: FiledReturnsReturnType,
): string {
  return `Pack remained on a filed ${visibleReturnType} page after one bounded navigation attempt, while the requested return is ${scope.returnType}. ${returnTypeMismatchRecoveryInstruction(scope)}`;
}

export function returnTypeMismatchRecoveryInstruction(scope: FiledReturnsDownloadScope): string {
  return `Open the requested ${scope.returnType} return page in the GST Portal, then start Pack again.`;
}

export function incompleteGstr1PeriodMismatchRecoveryMessage(
  scope: FiledReturnsDownloadScope,
  visiblePeriod: string,
): string {
  return `Pack found a filed GSTR-1 page showing ${visiblePeriod}, but could not reach the requested ${scope.period} period. ${gstr1PeriodMismatchRecoveryInstruction(scope)}`;
}

export function gstr1PeriodMismatchRecoveryInstruction(scope: FiledReturnsDownloadScope): string {
  return `Open the GST Returns Dashboard for ${scope.period}, then start Pack again.`;
}

export function gstr1PeriodMismatchRecoveryUserAction(
  scope: FiledReturnsDownloadScope,
): UserActionRequired {
  return {
    type: "NAVIGATE_TO_SUPPORTED_PAGE",
    message: gstr1PeriodMismatchRecoveryInstruction(scope),
    canResume: true,
  };
}

export function hasConfirmedSinglePeriodZipDownloadEvidence(signals: readonly string[]): boolean {
  const downloadIds = signals.filter((signal) => /^browser-download-id:\d{1,10}$/.test(signal));
  return (
    signals.includes("single-period-zip-downloaded") &&
    signals.includes("browser-download-completed") &&
    signals.includes("browser-download-non-empty") &&
    downloadIds.length === 1 &&
    !signals.some(isContradictoryDownloadSignal)
  );
}

export function parseDurableFiledReturnsScope(
  input: unknown,
  allowFullFiscalYear = true,
): FiledReturnsDownloadScope | null {
  if (!input || typeof input !== "object") return null;
  const scope = input as Partial<FiledReturnsDownloadScope> & Record<string, unknown>;
  if (
    !hasOnlyKeys(scope, [
      "artifactType",
      "completedPeriods",
      "financialYear",
      "period",
      "returnType",
    ])
  ) {
    return null;
  }
  if (!isFiledReturnsFinancialYear(scope.financialYear)) return null;
  if (!isFiledReturnsReturnType(scope.returnType)) return null;
  if (
    typeof scope.period !== "string" ||
    (!FILED_RETURNS_MONTHS.includes(scope.period as never) &&
      (!allowFullFiscalYear || scope.period !== FULL_FISCAL_YEAR_PERIOD))
  ) {
    return null;
  }
  const artifactType = scope.artifactType ?? "PDF";
  if (
    !isFiledReturnsArtifactType(artifactType) ||
    !supportsFiledReturnsArtifactType(scope.returnType, artifactType) ||
    normaliseFiledReturnsArtifactType(scope.returnType, artifactType) !== artifactType
  ) {
    return null;
  }
  const completedPeriods =
    scope.completedPeriods === undefined ? undefined : parsePeriods(scope.completedPeriods);
  if (scope.completedPeriods !== undefined && !completedPeriods) return null;
  return {
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
    ...(scope.artifactType ? { artifactType } : {}),
    ...(completedPeriods ? { completedPeriods } : {}),
  };
}

function messageKeyForTarget(
  status: FiledReturnsFullFiscalYearTargetStatus | "target-review",
  signals: readonly string[],
): DurableMessageKey {
  if (signals.includes("filed-return-durable-status-rejected")) return "durable-status-rejected";
  const artifactProgressReason = signals
    .map(filedReturnsArtifactProgressFailureReasonFromSignal)
    .find((reason) => reason !== null);
  if (artifactProgressReason === "malformed-summary") {
    return "target-artifact-progress-malformed-summary";
  }
  if (artifactProgressReason === "storage-read-failed") {
    return "target-artifact-progress-storage-read-failed";
  }
  if (artifactProgressReason === "storage-write-failed") {
    return "target-artifact-progress-storage-write-failed";
  }
  const checkpointClearReason = signals
    .map((signal) => /^artifact-acquisition-checkpoint-clear-failed:(.+)$/.exec(signal)?.[1])
    .find((reason): reason is string => Boolean(reason));
  if (checkpointClearReason === "storage-read-failed") {
    return "target-checkpoint-clear-storage-read";
  }
  if (checkpointClearReason === "storage-remove-failed") {
    return "target-checkpoint-clear-storage-remove";
  }
  if (
    checkpointClearReason === "download-search-failed" ||
    checkpointClearReason === "download-missing"
  ) {
    return "target-checkpoint-clear-download";
  }
  if (
    checkpointClearReason === "download-cancel-failed" ||
    checkpointClearReason === "download-cancel-unconfirmed"
  ) {
    return "target-checkpoint-clear-cancel";
  }
  if (
    checkpointClearReason === "checkpoint-invalid" ||
    checkpointClearReason === "intent-discard-not-approved"
  ) {
    return "target-checkpoint-clear-checkpoint";
  }
  if (checkpointClearReason === "download-target-mismatch") {
    return "target-checkpoint-clear-target";
  }
  if (checkpointClearReason?.startsWith("download-danger-")) {
    return "target-checkpoint-clear-danger";
  }
  if (
    checkpointClearReason === "download-size-unknown" ||
    checkpointClearReason === "download-empty"
  ) {
    return "target-checkpoint-clear-size";
  }
  if (checkpointClearReason) return "target-checkpoint-clear-state";
  if (signals.includes("artifact-acquisition-completion-pending-summary")) {
    return "target-completion-pending-summary";
  }
  if (signals.includes("full-fiscal-year-restaging-required")) return "target-restaging";
  if (signals.includes("full-fiscal-year-target-retry-approved")) return "target-retry-approved";
  if (signals.includes("filed-returns-target-manually-observed")) return "target-manually-observed";
  if (hasCleanupFailureSignal(signals)) {
    return "target-cleanup-blocked";
  }
  if (signals.includes("filed-return-positively-not-filed") || status === "not-filed") {
    return "not-filed";
  }
  if (status === "pending") return "target-pending";
  if (status === "running") return "target-running";
  if (status === "downloaded") return "target-downloaded";
  if (status === "cancelled") return "target-cancelled";
  if (status === "blocked" || status === "failed") {
    const portalAvailabilityKey = portalAvailabilityMessageKey(signals);
    if (portalAvailabilityKey) return portalAvailabilityKey;
    return status === "failed" ? "target-failed" : "target-blocked";
  }
  return "target-review";
}

function portalAvailabilityMessageKey(signals: readonly string[]): DurableMessageKey | null {
  if (signals.includes("portal-system-error")) return "target-system-error";
  if (signals.includes("portal-scheduled-downtime")) return "target-scheduled-downtime";
  if (signals.includes("portal-blocked-or-session-expired")) {
    return "target-blocked-or-session-expired";
  }
  return null;
}

export function visibleGstr1MismatchPeriod(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFlowSummary["status"],
  signals: readonly string[],
): string | null {
  if (scope.returnType !== "GSTR-1" || status !== "blocked") return null;
  if (
    !signals.some((signal) =>
      ["filed-gstr1-scope-switch-navigation", "filed-gstr1-summary-period-mismatch"].includes(
        signal,
      ),
    )
  ) {
    return null;
  }
  const visiblePeriod = signals
    .map((signal) => /^filed-return-detail-period:([A-Za-z]+)$/.exec(signal)?.[1])
    .find((period): period is string => Boolean(period && period !== scope.period));
  return visiblePeriod && FILED_RETURNS_MONTHS.includes(visiblePeriod as never)
    ? visiblePeriod
    : null;
}

function visibleReturnTypeMismatch(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFlowSummary["status"],
  signals: readonly string[],
): FiledReturnsReturnType | null {
  if (status !== "blocked" || !signals.includes(RETURN_TYPE_MISMATCH_RECOVERY_STOPPED_SIGNAL)) {
    return null;
  }
  const visibleReturnTypes = Object.entries(FILED_RETURN_ROUTE_MISMATCH_SIGNALS)
    .filter(([, signal]) => signals.includes(signal))
    .map(([returnType]) => returnType as FiledReturnsReturnType)
    .filter((returnType) => returnType !== scope.returnType);
  return visibleReturnTypes.length === 1 ? (visibleReturnTypes[0] ?? null) : null;
}

function messageKeyForSummary(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFlowSummary["status"],
  signals: readonly string[],
): DurableMessageKey {
  const isFullFiscalYear = scope.period === FULL_FISCAL_YEAR_PERIOD;
  if (signals.includes("filed-return-durable-status-rejected")) return "durable-status-rejected";
  if (isFullFiscalYear && signals.includes("full-fiscal-year-resume-confirmation-required")) {
    return "full-year-resume";
  }
  if (isFullFiscalYear && signals.includes("full-fiscal-year-run-interrupted")) {
    return "full-year-interrupted";
  }
  const blockingRecoveryKey = blockingSummaryRecoveryMessageKey(signals, isFullFiscalYear);
  if (isFullFiscalYear && signals.includes("full-fiscal-year-run-needs-action")) {
    if (blockingRecoveryKey) return blockingRecoveryKey;
    if (signals.includes("filed-returns-target-review-required")) return "target-review";
    if (status === "blocked" || status === "partial") {
      const portalAvailabilityKey = portalAvailabilityMessageKey(signals);
      if (portalAvailabilityKey) return portalAvailabilityKey;
    }
    return "full-year-needs-action";
  }
  if (isFullFiscalYear && signals.includes("full-fiscal-year-run-active")) {
    return "full-year-active";
  }
  if (blockingRecoveryKey) return blockingRecoveryKey;
  if (signals.includes("filed-return-positively-not-filed")) return "not-filed";
  if (signals.includes("filed-returns-target-review-required")) return "target-review";
  if (status === "blocked" || status === "partial") {
    const portalAvailabilityKey = portalAvailabilityMessageKey(signals);
    if (portalAvailabilityKey) return portalAvailabilityKey;
  }
  if (
    isFullFiscalYear &&
    status === "complete" &&
    signals.includes("full-fiscal-year-no-zip-artifacts")
  ) {
    return "full-year-no-artifacts";
  }
  if (
    isFullFiscalYear &&
    status === "complete" &&
    signals.includes("full-fiscal-year-complete") &&
    !signals.includes("full-fiscal-year-zip-downloaded")
  ) {
    return "full-year-complete-download-unconfirmed";
  }
  if (status === "complete") return "complete";
  if (status === "partial") return "partial";
  if (status === "cancelled") return "target-cancelled";
  return "full-year-needs-action";
}

function blockingSummaryRecoveryMessageKey(
  signals: readonly string[],
  isFullFiscalYear: boolean,
): DurableMessageKey | null {
  if (hasCleanupFailureSignal(signals)) {
    if (isFullFiscalYear && signals.includes("full-fiscal-year-zip-downloaded")) {
      return "full-year-downloaded-cleanup-blocked";
    }
    return hasConfirmedSinglePeriodZipDownloadEvidence(signals)
      ? "target-downloaded-cleanup-blocked"
      : "target-cleanup-blocked";
  }
  if (
    isFullFiscalYear &&
    signals.some((signal) => signal.startsWith("full-fiscal-year-zip-download-"))
  ) {
    return "full-year-zip-review";
  }
  return null;
}

function renderDurableMessage(key: DurableMessageKey, scope: FiledReturnsDownloadScope): string {
  const period =
    scope.period === FULL_FISCAL_YEAR_PERIOD ? "the saved fiscal-year run" : scope.period;
  const messages: Record<DurableMessageKey, string> = {
    complete: `Pack completed the local filed-return download for ${period}.`,
    "durable-status-rejected":
      "Pack rejected non-canonical recovery metadata and will not continue automatically.",
    "full-year-active": `The saved FY ${scope.financialYear} run is still active.`,
    "full-year-complete-download-unconfirmed":
      "Pack completed the saved fiscal-year run, but could not confirm a final ZIP download. Check browser Downloads before relying on a file.",
    "full-year-downloaded-cleanup-blocked":
      "Pack confirmed the final fiscal-year ZIP download; only retained local staging remains to be cleared.",
    "full-year-interrupted": `Pack stopped before it could confirm ${period}. Check Downloads before retrying.`,
    "full-year-needs-action": `Pack needs an explicit recovery action before continuing ${period}.`,
    "full-year-no-artifacts":
      "Pack completed the saved fiscal-year run. No ZIP was created because no filed-return artifacts were available for export.",
    "full-year-resume":
      "Pack cannot verify which GST account owns this saved run. Resume only with the same account open; otherwise discard it.",
    "full-year-zip-review":
      "Pack could not confirm the final fiscal-year ZIP. Check the exact browser download before retrying.",
    "not-filed": "The GST Portal reported no filed return for the selected period.",
    partial: `Pack retained verified artifact progress for ${period}; the selection is not complete.`,
    "target-cancelled": `Pack cancelled the unresolved filed-return target for ${period}.`,
    "target-blocked": `Pack paused the saved full-year run at ${period}. Resolve the GST Portal page before retrying this period.`,
    "target-blocked-or-session-expired": FILED_RETURNS_PORTAL_BLOCKED_OR_SESSION_EXPIRED_MESSAGE,
    "target-checkpoint-clear-cancel":
      "Pack could not confirm cancellation of the exact browser download, so it retained artifact recovery and did not retry.",
    "target-checkpoint-clear-checkpoint":
      "Pack found retained artifact recovery that is not safe to discard, so it did not clear or retry it.",
    "target-checkpoint-clear-danger":
      "The browser has not classified the retained download as safe, so Pack did not clear or retry its recovery state.",
    "target-checkpoint-clear-download":
      "Pack could not find the exact browser download owned by retained artifact recovery, so it did not clear or retry it.",
    "target-checkpoint-clear-size":
      "Pack could not verify a non-empty retained browser download, so it did not clear or retry its recovery state.",
    "target-checkpoint-clear-state":
      "Pack could not verify the retained browser download state, so it did not clear or retry its recovery state.",
    "target-checkpoint-clear-storage-read":
      "Pack could not read retained artifact recovery state, so it did not clear or retry it.",
    "target-checkpoint-clear-storage-remove":
      "Pack verified retained artifact recovery but could not remove it, so it will not start another portal action.",
    "target-checkpoint-clear-target":
      "The retained browser download no longer matches its exact artifact target, so Pack did not clear or retry it.",
    "target-artifact-progress-malformed-summary":
      "Pack found retained selected-file progress it could not validate, so it did not inspect or act on the GST Portal tab.",
    "target-artifact-progress-storage-read-failed":
      "Pack could not read retained selected-file progress, so it did not inspect or act on the GST Portal tab.",
    "target-artifact-progress-storage-write-failed":
      "Pack could not verify retained selected-file progress in session storage, so it did not inspect or act on the GST Portal tab.",
    "target-completion-pending-summary":
      "Pack proved this browser download and is safely finishing its local recovery record.",
    "target-cleanup-blocked":
      "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
    "target-downloaded": `Pack confirmed the filed-return download for ${period}.`,
    "target-downloaded-cleanup-blocked": `Pack confirmed the selected ZIP download for ${period}; only temporary local staging remains to be cleared.`,
    "target-failed": `Pack stopped while processing ${period}. Retry this period, or discard the saved run and start again.`,
    "target-manually-observed":
      "Pack recorded a manual observation, but the target still requires an explicit retry or cancellation.",
    "target-pending": "Not checked yet.",
    "target-restaging": `Pack needs to restage ${period} before rebuilding the fiscal-year ZIP.`,
    "target-retry-approved": `Pack will retry ${period} in the full fiscal-year run.`,
    "target-review": `Pack could not verify the browser download for ${period}. Check Downloads before retrying or cancelling this target.`,
    "target-running": `Checking ${period}.`,
    "target-scheduled-downtime": FILED_RETURNS_PORTAL_SCHEDULED_DOWNTIME_MESSAGE,
    "target-system-error": FILED_RETURNS_PORTAL_SYSTEM_ERROR_MESSAGE,
  };
  return messages[key];
}

function hasCleanupFailureSignal(signals: readonly string[]): boolean {
  return signals.some(
    (signal) =>
      signal.includes("opfs-clear-failed") ||
      signal.includes("cleanup-failed") ||
      signal.includes("cleanup-checkpoint-failed") ||
      signal.endsWith("cleanup-required"),
  );
}

function isContradictoryDownloadSignal(signal: string): boolean {
  return (
    CONTRADICTORY_DOWNLOAD_SIGNALS.has(signal) ||
    signal.startsWith("browser-download-error-") ||
    signal === "single-period-zip-download-unconfirmed" ||
    signal === "single-period-zip-incomplete"
  );
}

const CONTRADICTORY_DOWNLOAD_SIGNALS = new Set([
  "browser-download-correlation-rejected",
  "browser-download-danger-pending",
  "browser-download-danger-rejected",
  "browser-download-danger-unknown",
  "browser-download-existence-unknown",
  "browser-download-file-missing",
  "browser-download-in-progress",
  "browser-download-interrupted",
  "browser-download-not-observed",
  "browser-download-save-dialog-may-be-open",
  "browser-download-search-missing",
  "browser-download-search-unavailable",
  "browser-download-size-unknown",
  "browser-download-state-unconfirmed",
  "browser-download-zero-bytes",
]);

function parsePeriods(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > FILED_RETURNS_MONTHS.length) return null;
  if (!input.every((period) => FILED_RETURNS_MONTHS.includes(period as never))) return null;
  return new Set(input).size === input.length ? [...input] : null;
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}
