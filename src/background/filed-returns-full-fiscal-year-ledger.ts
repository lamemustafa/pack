import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../core/contracts";
import {
  normaliseFiledReturnsArtifactType,
  type FiledReturnsArtifactType,
} from "../core/filed-returns-artifacts";
import type { FiledReturnsMonth } from "../core/filed-returns-scope";
import type { FiledReturnsReturnType } from "../core/filed-returns-return-types";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import { durableFullFiscalYearArtifactSignals } from "./filed-returns-full-fiscal-year-artifacts";
export {
  isFullFiscalYearLedger,
  recoverableFullFiscalYearLedgerId,
} from "./filed-returns-full-fiscal-year-validation";

const ACTIVE_LEDGER_STALE_MS = 30_000;
const FULL_FISCAL_YEAR_PLAN_VERSION = "filed-returns-monthly-v2";
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
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  return {
    schemaVersion: "1.0",
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: PACK_PRODUCT_VERSION,
    ledgerId: createLedgerId(now),
    revision: 1,
    status: "running",
    scope: {
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
      artifactType,
      ...(scope.rangeEndPeriod ? { rangeEndPeriod: scope.rangeEndPeriod } : {}),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(eligibleThrough ? { eligibleThrough } : {}),
    lastReconciledAt: timestamp,
    targets: periods.map((period) => ({
      targetId: createTargetId(scope.financialYear, period, scope.returnType, artifactType),
      financialYear: scope.financialYear,
      period,
      returnType: scope.returnType,
      artifactType,
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
    revision: nextRevision(ledger),
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
  return ledger.targets.find((target) => target.status === "pending") ?? null;
}

export function canCompleteFullFiscalYearLedger(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return (
    ledger.targets.length > 0 &&
    ledger.targets.every((target) => POSITIVE_TARGET_STATUSES.has(target.status))
  );
}

export function hasActionRequiredFullFiscalYearTarget(
  ledger: FiledReturnsFullFiscalYearLedger,
): boolean {
  return ledger.targets.some(
    (target) => target.status !== "pending" && !POSITIVE_TARGET_STATUSES.has(target.status),
  );
}

export function markFullFiscalYearTargetRunning(
  ledger: FiledReturnsFullFiscalYearLedger,
  targetId: string,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const timestamp = now.toISOString();
  const runningLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: nextRevision(ledger),
    status: "running",
    currentTargetId: targetId,
    updatedAt: timestamp,
    targets: ledger.targets.map((target) =>
      target.targetId === targetId
        ? {
            ...target,
            status: "running",
            attempts: target.attempts + 1,
            safeSignals: [
              ...durableFullFiscalYearArtifactSignals(target.safeSignals),
              "full-fiscal-year-target-running",
            ],
            safeMessage: `Checking ${target.period}.`,
            startedAt: target.startedAt ?? timestamp,
            updatedAt: timestamp,
          }
        : target,
    ),
  };
  delete runningLedger.zipPhase;
  return runningLedger;
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
          ...(flowStep.downloadDiagnostic
            ? { downloadDiagnostic: flowStep.downloadDiagnostic }
            : {}),
          ...(POSITIVE_TARGET_STATUSES.has(status) ? { completedAt: timestamp } : {}),
          updatedAt: timestamp,
        }
      : target,
  );
  return {
    ...ledger,
    revision: nextRevision(ledger),
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
    revision: nextRevision(ledger),
    status: "complete",
    updatedAt: now.toISOString(),
    zipPhase: "cleaned",
  };
}

export function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.rangeEndPeriod === right.rangeEndPeriod &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
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

function nextRevision(ledger: Pick<FiledReturnsFullFiscalYearLedger, "revision">): number {
  return (ledger.revision ?? 1) + 1;
}

function ledgerStatus(
  targets: readonly FiledReturnsFullFiscalYearTarget[],
  lastStatus: FiledReturnsFullFiscalYearTargetStatus,
): FiledReturnsFullFiscalYearLedger["status"] {
  if (targets.every((target) => POSITIVE_TARGET_STATUSES.has(target.status))) return "complete";
  if (lastStatus === "cancelled") return "cancelled";
  if (lastStatus === "manually-observed") return "partial";
  if (POSITIVE_TARGET_STATUSES.has(lastStatus)) return "partial";
  return "blocked";
}

function createLedgerId(now: Date): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `full-fiscal-year-${now.getTime().toString(36)}`;
}

export function createFullFiscalYearTargetId(
  financialYear: string,
  period: string,
  returnType: FiledReturnsReturnType,
  artifactType?: FiledReturnsArtifactType,
): string {
  const normalisedArtifactType = normaliseFiledReturnsArtifactType(returnType, artifactType);
  const base = `${returnType}:${financialYear}:${period}`;
  return normalisedArtifactType === "PDF" ? base : `${base}:${normalisedArtifactType}`;
}

function createTargetId(
  financialYear: string,
  period: string,
  returnType: FiledReturnsReturnType,
  artifactType?: FiledReturnsArtifactType,
): string {
  return createFullFiscalYearTargetId(financialYear, period, returnType, artifactType);
}
