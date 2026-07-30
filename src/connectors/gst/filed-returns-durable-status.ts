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
import { isFiledReturnsReturnType } from "./filed-returns-return-types";
import { FILED_RETURNS_MONTHS, FULL_FISCAL_YEAR_PERIOD } from "./filed-returns-scope";
import { parseDurableFiledReturnsSignals } from "./filed-returns-durable-signals";

type DurableMessageKey =
  | "complete"
  | "durable-status-rejected"
  | "full-year-active"
  | "full-year-downloaded-cleanup-blocked"
  | "full-year-interrupted"
  | "full-year-needs-action"
  | "full-year-resume"
  | "full-year-zip-review"
  | "not-filed"
  | "partial"
  | "target-cancelled"
  | "target-cleanup-blocked"
  | "target-downloaded"
  | "target-downloaded-cleanup-blocked"
  | "target-manually-observed"
  | "target-pending"
  | "target-restaging"
  | "target-retry-approved"
  | "target-review"
  | "target-running";

export function canonicalDurableTargetStatus(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFullFiscalYearTargetStatus | "target-review",
  inputSignals: unknown,
): { safeMessage: string; safeSignals: string[] } {
  const safeSignals = parseDurableFiledReturnsSignals(inputSignals);
  if (!safeSignals) {
    return {
      safeSignals: ["filed-return-durable-status-rejected"],
      safeMessage: renderDurableMessage("durable-status-rejected", scope),
    };
  }
  return {
    safeSignals,
    safeMessage: renderDurableMessage(messageKeyForTarget(status, safeSignals), scope),
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
    safeMessage: renderDurableMessage(messageKeyForTarget(status, safeSignals), scope),
  };
}

export function canonicalDurableSummaryMessage(
  scope: FiledReturnsDownloadScope,
  status: FiledReturnsFlowSummary["status"],
  signals: readonly string[],
): string {
  const mismatchedGstr1Period = visibleGstr1MismatchPeriod(scope, status, signals);
  if (mismatchedGstr1Period) {
    return incompleteGstr1PeriodMismatchRecoveryMessage(scope, mismatchedGstr1Period);
  }
  if (status === "partial") {
    const missingArtifacts = signals
      .map((signal) => /^filed-return-artifact-unavailable:(PDF|JSON|EXCEL)$/.exec(signal)?.[1])
      .filter((artifactType): artifactType is string => Boolean(artifactType));
    const missingReasons = signals.filter((signal) => /^artifact-[a-z0-9-]+$/.test(signal));
    if (missingArtifacts.length > 0 && missingArtifacts.length === missingReasons.length) {
      return `Pack prepared a partial ZIP; missing ${missingArtifacts
        .map((artifactType, index) => `${artifactType} (${missingReasons[index]})`)
        .join(", ")}.`;
    }
  }
  return renderDurableMessage(messageKeyForSummary(status, signals), scope);
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
  if (!isConsecutiveFinancialYear(scope.financialYear)) return null;
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
  return "target-review";
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

function messageKeyForSummary(
  status: FiledReturnsFlowSummary["status"],
  signals: readonly string[],
): DurableMessageKey {
  if (signals.includes("filed-return-durable-status-rejected")) return "durable-status-rejected";
  if (signals.includes("full-fiscal-year-resume-confirmation-required")) return "full-year-resume";
  if (signals.includes("full-fiscal-year-run-interrupted")) return "full-year-interrupted";
  if (signals.includes("full-fiscal-year-run-needs-action")) return "full-year-needs-action";
  if (signals.includes("full-fiscal-year-run-active")) return "full-year-active";
  if (hasCleanupFailureSignal(signals)) {
    if (signals.includes("full-fiscal-year-zip-downloaded")) {
      return "full-year-downloaded-cleanup-blocked";
    }
    return hasConfirmedSinglePeriodZipDownloadEvidence(signals)
      ? "target-downloaded-cleanup-blocked"
      : "target-cleanup-blocked";
  }
  if (signals.some((signal) => signal.includes("full-fiscal-year-zip-download"))) {
    return "full-year-zip-review";
  }
  if (signals.includes("filed-return-positively-not-filed")) return "not-filed";
  if (signals.includes("filed-returns-target-review-required")) return "target-review";
  if (status === "complete") return "complete";
  if (status === "partial") return "partial";
  if (status === "cancelled") return "target-cancelled";
  return "full-year-needs-action";
}

function renderDurableMessage(key: DurableMessageKey, scope: FiledReturnsDownloadScope): string {
  const period =
    scope.period === FULL_FISCAL_YEAR_PERIOD ? "the saved fiscal-year run" : scope.period;
  const messages: Record<DurableMessageKey, string> = {
    complete: `Pack completed the local filed-return download for ${period}.`,
    "durable-status-rejected":
      "Pack rejected non-canonical recovery metadata and will not continue automatically.",
    "full-year-active": `The saved FY ${scope.financialYear} run is still active.`,
    "full-year-downloaded-cleanup-blocked":
      "Pack confirmed the final fiscal-year ZIP download; only retained local staging remains to be cleared.",
    "full-year-interrupted": `Pack stopped before it could confirm ${period}. Check Downloads before retrying.`,
    "full-year-needs-action": `Pack needs an explicit recovery action before continuing ${period}.`,
    "full-year-resume":
      "Pack cannot verify which GST account owns this saved run. Resume only with the same account open; otherwise discard it.",
    "full-year-zip-review":
      "Pack could not confirm the final fiscal-year ZIP. Check the exact browser download before retrying.",
    "not-filed": "The GST Portal reported no filed return for the selected period.",
    partial: `Pack retained verified artifact progress for ${period}; the selection is not complete.`,
    "target-cancelled": `Pack cancelled the unresolved filed-return target for ${period}.`,
    "target-cleanup-blocked":
      "Pack cannot complete this review while temporary selected-file staging remains uncleared.",
    "target-downloaded": `Pack confirmed the filed-return download for ${period}.`,
    "target-downloaded-cleanup-blocked": `Pack confirmed the selected ZIP download for ${period}; only temporary local staging remains to be cleared.`,
    "target-manually-observed":
      "Pack recorded a manual observation, but the target still requires an explicit retry or cancellation.",
    "target-pending": "Not checked yet.",
    "target-restaging": `Pack needs to restage ${period} before rebuilding the fiscal-year ZIP.`,
    "target-retry-approved": `Pack will retry ${period} in the full fiscal-year run.`,
    "target-review": `Pack could not verify the browser download for ${period}. Check Downloads before retrying or cancelling this target.`,
    "target-running": `Checking ${period}.`,
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

function isConsecutiveFinancialYear(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const match = /^20(\d{2})-(\d{2})$/.exec(input);
  return Boolean(match && Number(match[2]) === (Number(match[1]) + 1) % 100);
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}
