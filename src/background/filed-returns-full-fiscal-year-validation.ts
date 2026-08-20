import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
} from "../connectors/gst/filed-returns-contracts";
import {
  isFiledReturnsArtifactType,
  normaliseFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  isFiledReturnsReturnType,
  type FiledReturnsReturnType,
  supportsFullFiscalYearFiledReturnsRun,
} from "../connectors/gst/filed-returns-return-types";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
  GST_LAUNCH_FINANCIAL_YEAR,
  GST_LAUNCH_MONTH,
  type FiledReturnsMonth,
} from "../connectors/gst/filed-returns-scope";
import {
  isHistoricalDurableTargetMessage,
  parseDurableTargetStatus,
} from "../connectors/gst/filed-returns-durable-status";
import { isCanonicalFullFiscalYearLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import {
  hasPositiveFiledReturnsDownloadEvidence,
  isValidFiledReturnsDownloadDiagnosticState,
} from "./filed-returns-download-diagnostic-state";

export const FULL_FISCAL_YEAR_PLAN_VERSION = "filed-returns-monthly-v2";

export function canonicalFullFiscalYearPlanPeriods(
  financialYear: string,
  eligibleThrough: unknown,
): FiledReturnsMonth[] | null {
  if (!isFiledReturnsMonth(eligibleThrough)) return null;
  const availableMonths =
    financialYear === GST_LAUNCH_FINANCIAL_YEAR
      ? FILED_RETURNS_MONTHS.slice(FILED_RETURNS_MONTHS.indexOf(GST_LAUNCH_MONTH))
      : FILED_RETURNS_MONTHS;
  const eligibleIndex = availableMonths.indexOf(eligibleThrough);
  return eligibleIndex < 0 ? null : availableMonths.slice(0, eligibleIndex + 1);
}

export function hasCanonicalFullFiscalYearTargetPlan(
  ledger: Pick<
    FiledReturnsFullFiscalYearLedger,
    "eligibleThrough" | "planVersion" | "scope" | "targets"
  >,
): boolean {
  if (ledger.planVersion !== FULL_FISCAL_YEAR_PLAN_VERSION) return false;
  const periods = canonicalFullFiscalYearPlanPeriods(
    ledger.scope.financialYear,
    ledger.eligibleThrough,
  );
  return Boolean(periods && targetsMatchPeriods(ledger, periods));
}

export function hasLegacyCanonicalFullFiscalYearTargetPrefix(
  ledger: Pick<
    FiledReturnsFullFiscalYearLedger,
    "eligibleThrough" | "planVersion" | "scope" | "targets"
  >,
): boolean {
  if (ledger.planVersion !== undefined || ledger.eligibleThrough !== undefined) return false;
  const maximumPeriods = canonicalFullFiscalYearPlanPeriods(ledger.scope.financialYear, "March");
  return Boolean(
    maximumPeriods &&
    ledger.targets.length > 0 &&
    ledger.targets.length <= maximumPeriods.length &&
    targetsMatchPeriods(ledger, maximumPeriods.slice(0, ledger.targets.length)),
  );
}

export function isCanonicalFullFiscalYearPeriodPlan(
  financialYear: string,
  periods: readonly FiledReturnsMonth[],
): boolean {
  const eligibleThrough = periods.at(-1);
  const canonical = canonicalFullFiscalYearPlanPeriods(financialYear, eligibleThrough);
  return Boolean(
    canonical &&
    canonical.length === periods.length &&
    canonical.every((period, index) => period === periods[index]),
  );
}

function targetsMatchPeriods(
  ledger: Pick<FiledReturnsFullFiscalYearLedger, "scope" | "targets">,
  periods: readonly FiledReturnsMonth[],
): boolean {
  return (
    ledger.targets.length === periods.length &&
    ledger.targets.every((target, index) =>
      targetMatchesPlanPeriod(target, ledger.scope, periods[index]),
    )
  );
}

export function durableFullFiscalYearArtifactSignals(signals: readonly string[]): string[] {
  return signals.filter(
    (signal) =>
      /^filed-return-artifact-(?:downloaded|unavailable):(?:PDF|JSON|EXCEL)$/.test(signal) ||
      /^full-fiscal-year-opfs-staged:(?:PDF|JSON|EXCEL)$/.test(signal),
  );
}

function targetMatchesPlanPeriod(
  target: FiledReturnsFullFiscalYearTarget,
  scope: FiledReturnsFullFiscalYearLedger["scope"],
  period: FiledReturnsMonth | undefined,
): boolean {
  if (!period || target.period !== period) return false;
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  const targetId = createTargetId(scope.financialYear, period, scope.returnType, artifactType);
  return (
    target.targetId === targetId &&
    target.financialYear === scope.financialYear &&
    target.returnType === scope.returnType &&
    normaliseFiledReturnsArtifactType(target.returnType, target.artifactType) === artifactType
  );
}

const MAX_SAFE_MESSAGE_LENGTH = 500;
const VALID_LEDGER_STATUSES = new Set<FiledReturnsFullFiscalYearLedger["status"]>([
  "running",
  "complete",
  "partial",
  "blocked",
  "cancelled",
]);
const VALID_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "pending",
  "running",
  "downloaded",
  "manually-observed",
  "not-filed",
  "download-unconfirmed",
  "blocked",
  "failed",
  "cancelled",
]);
const VALID_ZIP_PHASES = new Set<NonNullable<FiledReturnsFullFiscalYearLedger["zipPhase"]>>([
  "export-pending",
  "export-retry-pending",
  "download-intent-persisted",
  "download-observing",
  "download-started",
  "restaging-required",
  "downloaded-cleanup-pending",
  "no-artifacts-cleanup-pending",
  "legacy-cleanup-pending",
  "cleaned",
]);
const ZIP_PHASES_REQUIRING_COMPLETED_TARGETS = new Set<
  NonNullable<FiledReturnsFullFiscalYearLedger["zipPhase"]>
>([
  "export-pending",
  "export-retry-pending",
  "download-intent-persisted",
  "download-observing",
  "download-started",
  "downloaded-cleanup-pending",
  "no-artifacts-cleanup-pending",
  "legacy-cleanup-pending",
  "cleaned",
]);
const COMPLETED_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "not-filed",
]);
const LEDGER_KEYS = [
  "connectorVersion",
  "createdAt",
  "createdWithExtensionVersion",
  "currentTargetId",
  "eligibleThrough",
  "lastReconciledAt",
  "ledgerId",
  "planVersion",
  "revision",
  "schemaVersion",
  "scope",
  "status",
  "targets",
  "updatedAt",
  "zipDownloadAttempt",
  "zipPhase",
] as const;
const TARGET_KEYS = [
  "artifactType",
  "attempts",
  "completedAt",
  "downloadDiagnostic",
  "downloadDiagnostics",
  "financialYear",
  "period",
  "returnType",
  "safeMessage",
  "safeSignals",
  "startedAt",
  "status",
  "targetId",
  "updatedAt",
] as const;
const SCOPE_KEYS = [
  "artifactType",
  "completedPeriods",
  "financialYear",
  "period",
  "returnType",
] as const;
export function isFullFiscalYearLedger(input: unknown): input is FiledReturnsFullFiscalYearLedger {
  if (!input || typeof input !== "object") return false;
  const ledger = input as Partial<FiledReturnsFullFiscalYearLedger> & Record<string, unknown>;
  if (!hasOnlyKeys(ledger, LEDGER_KEYS)) return false;
  if (ledger.schemaVersion !== "1.0") return false;
  if (!isCanonicalFullFiscalYearLedgerId(ledger.ledgerId)) return false;
  if (!isOptionalBoundedString(ledger.planVersion, 120)) return false;
  if (!isOptionalSemanticVersion(ledger.connectorVersion)) return false;
  if (!isOptionalSemanticVersion(ledger.createdWithExtensionVersion)) return false;
  if (
    ledger.revision !== undefined &&
    (typeof ledger.revision !== "number" ||
      !Number.isInteger(ledger.revision) ||
      ledger.revision < 1 ||
      ledger.revision > 10_000)
  ) {
    return false;
  }
  if (!ledger.status || !VALID_LEDGER_STATUSES.has(ledger.status)) return false;
  if (ledger.zipPhase !== undefined && !VALID_ZIP_PHASES.has(ledger.zipPhase)) {
    return false;
  }
  if (!isValidZipDownloadAttempt(ledger)) return false;
  if (ledger.zipPhase === "cleaned" && ledger.status !== "complete") return false;
  if (
    ledger.zipPhase !== undefined &&
    ledger.zipPhase !== "cleaned" &&
    ledger.status !== "blocked"
  ) {
    return false;
  }
  if (!isValidTimestamp(ledger.createdAt) || !isValidTimestamp(ledger.updatedAt)) return false;
  if (ledger.lastReconciledAt !== undefined && !isValidTimestamp(ledger.lastReconciledAt)) {
    return false;
  }
  if (!isFullFiscalYearScope(ledger.scope)) return false;
  if (ledger.currentTargetId !== undefined && !isBoundedString(ledger.currentTargetId, 1, 120)) {
    return false;
  }
  if (!Array.isArray(ledger.targets)) return false;

  const targetIds = new Set<string>();
  for (const target of ledger.targets) {
    if (!isFullFiscalYearTarget(target, ledger.scope)) return false;
    if (targetIds.has(target.targetId)) return false;
    targetIds.add(target.targetId);
  }

  if (ledger.currentTargetId !== undefined && !targetIds.has(ledger.currentTargetId)) return false;
  if (
    ledger.zipPhase &&
    ZIP_PHASES_REQUIRING_COMPLETED_TARGETS.has(ledger.zipPhase) &&
    (ledger.targets.length === 0 ||
      !ledger.targets.every((target) => COMPLETED_TARGET_STATUSES.has(target.status)))
  ) {
    return false;
  }
  const hasPlanVersion = ledger.planVersion !== undefined;
  const hasEligibleThrough = ledger.eligibleThrough !== undefined;
  if (hasPlanVersion !== hasEligibleThrough) return false;
  if (hasPlanVersion) {
    if (
      ledger.planVersion !== FULL_FISCAL_YEAR_PLAN_VERSION ||
      !hasCanonicalFullFiscalYearTargetPlan(ledger as FiledReturnsFullFiscalYearLedger)
    ) {
      return false;
    }
  } else if (
    ledger.status === "complete" ||
    ledger.zipPhase !== undefined ||
    ledger.zipDownloadAttempt !== undefined ||
    !hasLegacyCanonicalFullFiscalYearTargetPrefix(ledger as FiledReturnsFullFiscalYearLedger)
  ) {
    return false;
  }
  return true;
}

function isValidZipDownloadAttempt(ledger: Partial<FiledReturnsFullFiscalYearLedger>): boolean {
  const attempt = ledger.zipDownloadAttempt;
  if (attempt === undefined) {
    return !["download-intent-persisted", "download-observing"].includes(ledger.zipPhase ?? "");
  }
  if (
    !attempt ||
    typeof attempt !== "object" ||
    Object.keys(attempt).some((key) => !["requestedAt", "downloadId"].includes(key)) ||
    !isCanonicalTimestamp(attempt.requestedAt)
  ) {
    return false;
  }
  if (
    attempt.downloadId !== undefined &&
    (typeof attempt.downloadId !== "number" ||
      !Number.isSafeInteger(attempt.downloadId) ||
      attempt.downloadId < 0)
  ) {
    return false;
  }
  if (ledger.zipPhase === "download-intent-persisted") {
    return attempt.downloadId === undefined;
  }
  if (ledger.zipPhase === "download-observing") {
    return attempt.downloadId !== undefined;
  }
  return false;
}

function isCanonicalTimestamp(input: unknown): input is string {
  if (!isValidTimestamp(input) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) {
    return false;
  }
  return new Date(input).toISOString() === input;
}

export function recoverableFullFiscalYearLedgerId(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const ledgerId = (input as { ledgerId?: unknown }).ledgerId;
  return isCanonicalFullFiscalYearLedgerId(ledgerId) ? ledgerId : null;
}

function isFullFiscalYearScope(
  scope: Partial<FiledReturnsDownloadScope> | undefined,
): scope is FiledReturnsDownloadScope {
  if (!scope) return false;
  if (!hasOnlyKeys(scope as Record<string, unknown>, SCOPE_KEYS)) return false;
  const artifactType = scope.artifactType ?? "PDF";
  return (
    isConsecutiveFinancialYear(scope.financialYear) &&
    scope.period === FULL_FISCAL_YEAR_PERIOD &&
    isFiledReturnsReturnType(scope.returnType) &&
    supportsFullFiscalYearFiledReturnsRun(scope.returnType) &&
    isFiledReturnsArtifactType(artifactType) &&
    supportsFiledReturnsArtifactType(scope.returnType, artifactType) &&
    (scope.completedPeriods === undefined ||
      (Array.isArray(scope.completedPeriods) &&
        scope.completedPeriods.every((period) => isFiledReturnsMonth(period)) &&
        new Set(scope.completedPeriods).size === scope.completedPeriods.length))
  );
}

function isFullFiscalYearTarget(
  target: Partial<FiledReturnsFullFiscalYearTarget>,
  scope: FiledReturnsDownloadScope,
): target is FiledReturnsFullFiscalYearTarget {
  if (!hasOnlyKeys(target as Record<string, unknown>, TARGET_KEYS)) return false;
  if (!isBoundedString(target.targetId, 1, 120)) return false;
  if (target.financialYear !== scope.financialYear) return false;
  if (!isFiledReturnsMonth(target.period)) return false;
  if (target.returnType !== scope.returnType) return false;
  const artifactType = normaliseFiledReturnsArtifactType(target.returnType, target.artifactType);
  const ledgerArtifactType = normaliseFiledReturnsArtifactType(
    scope.returnType,
    scope.artifactType,
  );
  if (artifactType !== ledgerArtifactType) return false;
  if (target.artifactType !== undefined && target.artifactType !== artifactType) return false;
  if (
    target.targetId !==
    createTargetId(scope.financialYear, target.period, target.returnType, artifactType)
  ) {
    return false;
  }
  if (!target.status || !VALID_TARGET_STATUSES.has(target.status)) return false;
  const attempts = target.attempts;
  if (
    typeof attempts !== "number" ||
    !Number.isInteger(attempts) ||
    attempts < 0 ||
    attempts > 100
  ) {
    return false;
  }
  if (!isBoundedString(target.safeMessage, 1, MAX_SAFE_MESSAGE_LENGTH)) return false;
  const durableStatus = parseDurableTargetStatus(
    {
      artifactType,
      financialYear: target.financialYear,
      period: target.period,
      returnType: target.returnType,
    },
    target.status,
    target.safeSignals,
  );
  if (!durableStatus) return false;
  if (
    target.safeMessage !== durableStatus.safeMessage &&
    !isHistoricalDurableTargetMessage(
      {
        artifactType,
        financialYear: target.financialYear,
        period: target.period,
        returnType: target.returnType,
      },
      target.status,
      durableStatus.safeSignals,
      target.safeMessage,
    )
  ) {
    return false;
  }
  if (!isValidTimestamp(target.updatedAt)) return false;
  if (target.startedAt !== undefined && !isValidTimestamp(target.startedAt)) return false;
  if (target.completedAt !== undefined && !isValidTimestamp(target.completedAt)) return false;
  if (
    !isValidFiledReturnsDownloadDiagnosticState(target, {
      artifactType: target.artifactType,
      financialYear: target.financialYear,
      period: target.period,
      returnType: target.returnType,
    })
  ) {
    return false;
  }
  if (
    target.status === "downloaded" &&
    !hasPositiveFiledReturnsDownloadEvidence(
      target,
      {
        artifactType: target.artifactType,
        financialYear: target.financialYear,
        period: target.period,
        returnType: target.returnType,
      },
      target.safeSignals ?? [],
      "full-fiscal-year",
    )
  ) {
    return false;
  }
  if (
    target.status === "not-filed" &&
    !target.safeSignals?.includes("filed-return-positively-not-filed")
  ) {
    return false;
  }
  return true;
}

function isFiledReturnsMonth(input: unknown): input is FiledReturnsMonth {
  return typeof input === "string" && FILED_RETURNS_MONTHS.includes(input as FiledReturnsMonth);
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}

function isOptionalBoundedString(input: unknown, maxLength: number): boolean {
  return input === undefined || isBoundedString(input, 1, maxLength);
}

function isOptionalSemanticVersion(input: unknown): boolean {
  return (
    input === undefined ||
    (typeof input === "string" &&
      input.length <= 120 &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(input))
  );
}

function isConsecutiveFinancialYear(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const match = /^20(\d{2})-(\d{2})$/.exec(input);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === (start + 1) % 100;
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function isValidTimestamp(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 40) return false;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === input;
}

function createTargetId(
  financialYear: string,
  period: string,
  returnType: FiledReturnsReturnType,
  artifactType: string,
): string {
  const base = `${returnType}:${financialYear}:${period}`;
  return artifactType === "PDF" ? base : `${base}:${artifactType}`;
}
