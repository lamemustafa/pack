import type {
  FiledReturnsAllSupportedFullFiscalYearIdentity,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsAllSupportedFullFiscalYearPlanTarget } from "../connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { createFiledReturnsLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import type { FiledReturnsMonth } from "../connectors/gst/filed-returns-scope";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import { canonicalDurableTargetStatus } from "../connectors/gst/filed-returns-durable-status";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import { mergeFiledReturnsDownloadDiagnosticState } from "./filed-returns-download-diagnostic-state";
import { isCanonicalFullFiscalYearPeriodPlan } from "./filed-returns-full-fiscal-year-validation";
import {
  ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_VERSION,
  createAllSupportedFullFiscalYearTargetId,
  isAllSupportedFullFiscalYearLedger,
  type FiledReturnsAllSupportedFullFiscalYearLedger,
  type FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget,
  type FiledReturnsAllSupportedFullFiscalYearTarget,
} from "./filed-returns-all-supported-full-fiscal-year-validation";

const POSITIVE_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "not-filed",
]);

export function createAllSupportedFullFiscalYearLedger(
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity,
  returnPlan: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
  periods: readonly FiledReturnsMonth[],
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  if (!isCanonicalFullFiscalYearPeriodPlan(planRoot.financialYear, periods)) {
    throw new Error("Invalid all-supported full-year period plan.");
  }
  const targetPlan = createAllSupportedFullFiscalYearTargetPlan(planRoot, returnPlan, periods);
  if (targetPlan.length === 0) {
    throw new Error("An all-supported full-year plan needs at least one target.");
  }
  const timestamp = now.toISOString();
  const eligibleThrough = periods.at(-1);
  if (!eligibleThrough)
    throw new Error("An all-supported full-year plan needs an eligible period.");
  const ledger: FiledReturnsAllSupportedFullFiscalYearLedger = {
    schemaVersion: "1.0",
    planVersion: ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_VERSION,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: PACK_PRODUCT_VERSION,
    ledgerId: createFiledReturnsLedgerId("full-fiscal-year", now),
    revision: 1,
    status: "running",
    planRoot: { ...planRoot },
    createdAt: timestamp,
    updatedAt: timestamp,
    eligibleThrough,
    lastReconciledAt: timestamp,
    targetPlan,
    targets: targetPlan.map((target) => {
      const scope = targetScope(target);
      return {
        ...target,
        status: "pending",
        attempts: 0,
        ...canonicalDurableTargetStatus(scope, "pending", []),
        updatedAt: timestamp,
      };
    }),
  };
  if (!isAllSupportedFullFiscalYearLedger(ledger)) {
    throw new Error("Invalid all-supported full-year ledger snapshot.");
  }
  return ledger;
}

export function createAllSupportedFullFiscalYearTargetPlan(
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity,
  returnPlan: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
  periods: readonly FiledReturnsMonth[],
): FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget[] {
  if (returnPlan.length === 0 || periods.length === 0) return [];
  const targetIds = new Set<string>();
  const returnTypes = new Set<string>();
  const targetPlan: FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget[] = [];
  for (const returnTarget of returnPlan) {
    if (returnTypes.has(returnTarget.returnType)) {
      throw new Error("An all-supported full-year plan cannot repeat a return type.");
    }
    returnTypes.add(returnTarget.returnType);
    for (const period of periods) {
      const targetId = createAllSupportedFullFiscalYearTargetId(
        planRoot.financialYear,
        period,
        returnTarget.returnType,
        returnTarget.artifactType,
      );
      if (targetIds.has(targetId)) {
        throw new Error("An all-supported full-year plan cannot repeat a target.");
      }
      targetIds.add(targetId);
      targetPlan.push({
        targetId,
        financialYear: planRoot.financialYear,
        period,
        returnType: returnTarget.returnType,
        artifactType: returnTarget.artifactType,
        concreteArtifactTypes: [...returnTarget.concreteArtifactTypes],
      });
    }
  }
  return targetPlan;
}

export function canCompleteAllSupportedFullFiscalYearLedger(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): boolean {
  return (
    ledger.targets.length > 0 &&
    ledger.targets.every((target) => POSITIVE_TARGET_STATUSES.has(target.status))
  );
}

export function nextRunnableAllSupportedFullFiscalYearTarget(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): FiledReturnsAllSupportedFullFiscalYearTarget | null {
  if (ledger.targets.some((target) => target.status === "download-unconfirmed")) return null;
  return ledger.targets.find((target) => target.status === "pending") ?? null;
}

export function markAllSupportedFullFiscalYearTargetRunning(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  targetId: string,
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  if (!ledger.targets.some((target) => target.targetId === targetId)) return ledger;
  const timestamp = now.toISOString();
  const running: FiledReturnsAllSupportedFullFiscalYearLedger = {
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
            ...canonicalDurableTargetStatus(targetScope(target), "running", [
              ...target.safeSignals,
              "full-fiscal-year-target-running",
            ]),
            startedAt: target.startedAt ?? timestamp,
            updatedAt: timestamp,
          }
        : target,
    ),
  };
  delete running.zipPhase;
  delete running.zipDownloadAttempt;
  return running;
}

export function markAllSupportedFullFiscalYearTargetTerminal(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  targetId: string,
  status: FiledReturnsFullFiscalYearTargetStatus,
  flowStep: PortalFlowStepResult,
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  const timestamp = now.toISOString();
  const current = ledger.targets.find((target) => target.targetId === targetId);
  if (!current) return ledger;
  const scope = targetScope(current);
  const diagnosticState = mergeFiledReturnsDownloadDiagnosticState(current, flowStep, scope);
  const inputSignals = diagnosticState
    ? flowStep.safeSignals
    : [...flowStep.safeSignals, "filed-return-download-diagnostics-rejected"];
  const durableStatus = canonicalDurableTargetStatus(scope, status, inputSignals);
  const effectiveStatus = durableStatus.safeSignals.includes("filed-return-durable-status-rejected")
    ? "blocked"
    : status;
  const targets = ledger.targets.map((target) =>
    target.targetId === targetId
      ? {
          ...target,
          status: effectiveStatus,
          ...canonicalDurableTargetStatus(targetScope(target), effectiveStatus, inputSignals),
          ...(diagnosticState ?? {}),
          ...(POSITIVE_TARGET_STATUSES.has(effectiveStatus) ? { completedAt: timestamp } : {}),
          updatedAt: timestamp,
        }
      : target,
  );
  return {
    ...ledger,
    revision: nextRevision(ledger),
    status: ledgerStatus(targets, effectiveStatus),
    currentTargetId: targetId,
    updatedAt: timestamp,
    targets,
  };
}

export function resumeAllSupportedFullFiscalYearLedger(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  const resumed = {
    ...ledger,
    revision: nextRevision(ledger),
    status: "running" as const,
    updatedAt: now.toISOString(),
    targets: ledger.targets.map((target) =>
      target.status === "running"
        ? {
            ...target,
            status: "pending" as const,
            ...canonicalDurableTargetStatus(targetScope(target), "pending", []),
          }
        : target,
    ),
  };
  delete resumed.currentTargetId;
  return resumed;
}

export function isAllSupportedFullFiscalYearLedgerStale(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  now: Date,
): boolean {
  const updatedAt = Date.parse(ledger.updatedAt);
  return Number.isFinite(updatedAt) && now.getTime() - updatedAt > 30_000;
}

function targetScope(
  target: Pick<
    FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget,
    "artifactType" | "financialYear" | "period" | "returnType"
  >,
) {
  return {
    financialYear: target.financialYear,
    period: target.period,
    returnType: target.returnType,
    artifactType: target.artifactType,
  };
}

function nextRevision(
  ledger: Pick<FiledReturnsAllSupportedFullFiscalYearLedger, "revision">,
): number {
  return ledger.revision + 1;
}

function ledgerStatus(
  targets: readonly FiledReturnsAllSupportedFullFiscalYearTarget[],
  lastStatus: FiledReturnsFullFiscalYearTargetStatus,
): FiledReturnsAllSupportedFullFiscalYearLedger["status"] {
  if (targets.every((target) => POSITIVE_TARGET_STATUSES.has(target.status))) return "complete";
  if (lastStatus === "cancelled") return "cancelled";
  if (lastStatus === "manually-observed" || POSITIVE_TARGET_STATUSES.has(lastStatus))
    return "partial";
  return "blocked";
}
