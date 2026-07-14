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
  return {
    ledger: markFullFiscalYearCleanupPending(ledger, new Date(ledger.updatedAt)),
    step: {
      ...zipStep,
      state: "blocked",
      safeSignals: Array.from(
        new Set([
          ...zipStep.safeSignals,
          "full-fiscal-year-final-zip-retry",
          "full-fiscal-year-zip-cleanup-pending",
          "full-fiscal-year-opfs-retained",
        ]),
      ),
      safeMessage:
        "Pack downloaded the final fiscal-year ZIP and is clearing its temporary local staging.",
    },
  };
}

export function markFullFiscalYearCleanupPending(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  const cleanupPendingLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    revision: (ledger.revision ?? 1) + 1,
    status: "blocked",
    updatedAt: now.toISOString(),
    zipPhase: "downloaded-cleanup-pending",
  };
  delete cleanupPendingLedger.currentTargetId;
  return cleanupPendingLedger;
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
      "full-fiscal-year-final-zip-retry",
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
  return {
    connectorId: "gst",
    scopeId: stepScopeId(ledger),
    state: "blocked",
    safeSignals: [
      "full-fiscal-year-final-zip-retry",
      "full-fiscal-year-zip-downloaded",
      "full-fiscal-year-zip-cleanup-pending",
      clearSignal,
      "full-fiscal-year-opfs-retained",
    ],
    safeMessage:
      "Pack downloaded the final fiscal-year ZIP but could not clear its retained local staging. Retry the local cleanup before starting another full-year run.",
  };
}

function fullFiscalYearCleanupCompletedStep(
  ledger: FiledReturnsFullFiscalYearLedger,
  clearSignal: string,
): PortalFlowStepResult {
  const availabilitySignals = ledger.targets.flatMap((target) =>
    target.safeSignals.filter((signal) => signal.startsWith("filed-return-artifact-unavailable:")),
  );
  return {
    ...completeFullFiscalYearStep(ledger),
    safeSignals: Array.from(
      new Set([
        "full-fiscal-year-complete",
        "full-fiscal-year-zip-downloaded",
        clearSignal,
        ...availabilitySignals,
      ]),
    ),
  };
}

function stepScopeId(ledger: FiledReturnsFullFiscalYearLedger): string {
  return completeFullFiscalYearStep(ledger).scopeId;
}
