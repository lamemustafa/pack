import type {
  FiledReturnsAllSupportedFullFiscalYearIdentity,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  ALL_SUPPORTED_FULL_FISCAL_YEAR_CATALOGUE_VERSION,
  expandAllSupportedFullFiscalYearTargetPlan,
  type FiledReturnsAllSupportedFullFiscalYearPlanTarget,
} from "../connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { createFiledReturnsLedgerId } from "../connectors/gst/filed-returns-ledger-id";
import {
  FILED_RETURNS_MONTHS,
  type FiledReturnsMonth,
} from "../connectors/gst/filed-returns-scope";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import { canonicalDurableTargetStatus } from "../connectors/gst/filed-returns-durable-status";
import { PACK_PRODUCT_VERSION } from "../extension/version";
import { mergeFiledReturnsDownloadDiagnosticState } from "./filed-returns-download-diagnostic-state";
import { isCanonicalFullFiscalYearPeriodPlan } from "./filed-returns-full-fiscal-year-validation";
import {
  ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_VERSION,
  ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_PROVENANCE_VERSION,
  createAllSupportedFullFiscalYearTargetId,
  isAllSupportedFullFiscalYearLedger,
  type FiledReturnsAllSupportedFullFiscalYearLedger,
  type FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget,
  type FiledReturnsAllSupportedFullFiscalYearPeriodPlan,
  type FiledReturnsAllSupportedFullFiscalYearTarget,
} from "./filed-returns-all-supported-full-fiscal-year-validation";

const POSITIVE_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "not-filed",
]);
const EXPLICIT_RETRY_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "download-unconfirmed",
  "blocked",
  "failed",
  "cancelled",
  "manually-observed",
]);
const NON_RESUMABLE_EXPLICIT_RETRY_SIGNALS = new Set([
  "all-supported-full-fiscal-year-artifact-snapshot-mismatch",
  "full-fiscal-year-pinned-gst-tab-unavailable",
  "single-period-bundle-ledger-malformed",
  "single-period-bundle-scope-conflict",
  "single-period-bundle-state-persist-failed",
  "single-period-bundle-state-read-failed",
  "filed-return-durable-status-rejected",
]);

/**
 * The first unresolved target is the only child an explicit retry may replay.
 * Later targets are still pending because the runner stops at its first
 * terminal review state; accepting a later ID would execute an unreviewed
 * earlier target instead of the target the reader authorised.
 */
export function allSupportedExplicitRetryTarget(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): FiledReturnsAllSupportedFullFiscalYearTarget | null {
  if (ledger.zipPhase) return null;
  const targetIndex = ledger.targets.findIndex(isExplicitlyRetryableTarget);
  const target = ledger.targets[targetIndex]!;
  return ledger.targets
    .slice(0, targetIndex)
    .every((candidate) => POSITIVE_TARGET_STATUSES.has(candidate.status)) &&
    ledger.targets.slice(targetIndex + 1).every((candidate) => candidate.status === "pending")
    ? target
    : null;
}

function isExplicitlyRetryableTarget(
  target: FiledReturnsAllSupportedFullFiscalYearTarget,
): boolean {
  return (
    EXPLICIT_RETRY_TARGET_STATUSES.has(target.status) &&
    !target.safeSignals.some((signal) => NON_RESUMABLE_EXPLICIT_RETRY_SIGNALS.has(signal))
  );
}

/**
 * Whether invoking the same all-supported start again would actually advance this ledger.
 *
 * Mirrors the branches of `continueSavedAllSupportedFullFiscalYearRun` that do work, and only
 * those. The distinction matters at the surface: a branch that returns the same interrupted,
 * unresolved or manual-review state without changing the ledger leaves the reader pressing a
 * control that cannot help, while withholding the control on a genuinely resumable plan leaves
 * discarding it as the only way out.
 *
 * Two earlier attempts got this wrong in opposite directions -- three ZIP phases was too narrow,
 * every non-terminal status too broad -- so it is written against the runner's branches directly.
 */
export function allSupportedResumeIsProductive(
  ledger: Pick<
    FiledReturnsAllSupportedFullFiscalYearLedger,
    "status" | "zipPhase" | "targets" | "zipDownloadAttempt"
  >,
): boolean {
  const phase = ledger.zipPhase;
  if (phase === "download-observing") {
    // The runner reconciles only against a recorded browser download; without one it returns the
    // manual-review step unchanged.
    return typeof ledger.zipDownloadAttempt?.downloadId === "number";
  }
  if (
    phase === "export-pending" ||
    phase === "export-retry-pending" ||
    phase === "downloaded-cleanup-pending" ||
    phase === "no-artifacts-cleanup-pending"
  ) {
    return true;
  }
  // Any other recorded phase, cleaned included, returns a terminal or review step unchanged.
  if (phase) return false;
  if (ledger.status === "running") {
    // A target still marked running belongs to the interrupted projection, not to a resume.
    return !ledger.targets.some((target) => target.status === "running");
  }
  if (ledger.status === "partial") {
    return ledger.targets.every((target) =>
      ["pending", ...POSITIVE_TARGET_STATUSES].includes(target.status),
    );
  }
  return false;
}

/**
 * Classifies a productive retry by whether it can advance solely from Pack's
 * persisted local evidence or needs the signed-in portal again. Keeping this
 * alongside the productivity predicate prevents summary refreshes and action
 * responses from disagreeing about the same saved ZIP phase.
 */
export function allSupportedResumeMode(
  ledger: Pick<
    FiledReturnsAllSupportedFullFiscalYearLedger,
    "status" | "zipPhase" | "targets" | "zipDownloadAttempt"
  >,
): "local-only" | "portal" | null {
  if (!allSupportedResumeIsProductive(ledger)) return null;
  if (
    ledger.zipPhase === "download-observing" ||
    ledger.zipPhase === "export-pending" ||
    ledger.zipPhase === "export-retry-pending" ||
    ledger.zipPhase === "downloaded-cleanup-pending" ||
    ledger.zipPhase === "no-artifacts-cleanup-pending"
  ) {
    return "local-only";
  }
  return "portal";
}

export function createAllSupportedFullFiscalYearLedger(
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity,
  returnPlan: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
  periods:
    readonly FiledReturnsMonth[] | readonly FiledReturnsAllSupportedFullFiscalYearPeriodPlan[],
  now: Date,
): FiledReturnsAllSupportedFullFiscalYearLedger {
  if (!matchesCurrentAllSupportedReturnPlan(returnPlan)) {
    throw new Error("Invalid all-supported full-year return-plan provenance.");
  }
  const hasReturnSpecificPeriodPlan = periods[0] !== undefined && typeof periods[0] !== "string";
  const periodPlan = normaliseAllSupportedPeriodPlan(planRoot.financialYear, returnPlan, periods);
  const targetPlan = createAllSupportedFullFiscalYearTargetPlan(planRoot, returnPlan, periodPlan);
  if (targetPlan.length === 0) {
    throw new Error("An all-supported full-year plan needs at least one target.");
  }
  const timestamp = now.toISOString();
  const eligibleThrough = latestEligiblePeriod(periodPlan);
  if (!eligibleThrough)
    throw new Error("An all-supported full-year plan needs an eligible period.");
  const ledger: FiledReturnsAllSupportedFullFiscalYearLedger = {
    schemaVersion: "2.0",
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
    planProvenance: {
      schemaVersion: ALL_SUPPORTED_FULL_FISCAL_YEAR_PLAN_PROVENANCE_VERSION,
      catalogueVersion: ALL_SUPPORTED_FULL_FISCAL_YEAR_CATALOGUE_VERSION,
      returnPlan: returnPlan.map((target) => ({
        returnType: target.returnType,
        artifactType: target.artifactType,
        concreteArtifactTypes: [...target.concreteArtifactTypes],
      })),
    },
    ...(hasReturnSpecificPeriodPlan
      ? { periodPlan: periodPlan.map((plan) => ({ ...plan, periods: [...plan.periods] })) }
      : {}),
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

function matchesCurrentAllSupportedReturnPlan(
  returnPlan: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
): boolean {
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  return (
    expansion.ok &&
    returnPlan.length === expansion.targets.length &&
    returnPlan.every((target, index) => {
      const expected = expansion.targets[index];
      return (
        expected !== undefined &&
        target.returnType === expected.returnType &&
        target.artifactType === expected.artifactType &&
        target.concreteArtifactTypes.length === expected.concreteArtifactTypes.length &&
        target.concreteArtifactTypes.every(
          (artifactType, artifactIndex) =>
            artifactType === expected.concreteArtifactTypes[artifactIndex],
        )
      );
    })
  );
}

export function createAllSupportedFullFiscalYearTargetPlan(
  planRoot: FiledReturnsAllSupportedFullFiscalYearIdentity,
  returnPlan: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
  periods:
    readonly FiledReturnsMonth[] | readonly FiledReturnsAllSupportedFullFiscalYearPeriodPlan[],
): FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget[] {
  if (returnPlan.length === 0 || periods.length === 0) return [];
  const periodPlan = normaliseAllSupportedPeriodPlan(planRoot.financialYear, returnPlan, periods);
  const targetIds = new Set<string>();
  const returnTypes = new Set<string>();
  const targetPlan: FiledReturnsAllSupportedFullFiscalYearLedgerPlanTarget[] = [];
  for (const returnTarget of returnPlan) {
    if (returnTypes.has(returnTarget.returnType)) {
      throw new Error("An all-supported full-year plan cannot repeat a return type.");
    }
    returnTypes.add(returnTarget.returnType);
    const periodsForReturn = periodPlan.find(
      (plan) => plan.returnType === returnTarget.returnType,
    )?.periods;
    if (!periodsForReturn) throw new Error("Missing all-supported full-year return period plan.");
    for (const period of periodsForReturn) {
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

function normaliseAllSupportedPeriodPlan(
  financialYear: string,
  returnPlan: readonly FiledReturnsAllSupportedFullFiscalYearPlanTarget[],
  input: readonly FiledReturnsMonth[] | readonly FiledReturnsAllSupportedFullFiscalYearPeriodPlan[],
): FiledReturnsAllSupportedFullFiscalYearPeriodPlan[] {
  const first = input[0];
  let plan: FiledReturnsAllSupportedFullFiscalYearPeriodPlan[];
  if (typeof first === "string" || first === undefined) {
    if (!input.every((entry) => typeof entry === "string")) {
      throw new Error("Invalid all-supported full-year period plan.");
    }
    plan = returnPlan.map((target) => ({
      returnType: target.returnType,
      periods: [...(input as readonly FiledReturnsMonth[])],
    }));
  } else {
    if (!input.every((entry) => typeof entry === "object" && entry !== null)) {
      throw new Error("Invalid all-supported full-year period plan.");
    }
    plan = (input as readonly FiledReturnsAllSupportedFullFiscalYearPeriodPlan[]).map((entry) => ({
      returnType: entry.returnType,
      periods: [...entry.periods],
    }));
  }
  if (
    plan.length !== returnPlan.length ||
    !plan.every((entry, index) => {
      const expected = returnPlan[index];
      return (
        expected !== undefined &&
        entry.returnType === expected.returnType &&
        (entry.periods.length === 0 ||
          isCanonicalFullFiscalYearPeriodPlan(financialYear, entry.periods))
      );
    })
  ) {
    throw new Error("Invalid all-supported full-year period plan.");
  }
  return plan;
}

function latestEligiblePeriod(
  periodPlan: readonly FiledReturnsAllSupportedFullFiscalYearPeriodPlan[],
): FiledReturnsMonth | undefined {
  return periodPlan
    .flatMap((plan) => plan.periods)
    .sort((left, right) => FILED_RETURNS_MONTHS.indexOf(left) - FILED_RETURNS_MONTHS.indexOf(right))
    .at(-1);
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
