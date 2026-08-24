import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { concreteFiledReturnsArtifactTypesForSelection } from "../connectors/gst/filed-returns-artifacts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { getFiledReturnsFullFiscalYearPeriods } from "../connectors/gst/filed-returns-scope";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  completeFullFiscalYearLedger,
  hasCanonicalFullFiscalYearTargetPlan,
  reconcileFullFiscalYearLedgerTargets,
  sameFiledReturnsScope,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  persistLedger,
  persistLedgerAndSummary,
  shouldPersistReconciledLedger,
} from "./filed-returns-full-fiscal-year-run-state";
import { filedReturnsSummaryStatusMessage } from "../connectors/gst/filed-returns-summary-status";
import {
  blockedFullFiscalYearStep,
  completeFullFiscalYearStep,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-summary";
import { durableFullFiscalYearArtifactSignals } from "./filed-returns-full-fiscal-year-validation";
import { discardFullFiscalYearFiledReturnsZip } from "./filed-returns-full-fiscal-year-zip";
import { readCanonicalFiledReturnsFlowSummary } from "./filed-returns-session-summary";

const FULL_YEAR_STAGED_SIGNAL_PREFIX = "full-fiscal-year-opfs-staged:";

export function scopeForFullFiscalYearTarget(
  target: FiledReturnsFullFiscalYearTarget,
): FiledReturnsDownloadScope {
  const remainingArtifactType = remainingArtifactTypeForTarget(target);
  if (remainingArtifactType === undefined) {
    return {
      financialYear: target.financialYear,
      period: target.period,
      returnType: target.returnType,
      ...(target.artifactType ? { artifactType: target.artifactType } : {}),
    };
  }
  return {
    financialYear: target.financialYear,
    period: target.period,
    returnType: target.returnType,
    artifactType: remainingArtifactType,
  };
}

export function mergeRetriedArtifactSignals(
  previousSignals: readonly string[],
  flowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  const artifactSignals = durableFullFiscalYearArtifactSignals(previousSignals);
  if (artifactSignals.length === 0) return flowStep;
  return {
    ...flowStep,
    safeSignals: Array.from(new Set([...artifactSignals, ...flowStep.safeSignals])),
  };
}

export function requireFullFiscalYearArtifactsStaged(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  if (flowStep.state !== "downloaded") return flowStep;
  const signals = new Set(flowStep.safeSignals);
  const missingArtifactTypes = concreteFiledReturnsArtifactTypesForSelection(
    scope.returnType,
    scope.artifactType,
  ).filter(
    (artifactType) =>
      !signals.has(`${FULL_YEAR_STAGED_SIGNAL_PREFIX}${artifactType}`) &&
      !signals.has(`filed-return-artifact-unavailable:${artifactType}`),
  );
  if (missingArtifactTypes.length === 0) return flowStep;
  return {
    ...flowStep,
    state: "blocked",
    safeSignals: [
      ...flowStep.safeSignals,
      "full-fiscal-year-artifact-staging-incomplete",
      ...missingArtifactTypes.map(
        (artifactType) => `full-fiscal-year-artifact-not-staged:${artifactType}`,
      ),
    ],
    safeMessage:
      "Pack observed the portal download, but could not stage every required file for the fiscal-year zip.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry this period so Pack can stage the file for the fiscal-year zip.",
      canResume: true,
    },
  };
}

function remainingArtifactTypeForTarget(
  target: FiledReturnsFullFiscalYearTarget,
): FiledReturnsDownloadScope["artifactType"] | undefined {
  const signals = new Set(target.safeSignals);
  const artifactTypes = concreteFiledReturnsArtifactTypesForSelection(
    target.returnType,
    target.artifactType,
  );
  const hasRetainedArtifactOutcome = artifactTypes.some(
    (artifactType) =>
      signals.has(`${FULL_YEAR_STAGED_SIGNAL_PREFIX}${artifactType}`) ||
      signals.has(`filed-return-artifact-unavailable:${artifactType}`),
  );
  if (!hasRetainedArtifactOutcome) return undefined;
  const remainingArtifactTypes = artifactTypes.filter(
    (artifactType) =>
      !signals.has(`${FULL_YEAR_STAGED_SIGNAL_PREFIX}${artifactType}`) &&
      !signals.has(`filed-return-artifact-unavailable:${artifactType}`),
  );
  // The portal exposes no EXCEL-and-JSON-only selection. If more than one
  // concrete artifact remains, retry the canonical target selection so its
  // staging guard still verifies the complete outstanding set.
  return remainingArtifactTypes.length === 1 ? remainingArtifactTypes[0] : target.artifactType;
}

export function createFullFiscalYearCleanupPendingState(
  ledger: FiledReturnsFullFiscalYearLedger,
  zipStep: PortalFlowStepResult,
): { ledger: FiledReturnsFullFiscalYearLedger; step: PortalFlowStepResult } {
  const noArtifacts = zipStep.safeSignals.includes("full-fiscal-year-no-zip-artifacts");
  return {
    ledger: markFullFiscalYearCleanupPending(
      ledger,
      new Date(ledger.updatedAt),
      noArtifacts ? "no-artifacts-cleanup-pending" : "downloaded-cleanup-pending",
    ),
    step: {
      ...zipStep,
      state: "blocked",
      safeSignals: Array.from(
        new Set([
          ...zipStep.safeSignals,
          "full-fiscal-year-local-cleanup-retry",
          "full-fiscal-year-zip-cleanup-pending",
          "full-fiscal-year-opfs-retained",
        ]),
      ),
      safeMessage: noArtifacts
        ? "Pack found no fiscal-year artifacts to export and is clearing its temporary local staging."
        : "Pack downloaded the final fiscal-year ZIP and is clearing its temporary local staging.",
    },
  };
}

/**
 * The cleanup route to retry for a ledger that has already been cleaned once.
 *
 * Never upgrades. Re-cleaning a completed ledger must end on the terminal phase
 * it already had, because that phase is the delivery evidence -- and resetting
 * it to the delivery route relabelled a run that never exported anything as one
 * whose ZIP the browser confirmed.
 *
 * A pre-split `cleaned` carries no origin, so it takes the non-delivery route
 * and stays reading as captured, which is what it did before.
 */
export function cleanupPendingPhaseFor(
  cleaned: FiledReturnsFullFiscalYearLedger["zipPhase"],
): "downloaded-cleanup-pending" | "no-artifacts-cleanup-pending" | "legacy-cleanup-pending" {
  if (cleaned === "cleaned-after-download") return "downloaded-cleanup-pending";
  if (cleaned === "cleaned-without-export") return "no-artifacts-cleanup-pending";
  return "legacy-cleanup-pending";
}

export function markFullFiscalYearCleanupPending(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  // No default. `downloaded-cleanup-pending` was the default value, and it is
  // the one phase that asserts the ZIP reached the browser -- so a caller that
  // simply did not think about the argument claimed a delivery. Every call site
  // now states which route it is on.
  zipPhase:
    "downloaded-cleanup-pending" | "no-artifacts-cleanup-pending" | "legacy-cleanup-pending",
): FiledReturnsFullFiscalYearLedger {
  const requestedAt = ledger.zipDownloadAttempt?.requestedAt;
  const cleanupPendingLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: now.toISOString(),
    zipPhase,
  };
  delete cleanupPendingLedger.currentTargetId;
  if (zipPhase === "downloaded-cleanup-pending" && requestedAt) {
    cleanupPendingLedger.zipDownloadAttempt = { requestedAt };
  } else {
    delete cleanupPendingLedger.zipDownloadAttempt;
  }
  return cleanupPendingLedger;
}

export function markFullFiscalYearZipPhase(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  zipPhase: "export-pending" | "export-retry-pending" | "download-started",
): FiledReturnsFullFiscalYearLedger {
  const exportLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: now.toISOString(),
    zipPhase,
  };
  delete exportLedger.currentTargetId;
  delete exportLedger.zipDownloadAttempt;
  return exportLedger;
}

export function markFullFiscalYearZipDownloadIntent(
  ledger: FiledReturnsFullFiscalYearLedger,
  requestedAt: Date,
): FiledReturnsFullFiscalYearLedger {
  const intentLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: requestedAt.toISOString(),
    zipPhase: "download-intent-persisted",
    zipDownloadAttempt: { requestedAt: requestedAt.toISOString() },
  };
  delete intentLedger.currentTargetId;
  return intentLedger;
}

export function markFullFiscalYearZipDownloadObserving(
  ledger: FiledReturnsFullFiscalYearLedger,
  observedAt: Date,
  downloadId: number,
): FiledReturnsFullFiscalYearLedger {
  const requestedAt = ledger.zipDownloadAttempt?.requestedAt;
  if (!requestedAt || !Number.isSafeInteger(downloadId) || downloadId < 0) return ledger;
  const observingLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: observedAt.toISOString(),
    zipPhase: "download-observing",
    zipDownloadAttempt: { requestedAt, downloadId },
  };
  delete observingLedger.currentTargetId;
  return observingLedger;
}

export function markFullFiscalYearZipManualReview(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const requestedAt = ledger.zipDownloadAttempt?.requestedAt;
  if (!requestedAt) return markFullFiscalYearZipPhase(ledger, now, "download-started");
  const reviewLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: now.toISOString(),
    zipPhase: "download-intent-persisted",
    zipDownloadAttempt: { requestedAt },
  };
  delete reviewLedger.currentTargetId;
  return reviewLedger;
}

export function markFullFiscalYearRestagingRequired(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const timestamp = now.toISOString();
  const targets = ledger.targets.map((target) =>
    target.status === "not-filed"
      ? target
      : {
          ...target,
          status: "blocked" as const,
          safeSignals: Array.from(
            new Set([
              ...target.safeSignals.filter(
                (signal) => !signal.startsWith("full-fiscal-year-opfs-staged:"),
              ),
              "full-fiscal-year-restaging-required",
            ]),
          ),
          safeMessage: `Pack needs to restage ${target.period} before rebuilding the fiscal-year ZIP.`,
          updatedAt: timestamp,
        },
  );
  const currentTarget = targets.find((target) => target.status === "blocked");
  const restagingLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: timestamp,
    zipPhase: "restaging-required",
    targets,
    ...(currentTarget ? { currentTargetId: currentTarget.targetId } : {}),
  };
  delete restagingLedger.zipDownloadAttempt;
  return restagingLedger;
}

export async function finishFullFiscalYearCleanup(
  deps: FiledReturnsFlowRunnerDeps,
  cleanupPendingLedger: FiledReturnsFullFiscalYearLedger,
  priorStep?: PortalFlowStepResult,
): Promise<PackMessageResponse> {
  const summarySignals = await fullFiscalYearSummarySignalsForCleanup(
    deps,
    cleanupPendingLedger,
    priorStep,
  );
  const now = deps.now?.() ?? new Date();
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(
    cleanupPendingLedger.scope.financialYear,
    now,
  );
  const reconciledLedger =
    plannedPeriods.length > 0
      ? reconcileFullFiscalYearLedgerTargets(cleanupPendingLedger, now, plannedPeriods)
      : cleanupPendingLedger;
  if (shouldPersistReconciledLedger(cleanupPendingLedger, reconciledLedger)) {
    await persistLedger(deps, reconciledLedger);
  }
  if (!canCompleteFullFiscalYearLedger(reconciledLedger)) {
    const signal = hasCanonicalFullFiscalYearTargetPlan(reconciledLedger)
      ? "full-fiscal-year-run-needs-action"
      : "full-fiscal-year-target-plan-invalid";
    const step = blockedFullFiscalYearStep(signal, reconciledLedger);
    await persistLedgerAndSummary(deps, reconciledLedger, step);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(reconciledLedger, step),
    };
  }
  cleanupPendingLedger = reconciledLedger;

  const clearSignals = await discardFullFiscalYearFiledReturnsZip(cleanupPendingLedger.ledgerId);
  if (!clearSignals.includes("full-fiscal-year-opfs-cleared")) {
    const step = fullFiscalYearCleanupFailedStep(
      cleanupPendingLedger,
      clearSignals,
      summarySignals,
    );
    await persistLedgerAndSummary(deps, cleanupPendingLedger, step);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(cleanupPendingLedger, step),
    };
  }

  const completedLedger = completeFullFiscalYearLedger(
    cleanupPendingLedger,
    deps.now?.() ?? new Date(),
  );
  const step = fullFiscalYearCleanupCompletedStep(cleanupPendingLedger, summarySignals);
  await persistLedgerAndSummary(deps, completedLedger, step);
  return {
    ok: true,
    flowStep: step,
    flowSummary: toFullFiscalYearSummary(completedLedger, step),
  };
}

export async function restorePersistedFullFiscalYearSummaryOutcome(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  step: PortalFlowStepResult,
): Promise<PortalFlowStepResult> {
  if (!["download-intent-persisted", "download-observing"].includes(ledger.zipPhase ?? "")) {
    return step;
  }
  const requestedAt = ledger.zipDownloadAttempt?.requestedAt;
  if (!requestedAt) return step;
  const persistedSummary = await readCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion);
  const persistedSignals = persistedSummary?.flowStep.safeSignals ?? [];
  const intentCheckpointMatches =
    persistedSignals.includes("full-fiscal-year-zip-phase:download-intent-persisted") &&
    persistedSummary?.updatedAt ===
      (ledger.zipPhase === "download-intent-persisted" ? ledger.updatedAt : requestedAt);
  const observingCheckpointMatches =
    ledger.zipPhase === "download-observing" &&
    persistedSignals.includes("full-fiscal-year-zip-reconciled-by-id") &&
    persistedSummary?.updatedAt === ledger.updatedAt;
  if (
    !persistedSummary ||
    !sameFiledReturnsScope(persistedSummary.scope, ledger.scope) ||
    (!intentCheckpointMatches && !observingCheckpointMatches)
  ) {
    return step;
  }
  const summarySignals = persistedSummary.flowStep.safeSignals.filter(
    isFullFiscalYearSummaryOutcomeSignal,
  );
  if (summarySignals.length === 0) return step;
  return {
    ...step,
    safeSignals: Array.from(new Set([...step.safeSignals, ...summarySignals])),
    safeMessage: [step.safeMessage, filedReturnsSummaryStatusMessage(summarySignals, "unconfirmed")]
      .filter(Boolean)
      .join(" "),
  };
}

async function fullFiscalYearSummarySignalsForCleanup(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  priorStep?: PortalFlowStepResult,
): Promise<string[]> {
  if (priorStep) {
    return priorStep.safeSignals.filter(isFullFiscalYearSummaryOutcomeSignal);
  }
  const persistedSummary = await readCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion);
  if (!persistedSummary) return [];
  if (!sameFiledReturnsScope(persistedSummary.scope, ledger.scope)) return [];
  const persistedSignals = persistedSummary.flowStep.safeSignals;
  const exactCleanupCheckpoint = persistedSummary.updatedAt === ledger.updatedAt;
  const intentCheckpoint =
    ledger.zipPhase === "downloaded-cleanup-pending" &&
    persistedSignals.includes("full-fiscal-year-zip-phase:download-intent-persisted") &&
    persistedSummary.updatedAt === ledger.zipDownloadAttempt?.requestedAt;
  if (!exactCleanupCheckpoint && !intentCheckpoint) return [];
  return persistedSignals.filter(isFullFiscalYearSummaryOutcomeSignal);
}

function isFullFiscalYearSummaryOutcomeSignal(signal: string): boolean {
  return (
    signal.startsWith("full-fiscal-year-summary-") ||
    signal.startsWith("full-fiscal-year-workbook-")
  );
}

export function completedRunCleanupBlockedStep(
  ledger: FiledReturnsFullFiscalYearLedger,
  clearSignals: readonly string[] = ["full-fiscal-year-opfs-clear-failed"],
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: stepScopeId(ledger),
    state: "blocked",
    safeSignals: [
      "full-fiscal-year-local-cleanup-retry",
      "full-fiscal-year-completed-staging-cleanup-failed",
      "full-fiscal-year-zip-cleanup-pending",
      ...clearSignals,
      "full-fiscal-year-opfs-retained",
    ],
    safeMessage:
      "Pack kept the completed fiscal-year run because its retained local staging could not be cleared safely.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry after Pack can clear the retained fiscal-year staging.",
      canResume: true,
    },
  };
}

function fullFiscalYearCleanupFailedStep(
  ledger: FiledReturnsFullFiscalYearLedger,
  clearSignals: readonly string[],
  summarySignals: readonly string[] = [],
): PortalFlowStepResult {
  const zipDownloaded = ledger.zipPhase === "downloaded-cleanup-pending";
  const noArtifacts = ledger.zipPhase === "no-artifacts-cleanup-pending";
  return {
    connectorId: "gst",
    scopeId: stepScopeId(ledger),
    state: "blocked",
    safeSignals: [
      "full-fiscal-year-local-cleanup-retry",
      ...(zipDownloaded ? ["full-fiscal-year-zip-downloaded"] : []),
      ...(noArtifacts ? ["full-fiscal-year-no-zip-artifacts"] : []),
      ...summarySignals,
      "full-fiscal-year-zip-cleanup-pending",
      ...clearSignals,
      "full-fiscal-year-opfs-retained",
    ],
    safeMessage: [
      noArtifacts
        ? "Pack found no fiscal-year artifacts to export but could not clear its retained local staging. Retry the local cleanup before starting another full-year run."
        : zipDownloaded
          ? "Pack downloaded the final fiscal-year ZIP but could not clear its retained local staging. Retry the local cleanup before starting another full-year run."
          : "Pack could not clear retained local fiscal-year staging. Retry the local cleanup before starting another full-year run.",
      filedReturnsSummaryStatusMessage(summarySignals, zipDownloaded ? "confirmed" : "intent"),
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function fullFiscalYearCleanupCompletedStep(
  ledger: FiledReturnsFullFiscalYearLedger,
  summarySignals: readonly string[] = [],
): PortalFlowStepResult {
  const zipDownloaded = ledger.zipPhase === "downloaded-cleanup-pending";
  const noArtifacts = ledger.zipPhase === "no-artifacts-cleanup-pending";
  const availabilitySignals = ledger.targets.flatMap((target) =>
    target.safeSignals.filter((signal) => signal.startsWith("filed-return-artifact-unavailable:")),
  );
  const completeStep = completeFullFiscalYearStep(ledger);
  return {
    ...completeStep,
    safeSignals: Array.from(
      new Set([
        "full-fiscal-year-complete",
        ...(zipDownloaded ? ["full-fiscal-year-zip-downloaded"] : []),
        ...(noArtifacts ? ["full-fiscal-year-no-zip-artifacts"] : []),
        ...summarySignals,
        "full-fiscal-year-opfs-cleared",
        ...availabilitySignals,
      ]),
    ),
    safeMessage: [
      completeStep.safeMessage,
      filedReturnsSummaryStatusMessage(summarySignals, zipDownloaded ? "confirmed" : "intent"),
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function stepScopeId(ledger: FiledReturnsFullFiscalYearLedger): string {
  return completeFullFiscalYearStep(ledger).scopeId;
}
