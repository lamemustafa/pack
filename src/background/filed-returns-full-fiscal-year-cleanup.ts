import type { FiledReturnsFullFiscalYearLedger, PortalFlowStepResult } from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import { completeFullFiscalYearLedger } from "./filed-returns-full-fiscal-year-ledger";
import { persistLedgerAndSummary } from "./filed-returns-full-fiscal-year-run-state";
import {
  completeFullFiscalYearStep,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-summary";
import { discardFullFiscalYearFiledReturnsZip } from "./filed-returns-full-fiscal-year-zip";

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

export function markFullFiscalYearCleanupPending(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  zipPhase:
    | "downloaded-cleanup-pending"
    | "no-artifacts-cleanup-pending"
    | "legacy-cleanup-pending" = "downloaded-cleanup-pending",
): FiledReturnsFullFiscalYearLedger {
  const cleanupPendingLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: now.toISOString(),
    zipPhase,
  };
  delete cleanupPendingLedger.currentTargetId;
  return cleanupPendingLedger;
}

export function markFullFiscalYearExportPhase(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  zipPhase: "export-pending" | "export-retry-pending",
): FiledReturnsFullFiscalYearLedger {
  const exportLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: now.toISOString(),
    zipPhase,
  };
  delete exportLedger.currentTargetId;
  return exportLedger;
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
            new Set([...target.safeSignals, "full-fiscal-year-restaging-required"]),
          ),
          safeMessage: `Pack needs to restage ${target.period} before rebuilding the fiscal-year ZIP.`,
          updatedAt: timestamp,
        },
  );
  const currentTarget = targets.find((target) => target.status === "blocked");
  return {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: timestamp,
    zipPhase: "restaging-required",
    targets,
    ...(currentTarget ? { currentTargetId: currentTarget.targetId } : {}),
  };
}

export async function finishFullFiscalYearCleanup(
  deps: FiledReturnsFlowRunnerDeps,
  cleanupPendingLedger: FiledReturnsFullFiscalYearLedger,
): Promise<PackMessageResponse> {
  const clearSignal = await discardFullFiscalYearFiledReturnsZip(cleanupPendingLedger.ledgerId);
  if (clearSignal !== "full-fiscal-year-opfs-cleared") {
    const step = fullFiscalYearCleanupFailedStep(cleanupPendingLedger, clearSignal);
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
  const step = fullFiscalYearCleanupCompletedStep(cleanupPendingLedger, clearSignal);
  await persistLedgerAndSummary(deps, completedLedger, step);
  return {
    ok: true,
    flowStep: step,
    flowSummary: toFullFiscalYearSummary(completedLedger, step),
  };
}

export function completedRunCleanupBlockedStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: stepScopeId(ledger),
    state: "blocked",
    safeSignals: [
      "full-fiscal-year-local-cleanup-retry",
      "full-fiscal-year-completed-staging-cleanup-failed",
      "full-fiscal-year-zip-cleanup-pending",
      "full-fiscal-year-opfs-clear-failed",
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
  clearSignal: string,
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
      "full-fiscal-year-zip-cleanup-pending",
      clearSignal,
      "full-fiscal-year-opfs-retained",
    ],
    safeMessage: noArtifacts
      ? "Pack found no fiscal-year artifacts to export but could not clear its retained local staging. Retry the local cleanup before starting another full-year run."
      : zipDownloaded
        ? "Pack downloaded the final fiscal-year ZIP but could not clear its retained local staging. Retry the local cleanup before starting another full-year run."
        : "Pack could not clear retained local fiscal-year staging. Retry the local cleanup before starting another full-year run.",
  };
}

function fullFiscalYearCleanupCompletedStep(
  ledger: FiledReturnsFullFiscalYearLedger,
  clearSignal: string,
): PortalFlowStepResult {
  const zipDownloaded = ledger.zipPhase === "downloaded-cleanup-pending";
  const noArtifacts = ledger.zipPhase === "no-artifacts-cleanup-pending";
  const availabilitySignals = ledger.targets.flatMap((target) =>
    target.safeSignals.filter((signal) => signal.startsWith("filed-return-artifact-unavailable:")),
  );
  return {
    ...completeFullFiscalYearStep(ledger),
    safeSignals: Array.from(
      new Set([
        "full-fiscal-year-complete",
        ...(zipDownloaded ? ["full-fiscal-year-zip-downloaded"] : []),
        ...(noArtifacts ? ["full-fiscal-year-no-zip-artifacts"] : []),
        clearSignal,
        ...availabilitySignals,
      ]),
    ),
  };
}

function stepScopeId(ledger: FiledReturnsFullFiscalYearLedger): string {
  return completeFullFiscalYearStep(ledger).scopeId;
}
