import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../core/contracts";
import { FULL_FISCAL_YEAR_PERIOD, type FiledReturnsMonth } from "../core/filed-returns-scope";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const ACTIVE_LEDGER_STALE_MS = 30_000;
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
  return {
    schemaVersion: "1.0",
    ledgerId: createLedgerId(now),
    status: "running",
    scope: {
      financialYear: scope.financialYear,
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
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

export function targetStatusFromFlowStep(
  step: PortalFlowStepResult,
): FiledReturnsFullFiscalYearTargetStatus {
  if (step.state === "downloaded") return "downloaded";
  if (step.state === "download-unconfirmed") return "download-unconfirmed";
  if (
    step.safeSignals.some((signal) =>
      [
        "browser-download-size-unknown",
        "browser-download-not-observed",
        "filed-gstr3b-download-trigger-ambiguous",
      ].includes(signal),
    )
  ) {
    return "download-unconfirmed";
  }
  if (step.state === "candidate-not-found") return "blocked";
  if (
    step.state === "blocked" ||
    step.state === "login-required" ||
    step.state === "unsupported-page" ||
    step.state === "user-action-required"
  ) {
    return "blocked";
  }
  return "failed";
}

export function summariseFullFiscalYearLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
): FiledReturnsFlowSummary {
  if (ledger.status === "complete") {
    return toFullFiscalYearSummary(ledger, completeFullFiscalYearStep(ledger));
  }
  if (ledger.status === "running") {
    return toFullFiscalYearSummary(ledger, activeFullFiscalYearStep(ledger));
  }
  return toFullFiscalYearSummary(
    ledger,
    blockedFullFiscalYearStep("full-fiscal-year-run-needs-action", ledger),
  );
}

export function toFullFiscalYearSummary(
  ledger: FiledReturnsFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): FiledReturnsFlowSummary {
  const completedPeriods = ledger.targets
    .filter((target) => target.status === "downloaded")
    .map((target) => target.period);
  const currentTarget = ledger.targets.find((target) => target.targetId === ledger.currentTargetId);
  return {
    scope: ledger.scope,
    status: ledger.status,
    completedPeriods,
    totalPeriods: ledger.targets.length,
    updatedAt: ledger.updatedAt,
    ...(ledger.status === "complete" ? { completedAt: ledger.updatedAt } : {}),
    ...(currentTarget ? { currentPeriod: currentTarget.period } : {}),
    flowStep,
  };
}

export function completeFullFiscalYearStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "downloaded",
    safeSignals: ["full-fiscal-year-complete"],
    safeMessage: `Pack completed the local full fiscal year run for FY ${ledger.scope.financialYear}.`,
  };
}

export function activeFullFiscalYearStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-active"],
    safeMessage: `A full fiscal year run for FY ${ledger.scope.financialYear} is already active.`,
  };
}

export function blockedFullFiscalYearStep(
  signal: string,
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "blocked",
    safeSignals: [signal],
    safeMessage: `Pack could not start a full fiscal year run for FY ${ledger.scope.financialYear}.`,
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

export function isFullFiscalYearLedger(input: unknown): input is FiledReturnsFullFiscalYearLedger {
  if (!input || typeof input !== "object") return false;
  const ledger = input as Partial<FiledReturnsFullFiscalYearLedger>;
  return (
    ledger.schemaVersion === "1.0" &&
    typeof ledger.ledgerId === "string" &&
    typeof ledger.updatedAt === "string" &&
    Boolean(ledger.scope) &&
    Array.isArray(ledger.targets)
  );
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
