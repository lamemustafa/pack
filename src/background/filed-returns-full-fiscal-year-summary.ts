import type {
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../core/contracts";
import { isFullFiscalYearLedgerStale } from "./filed-returns-full-fiscal-year-ledger";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const COMPLETED_SUMMARY_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
  "manually-observed",
  "not-filed",
]);

export function targetStatusFromFlowStep(
  step: PortalFlowStepResult,
): FiledReturnsFullFiscalYearTargetStatus {
  if (step.state === "downloaded") return "downloaded";
  if (step.state === "download-unconfirmed") return "download-unconfirmed";
  if (step.safeSignals.includes("filed-returns-target-manually-observed")) {
    return "manually-observed";
  }
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
  now = new Date(),
): FiledReturnsFlowSummary {
  if (ledger.targets.some((target) => target.status === "download-unconfirmed")) {
    return toFullFiscalYearSummary(ledger, downloadUnconfirmedFullFiscalYearStep(ledger));
  }
  if (ledger.status === "complete") {
    return toFullFiscalYearSummary(ledger, completeFullFiscalYearStep(ledger));
  }
  if (ledger.status === "running") {
    if (
      ledger.targets.some((target) => target.status === "running") &&
      isFullFiscalYearLedgerStale(ledger, now)
    ) {
      const displayLedger: FiledReturnsFullFiscalYearLedger = {
        ...ledger,
        status: "blocked",
        updatedAt: now.toISOString(),
      };
      return toFullFiscalYearSummary(displayLedger, interruptedFullFiscalYearStep(displayLedger));
    }
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
    .filter((target) => COMPLETED_SUMMARY_TARGET_STATUSES.has(target.status))
    .map((target) => target.period);
  const currentTarget = ledger.targets.find((target) => target.targetId === ledger.currentTargetId);
  const recoveryTarget =
    currentTarget && isRecoverableFullFiscalYearTarget(currentTarget)
      ? currentTarget
      : ledger.targets.find(isRecoverableFullFiscalYearTarget);
  return {
    scope: ledger.scope,
    status: ledger.status,
    completedPeriods,
    totalPeriods: ledger.targets.length,
    updatedAt: ledger.updatedAt,
    ...(ledger.status === "complete" ? { completedAt: ledger.updatedAt } : {}),
    ...(recoveryTarget ? { currentPeriod: recoveryTarget.period } : {}),
    ...(recoveryTarget
      ? {
          fullFiscalYearRecovery: {
            ledgerId: ledger.ledgerId,
            targetId: recoveryTarget.targetId,
            expectedRevision: ledger.revision ?? 1,
            targetStatus: recoveryTarget.status,
          },
        }
      : {}),
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

function isRecoverableFullFiscalYearTarget(target: FiledReturnsFullFiscalYearTarget): boolean {
  return (
    target.status === "pending" ||
    target.status === "download-unconfirmed" ||
    target.status === "running" ||
    target.status === "blocked" ||
    target.status === "failed" ||
    target.status === "cancelled"
  );
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

export function downloadUnconfirmedFullFiscalYearStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  const target = ledger.targets.find((candidate) => candidate.status === "download-unconfirmed");
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-download-unconfirmed"],
    safeMessage: target
      ? `Pack could not confirm the browser download for ${target.period}. Check Downloads before retrying this period.`
      : "Pack could not confirm one browser download. Check Downloads before retrying.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Check Chrome Downloads first. Retry only if no filed GSTR-3B PDF appeared.",
      canResume: true,
    },
  };
}

export function interruptedFullFiscalYearStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  const target = ledger.targets.find((candidate) => candidate.status === "running");
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-interrupted"],
    safeMessage: target
      ? `Pack stopped before it could confirm the result for ${target.period}. Check Downloads before starting again.`
      : `Pack stopped before it could confirm the FY ${ledger.scope.financialYear} run. Check Downloads before starting again.`,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message:
        "Check Chrome Downloads first. Retry only after confirming that no duplicate filed GSTR-3B PDF was saved.",
      canResume: true,
    },
  };
}
