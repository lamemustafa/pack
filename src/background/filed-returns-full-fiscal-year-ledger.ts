import type {
  FiledReturnsSelectedTargetsRequest,
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  FiledReturnsLedgerPlanTarget,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  normaliseFiledReturnsArtifactType,
  type FiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  FULL_FISCAL_YEAR_PERIOD,
  getFiledReturnsFullFiscalYearPeriods,
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
  SELECTED_TARGETS_PLAN_VERSION,
  hasTrustworthyTargetPlan,
  isCanonicalFullFiscalYearPeriodPlan,
} from "./filed-returns-full-fiscal-year-validation";
export {
  hasCanonicalFullFiscalYearTargetPlan,
  hasTrustworthyTargetPlan,
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
  const targetPlan = createFiledReturnsTargetPlan(
    periods.map((period) => ({
      artifactType,
      financialYear: scope.financialYear,
      period,
      returnType: scope.returnType,
    })),
  );
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
    targetPlan,
    targets: targetPlan.map((planTarget) => {
      const targetScope = {
        financialYear: planTarget.financialYear,
        period: planTarget.period,
        returnType: planTarget.returnType,
        ...(planTarget.artifactType ? { artifactType: planTarget.artifactType } : {}),
      };
      return {
        targetId: planTarget.targetId,
        ...targetScope,
        status: "pending",
        attempts: 0,
        ...canonicalDurableTargetStatus(targetScope, "pending", []),
        updatedAt: timestamp,
      };
    }),
  };
}

/**
 * Builds a run over exactly the periods a person picked.
 *
 * Shares everything below the plan with a full-year run -- the targets, the ZIP, the download
 * evidence -- because all of that was already driven by the recorded target list rather than
 * by the year. Only the plan differs, and with it where completion authority comes from.
 *
 * One return type per run, for now. The selection contract carries a return type per cell so a
 * mixed selection can be expressed, but the ledger's scope authorises exactly one, and the
 * all-supported root already owns the every-return case. A mixed selection is refused here by
 * name rather than quietly run as whichever return happened to sort first.
 */
export function createSelectedTargetsLedger(
  request: FiledReturnsSelectedTargetsRequest,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const returnTypes = new Set(request.targets.map((target) => target.returnType));
  if (returnTypes.size !== 1) {
    throw new Error("A selected-targets run covers exactly one return type.");
  }
  const returnType = request.targets[0]!.returnType;
  return createSelectedPeriodsLedger(
    {
      financialYear: request.financialYear,
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType,
      artifactType: request.targets[0]!.artifactType,
    },
    now,
    request.targets.map((target) => target.period),
  );
}

/** The ledger half of a selected run, shared with the flow that already holds a scope. */
export function createSelectedPeriodsLedger(
  scope: FiledReturnsDownloadScope,
  now: Date,
  periods: readonly string[],
): FiledReturnsFullFiscalYearLedger {
  if (periods.length === 0) {
    throw new Error("A selected-periods run needs at least one period.");
  }
  const returnType = scope.returnType;
  const artifactType = normaliseFiledReturnsArtifactType(returnType, scope.artifactType);
  const timestamp = now.toISOString();
  const targetPlan = createFiledReturnsTargetPlan(
    periods.map((period) => ({
      artifactType,
      financialYear: scope.financialYear,
      period,
      returnType,
    })),
  );
  return {
    schemaVersion: "1.0",
    planVersion: SELECTED_TARGETS_PLAN_VERSION,
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: PACK_PRODUCT_VERSION,
    ledgerId: createFiledReturnsLedgerId("full-fiscal-year", now),
    revision: 1,
    status: "running",
    scope: {
      financialYear: scope.financialYear,
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType,
      artifactType,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    // Deliberately not set. `eligibleThrough` says "the year, up to here", which is a claim
    // about a contiguous run; a picked set is not one, and a reader that took the last period
    // as an extent would read months that were never selected as part of this run.
    lastReconciledAt: timestamp,
    targetPlan,
    targets: targetPlan.map((planTarget) => {
      const targetScope = {
        financialYear: planTarget.financialYear,
        period: planTarget.period,
        returnType: planTarget.returnType,
        ...(planTarget.artifactType ? { artifactType: planTarget.artifactType } : {}),
      };
      return {
        targetId: planTarget.targetId,
        ...targetScope,
        status: "pending" as const,
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
  // The plan is fixed when the run is created and never grows, so periods are
  // not consulted here; `unplannedEligibleFullFiscalYearPeriods` reports the
  // divergence at completion instead. What remains is stamping the connector and
  // extension versions a resumed run is actually executing under. A validated
  // legacy prefix becomes an explicit v3 plan before any recovery action runs.
  void periods;
  if (!hasTrustworthyTargetPlan(ledger)) {
    const targetPeriods = ledger.targets.map((target) => target.period) as FiledReturnsMonth[];
    const eligibleThrough = targetPeriods.at(-1);
    if (
      ledger.planVersion !== undefined ||
      ledger.eligibleThrough !== undefined ||
      ledger.targetPlan !== undefined ||
      !eligibleThrough ||
      !isCanonicalFullFiscalYearPeriodPlan(ledger.scope.financialYear, targetPeriods)
    ) {
      return ledger;
    }
    const timestamp = now.toISOString();
    return {
      ...ledger,
      revision: nextRevision(ledger),
      planVersion: FULL_FISCAL_YEAR_PLAN_VERSION,
      eligibleThrough,
      targetPlan: createFiledReturnsTargetPlan(
        ledger.targets.map((target) => ({
          financialYear: target.financialYear,
          period: target.period,
          returnType: target.returnType,
          ...(target.artifactType ? { artifactType: target.artifactType } : {}),
        })),
      ),
      connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
      createdWithExtensionVersion: PACK_PRODUCT_VERSION,
      lastReconciledAt: timestamp,
    };
  }
  const changed =
    ledger.connectorVersion !== GST_CONNECTOR_DESCRIPTOR.version ||
    ledger.createdWithExtensionVersion === undefined;
  if (!changed) return ledger;
  const timestamp = now.toISOString();
  return {
    ...ledger,
    revision: nextRevision(ledger),
    connectorVersion: GST_CONNECTOR_DESCRIPTOR.version,
    createdWithExtensionVersion: ledger.createdWithExtensionVersion ?? PACK_PRODUCT_VERSION,
    lastReconciledAt: timestamp,
  };
}

/** Builds the durable authority for any supported set of filed-return targets. */
export function createFiledReturnsTargetPlan(
  scopes: readonly FiledReturnsDownloadScope[],
): FiledReturnsLedgerPlanTarget[] {
  if (scopes.length === 0)
    throw new Error("A filed-returns target plan needs at least one target.");
  const targetIds = new Set<string>();
  const plan = scopes.map((scope) => {
    const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
    const targetId = createTargetId(
      scope.financialYear,
      scope.period,
      scope.returnType,
      artifactType,
    );
    if (targetIds.has(targetId))
      throw new Error("A filed-returns target plan cannot repeat a target.");
    targetIds.add(targetId);
    return {
      targetId,
      financialYear: scope.financialYear,
      period: scope.period,
      returnType: scope.returnType,
      artifactType,
    };
  });
  return plan;
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

/**
 * The periods eligible now that this run's recorded plan does not cover.
 *
 * A plan is fixed when the run is created, so a run started mid-year stays
 * narrower than the year as later months are filed. Derived rather than
 * stored: both inputs are canonical -- the plan the run is answerable for, and
 * the eligible set for the financial year as of `now` -- so a persisted copy
 * could only drift from them, and "eligible now" is the question a reader is
 * actually asking.
 */
export function unplannedEligibleFullFiscalYearPeriods(
  ledger: Pick<FiledReturnsFullFiscalYearLedger, "scope" | "targetPlan" | "targets">,
  now: Date,
): FiledReturnsMonth[] {
  const planned = new Set<string>((ledger.targetPlan ?? ledger.targets).map((t) => t.period));
  return getFiledReturnsFullFiscalYearPeriods(ledger.scope.financialYear, now).filter(
    (period) => !planned.has(period),
  );
}

export function canCompleteFullFiscalYearLedger(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return (
    hasTrustworthyTargetPlan(ledger) &&
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
