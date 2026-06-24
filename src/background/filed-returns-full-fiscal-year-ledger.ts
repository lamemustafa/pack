import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../core/contracts";
import { FULL_FISCAL_YEAR_PERIOD, type FiledReturnsMonth } from "../core/filed-returns-scope";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
export { isFullFiscalYearLedger } from "./filed-returns-full-fiscal-year-validation";

const ACTIVE_LEDGER_STALE_MS = 30_000;
const FULL_FISCAL_YEAR_PLAN_VERSION = "filed-gstr3b-monthly-v1";
const CREATED_WITH_EXTENSION_VERSION = "0.1.0";
const POSITIVE_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "not-filed",
]);

export function createFullFiscalYearLedger(
  scope: FiledReturnsDownloadScope,
  now: Date,
  periods: readonly FiledReturnsMonth[],
): FiledReturnsFullFiscalYearLedger {
  const timestamp = now.toISOString();
  const eligibleThrough = periods.at(-1);
  return {
    schemaVersion: "1.0",
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: CREATED_WITH_EXTENSION_VERSION,
    ledgerId: createLedgerId(now),
    status: "running",
    scope: {
      financialYear: scope.financialYear,
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(eligibleThrough ? { eligibleThrough } : {}),
    lastReconciledAt: timestamp,
    targets: periods.map((period) => ({
      targetId: createTargetId(scope.financialYear, period),
      financialYear: scope.financialYear,
      period,
      returnType: "GSTR-3B",
      status: "pending",
      attempts: 0,
      safeSignals: [],
      safeMessage: "Not checked yet.",
      updatedAt: timestamp,
    })),
  };
}

export function reconcileFullFiscalYearLedgerTargets(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  periods: readonly FiledReturnsMonth[],
): FiledReturnsFullFiscalYearLedger {
  const timestamp = now.toISOString();
  const eligibleThrough = periods.at(-1);
  const existingTargetIds = new Set(ledger.targets.map((target) => target.targetId));
  const missingTargets = periods
    .map((period) => ({
      targetId: createTargetId(ledger.scope.financialYear, period),
      financialYear: ledger.scope.financialYear,
      period,
      returnType: "GSTR-3B" as const,
      status: "pending" as const,
      attempts: 0,
      safeSignals: [],
      safeMessage: "Not checked yet.",
      updatedAt: timestamp,
    }))
    .filter((target) => !existingTargetIds.has(target.targetId));
  const targets = [...ledger.targets, ...missingTargets];

  return {
    ...ledger,
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion:
      ledger.createdWithExtensionVersion ?? CREATED_WITH_EXTENSION_VERSION,
    status: ledger.status === "complete" && missingTargets.length > 0 ? "running" : ledger.status,
    updatedAt:
      missingTargets.length > 0 && ledger.status !== "running" ? timestamp : ledger.updatedAt,
    ...(eligibleThrough ? { eligibleThrough } : {}),
    lastReconciledAt: timestamp,
    targets,
  };
}

export function resumeFullFiscalYearLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const ledgerWithoutCurrentTarget = withoutCurrentTarget(ledger);
  return {
    ...ledgerWithoutCurrentTarget,
    status: "running",
    updatedAt: now.toISOString(),
    targets: ledger.targets.map((target) =>
      target.status === "running" ? { ...target, status: "pending" } : target,
    ),
  };
}

export function nextRunnableFullFiscalYearTarget(
  ledger: FiledReturnsFullFiscalYearLedger,
): FiledReturnsFullFiscalYearTarget | null {
  if (ledger.targets.some((target) => target.status === "download-unconfirmed")) return null;
  return ledger.targets.find((target) => !POSITIVE_TARGET_STATUSES.has(target.status)) ?? null;
}

export function markFullFiscalYearTargetRunning(
  ledger: FiledReturnsFullFiscalYearLedger,
  targetId: string,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const timestamp = now.toISOString();
  return {
    ...ledger,
    status: "running",
    currentTargetId: targetId,
    updatedAt: timestamp,
    targets: ledger.targets.map((target) =>
      target.targetId === targetId
        ? {
            ...target,
            status: "running",
            attempts: target.attempts + 1,
            safeSignals: ["full-fiscal-year-target-running"],
            safeMessage: `Checking ${target.period}.`,
            startedAt: target.startedAt ?? timestamp,
            updatedAt: timestamp,
          }
        : target,
    ),
  };
}

export function markFullFiscalYearTargetTerminal(
  ledger: FiledReturnsFullFiscalYearLedger,
  targetId: string,
  status: FiledReturnsFullFiscalYearTargetStatus,
  flowStep: PortalFlowStepResult,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const timestamp = now.toISOString();
  const nextTargets = ledger.targets.map((target) =>
    target.targetId === targetId
      ? {
          ...target,
          status,
          safeSignals: flowStep.safeSignals,
          safeMessage: flowStep.safeMessage,
          ...(POSITIVE_TARGET_STATUSES.has(status) ? { completedAt: timestamp } : {}),
          updatedAt: timestamp,
        }
      : target,
  );
  return {
    ...ledger,
    status: ledgerStatus(nextTargets, status),
    currentTargetId: targetId,
    updatedAt: timestamp,
    targets: nextTargets,
  };
}

export function completeFullFiscalYearLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const ledgerWithoutCurrentTarget = withoutCurrentTarget(ledger);
  return {
    ...ledgerWithoutCurrentTarget,
    status: "complete",
    updatedAt: now.toISOString(),
  };
}

export function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType
  );
}

export function isFullFiscalYearLedgerStale(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): boolean {
  const updatedAt = Date.parse(ledger.updatedAt);
  return Number.isFinite(updatedAt) && now.getTime() - updatedAt > ACTIVE_LEDGER_STALE_MS;
}

function withoutCurrentTarget(
  ledger: FiledReturnsFullFiscalYearLedger,
): FiledReturnsFullFiscalYearLedger {
  const copy = { ...ledger };
  delete copy.currentTargetId;
  return copy;
}

function ledgerStatus(
  targets: readonly FiledReturnsFullFiscalYearTarget[],
  lastStatus: FiledReturnsFullFiscalYearTargetStatus,
): FiledReturnsFullFiscalYearLedger["status"] {
  if (targets.every((target) => POSITIVE_TARGET_STATUSES.has(target.status))) return "complete";
  if (lastStatus === "cancelled") return "cancelled";
  if (POSITIVE_TARGET_STATUSES.has(lastStatus)) return "partial";
  return "blocked";
}

function createLedgerId(now: Date): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `full-fiscal-year-${now.getTime().toString(36)}`;
}

function createTargetId(financialYear: string, period: string): string {
  return `GSTR-3B:${financialYear}:${period}`;
}
