import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  normaliseFiledReturnsArtifactType,
  type FiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../connectors/gst/filed-returns-scope";
import type { FiledReturnsReturnType } from "../connectors/gst/filed-returns-return-types";
import { createFiledReturnsLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import { canonicalDurableTargetStatus } from "../connectors/gst/filed-returns-durable-status";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import { durableFullFiscalYearArtifactSignals } from "./filed-returns-full-fiscal-year-validation";
import { mergeFiledReturnsDownloadDiagnosticState } from "./filed-returns-download-diagnostic-state";
import {
  FULL_FISCAL_YEAR_PLAN_VERSION,
  canonicalFullFiscalYearPlanPeriods,
  hasCanonicalFullFiscalYearTargetPlan,
  hasLegacyCanonicalFullFiscalYearTargetPrefix,
  isCanonicalFullFiscalYearPeriodPlan,
} from "./filed-returns-full-fiscal-year-validation";
export {
  hasCanonicalFullFiscalYearTargetPlan,
  isFullFiscalYearLedger,
  recoverableFullFiscalYearLedgerId,
} from "./filed-returns-full-fiscal-year-validation";

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
  if (!isCanonicalFullFiscalYearPeriodPlan(scope.financialYear, periods)) {
    throw new Error("Invalid full-fiscal-year target plan.");
  }
  const timestamp = now.toISOString();
  const eligibleThrough = periods.at(-1);
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  return {
    schemaVersion: "1.0",
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: PACK_PRODUCT_VERSION,
    ledgerId: createFiledReturnsLedgerId("full-fiscal-year", now),
    revision: 1,
    status: "running",
    scope: {
      financialYear: scope.financialYear,
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: scope.returnType,
      artifactType,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(eligibleThrough ? { eligibleThrough } : {}),
    lastReconciledAt: timestamp,
    targets: periods.map((period) => {
      const targetScope = {
        artifactType,
        financialYear: scope.financialYear,
        period,
        returnType: scope.returnType,
      };
      return {
        targetId: createTargetId(scope.financialYear, period, scope.returnType, artifactType),
        ...targetScope,
        status: "pending",
        attempts: 0,
        ...canonicalDurableTargetStatus(targetScope, "pending", []),
        updatedAt: timestamp,
      };
    }),
  };
}

export function reconcileFullFiscalYearLedgerTargets(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  periods: readonly FiledReturnsMonth[],
): FiledReturnsFullFiscalYearLedger {
  if (!isCanonicalFullFiscalYearPeriodPlan(ledger.scope.financialYear, periods)) return ledger;

  const existingPeriods = existingCanonicalPlanPeriods(ledger);
  if (!existingPeriods) return ledger;
  const plannedPeriods = longerCompatiblePeriodPlan(existingPeriods, periods);
  if (!plannedPeriods) return ledger;

  const timestamp = now.toISOString();
  const eligibleThrough = plannedPeriods.at(-1);
  if (!eligibleThrough) return ledger;
  const artifactType = normaliseFiledReturnsArtifactType(
    ledger.scope.returnType,
    ledger.scope.artifactType,
  );
  const missingTargets = plannedPeriods.slice(existingPeriods.length).map((period) => {
    const targetScope = {
      artifactType,
      financialYear: ledger.scope.financialYear,
      period,
      returnType: ledger.scope.returnType,
    };
    return {
      targetId: createTargetId(
        ledger.scope.financialYear,
        period,
        ledger.scope.returnType,
        artifactType,
      ),
      ...targetScope,
      status: "pending" as const,
      attempts: 0,
      ...canonicalDurableTargetStatus(targetScope, "pending", []),
      updatedAt: timestamp,
    };
  });
  const targets = [...ledger.targets, ...missingTargets];
  const metadataChanged =
    ledger.planVersion !== FULL_FISCAL_YEAR_PLAN_VERSION ||
    ledger.eligibleThrough !== eligibleThrough ||
    ledger.connectorVersion !== GST_CONNECTOR_DESCRIPTOR.version ||
    ledger.createdWithExtensionVersion === undefined;
  const changed = metadataChanged || missingTargets.length > 0;
  const hasActionRequiredTarget = ledger.targets.some(
    (target) =>
      target.status !== "pending" &&
      target.status !== "running" &&
      !POSITIVE_TARGET_STATUSES.has(target.status),
  );
  const hasRunningTarget = ledger.targets.some((target) => target.status === "running");

  const reconciledLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: changed ? nextRevision(ledger) : (ledger.revision ?? 1),
    planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: ledger.createdWithExtensionVersion ?? PACK_PRODUCT_VERSION,
    status: missingTargets.length > 0 && !hasActionRequiredTarget ? "running" : ledger.status,
    updatedAt: missingTargets.length > 0 && !hasRunningTarget ? timestamp : ledger.updatedAt,
    eligibleThrough,
    lastReconciledAt: changed ? timestamp : (ledger.lastReconciledAt ?? timestamp),
    targets,
  };
  if (missingTargets.length > 0) {
    delete reconciledLedger.zipPhase;
    delete reconciledLedger.zipDownloadAttempt;
  }
  return reconciledLedger;
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
    hasCanonicalFullFiscalYearTargetPlan(ledger) &&
    ledger.targets.length > 0 &&
    ledger.targets.every((target) => POSITIVE_TARGET_STATUSES.has(target.status))
  );
}

/** Target disagreement only; plan validity and ZIP delivery remain separate guards. */
export function hasInconsistentFullFiscalYearCompletion(
  ledger: FiledReturnsFullFiscalYearLedger,
): boolean {
  return (
    ledger.status === "complete" &&
    ledger.targets.some((target) => !POSITIVE_TARGET_STATUSES.has(target.status))
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
        ? (() => {
            const targetScope = {
              financialYear: target.financialYear,
              period: target.period,
              returnType: target.returnType,
              ...(target.artifactType ? { artifactType: target.artifactType } : {}),
            };
            return {
              ...target,
              status: "running",
              attempts: target.attempts + 1,
              ...canonicalDurableTargetStatus(targetScope, "running", [
                ...durableFullFiscalYearArtifactSignals(target.safeSignals),
                "full-fiscal-year-target-running",
              ]),
              startedAt: target.startedAt ?? timestamp,
              updatedAt: timestamp,
            };
          })()
        : target,
    ),
  };
  delete runningLedger.zipPhase;
  delete runningLedger.zipDownloadAttempt;
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
  const currentTarget = ledger.targets.find((target) => target.targetId === targetId);
  const diagnosticState = currentTarget
    ? mergeFiledReturnsDownloadDiagnosticState(currentTarget, flowStep, {
        artifactType: currentTarget.artifactType,
        financialYear: currentTarget.financialYear,
        period: currentTarget.period,
        returnType: currentTarget.returnType,
      })
    : null;
  const diagnosticsRejected = Boolean(currentTarget && !diagnosticState);
  const inputSignals = diagnosticsRejected
    ? Array.from(new Set([...flowStep.safeSignals, "filed-return-download-diagnostics-rejected"]))
    : flowStep.safeSignals;
  const durableStatus = currentTarget
    ? canonicalDurableTargetStatus(
        {
          financialYear: currentTarget.financialYear,
          period: currentTarget.period,
          returnType: currentTarget.returnType,
          ...(currentTarget.artifactType ? { artifactType: currentTarget.artifactType } : {}),
        },
        status,
        inputSignals,
      )
    : null;
  const durableStatusRejected =
    durableStatus?.safeSignals.includes("filed-return-durable-status-rejected") ?? false;
  const effectiveStatus: FiledReturnsFullFiscalYearTargetStatus =
    diagnosticsRejected || durableStatusRejected ? "blocked" : status;
  const nextTargets = ledger.targets.map((target) => {
    if (target.targetId !== targetId) return target;
    return {
      ...target,
      status: effectiveStatus,
      ...(durableStatus ??
        canonicalDurableTargetStatus(
          {
            financialYear: target.financialYear,
            period: target.period,
            returnType: target.returnType,
            ...(target.artifactType ? { artifactType: target.artifactType } : {}),
          },
          "blocked",
          ["filed-return-durable-status-rejected"],
        )),
      ...(diagnosticState ?? {}),
      ...(POSITIVE_TARGET_STATUSES.has(effectiveStatus) ? { completedAt: timestamp } : {}),
      updatedAt: timestamp,
    };
  });
  return {
    ...ledger,
    revision: nextRevision(ledger),
    status: ledgerStatus(nextTargets, effectiveStatus),
    currentTargetId: targetId,
    updatedAt: timestamp,
    targets: nextTargets,
  };
}

/**
 * The terminal phase for a cleanup, keeping which pending phase it came from.
 *
 * Three routes reach cleanup and only one of them delivered a ZIP to the
 * browser. Writing a single `cleaned` for all three discarded the distinction
 * at exactly the moment it became the only record of it.
 *
 * An unrecognised or absent pending phase stays on the origin-less `cleaned`
 * rather than guessing a route, so it reads as indeterminate.
 */
function cleanedPhaseFor(
  pending: FiledReturnsFullFiscalYearLedger["zipPhase"],
): NonNullable<FiledReturnsFullFiscalYearLedger["zipPhase"]> {
  if (pending === "downloaded-cleanup-pending") return "cleaned-after-download";
  if (pending === "no-artifacts-cleanup-pending") return "cleaned-without-export";
  if (pending === "legacy-cleanup-pending") return "cleaned-legacy";
  return "cleaned";
}

export function completeFullFiscalYearLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  if (!canCompleteFullFiscalYearLedger(ledger)) return ledger;
  const ledgerWithoutCurrentTarget = withoutCurrentTarget(ledger);
  const completedLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledgerWithoutCurrentTarget,
    revision: nextRevision(ledger),
    status: "complete",
    updatedAt: now.toISOString(),
    zipPhase: cleanedPhaseFor(ledger.zipPhase),
  };
  delete completedLedger.zipDownloadAttempt;
  return completedLedger;
}

export function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
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

function existingCanonicalPlanPeriods(
  ledger: FiledReturnsFullFiscalYearLedger,
): FiledReturnsMonth[] | null {
  if (hasCanonicalFullFiscalYearTargetPlan(ledger)) {
    return canonicalFullFiscalYearPlanPeriods(ledger.scope.financialYear, ledger.eligibleThrough);
  }
  return hasLegacyCanonicalFullFiscalYearTargetPrefix(ledger)
    ? ledger.targets.map((target) => target.period as FiledReturnsMonth)
    : null;
}

function longerCompatiblePeriodPlan(
  existingPeriods: readonly FiledReturnsMonth[],
  currentPeriods: readonly FiledReturnsMonth[],
): readonly FiledReturnsMonth[] | null {
  const prefixLength = Math.min(existingPeriods.length, currentPeriods.length);
  for (let index = 0; index < prefixLength; index += 1) {
    if (existingPeriods[index] !== currentPeriods[index]) return null;
  }
  return existingPeriods.length >= currentPeriods.length ? existingPeriods : currentPeriods;
}
