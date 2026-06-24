import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
} from "../core/contracts";
import {
  FILED_RETURNS_MONTHS,
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../core/filed-returns-scope";

const MAX_SAFE_MESSAGE_LENGTH = 500;
const MAX_SAFE_SIGNAL_LENGTH = 160;
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
  "not-filed",
  "download-unconfirmed",
  "blocked",
  "failed",
  "cancelled",
]);

export function isFullFiscalYearLedger(input: unknown): input is FiledReturnsFullFiscalYearLedger {
  if (!input || typeof input !== "object") return false;
  const ledger = input as Partial<FiledReturnsFullFiscalYearLedger>;
  if (ledger.schemaVersion !== "1.0") return false;
  if (!isBoundedString(ledger.ledgerId, 1, 120)) return false;
  if (!ledger.status || !VALID_LEDGER_STATUSES.has(ledger.status)) return false;
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
    if (!isFullFiscalYearTarget(target, ledger.scope.financialYear)) return false;
    if (targetIds.has(target.targetId)) return false;
    targetIds.add(target.targetId);
  }

  if (ledger.currentTargetId !== undefined && !targetIds.has(ledger.currentTargetId)) return false;
  return true;
}

function isFullFiscalYearScope(
  scope: Partial<FiledReturnsDownloadScope> | undefined,
): scope is FiledReturnsDownloadScope {
  return (
    Boolean(scope) &&
    typeof scope?.financialYear === "string" &&
    /^20\d{2}-\d{2}$/.test(scope.financialYear) &&
    scope.period === FULL_FISCAL_YEAR_PERIOD &&
    scope.returnType === "GSTR-3B"
  );
}

function isFullFiscalYearTarget(
  target: Partial<FiledReturnsFullFiscalYearTarget>,
  financialYear: string,
): target is FiledReturnsFullFiscalYearTarget {
  if (!isBoundedString(target.targetId, 1, 120)) return false;
  if (target.financialYear !== financialYear) return false;
  if (!isFiledReturnsMonth(target.period)) return false;
  if (target.targetId !== createTargetId(financialYear, target.period)) return false;
  if (target.returnType !== "GSTR-3B") return false;
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
  if (
    !Array.isArray(target.safeSignals) ||
    !target.safeSignals.every((signal) => isBoundedString(signal, 1, MAX_SAFE_SIGNAL_LENGTH))
  ) {
    return false;
  }
  if (!isBoundedString(target.safeMessage, 1, MAX_SAFE_MESSAGE_LENGTH)) return false;
  if (!isValidTimestamp(target.updatedAt)) return false;
  if (target.startedAt !== undefined && !isValidTimestamp(target.startedAt)) return false;
  if (target.completedAt !== undefined && !isValidTimestamp(target.completedAt)) return false;
  return true;
}

function isFiledReturnsMonth(input: unknown): input is FiledReturnsMonth {
  return typeof input === "string" && FILED_RETURNS_MONTHS.includes(input as FiledReturnsMonth);
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}

function isValidTimestamp(input: unknown): input is string {
  return typeof input === "string" && input.length <= 40 && Number.isFinite(Date.parse(input));
}

function createTargetId(financialYear: string, period: string): string {
  return `GSTR-3B:${financialYear}:${period}`;
}
