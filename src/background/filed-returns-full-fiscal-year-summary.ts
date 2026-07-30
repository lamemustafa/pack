import type {
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
  FiledReturnsFullFiscalYearTargetStatus,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  filedReturnsArtifactLabel,
  normaliseFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import { filedReturnsScopeId } from "../connectors/gst/filed-returns-return-types";
import { isUnconfirmedBrowserDownloadSignal } from "./download-evidence-signals";
import {
  canCompleteFullFiscalYearLedger,
  isFullFiscalYearLedgerStale,
} from "./filed-returns-full-fiscal-year-ledger";

export function fullFiscalYearZipPhaseStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult | null {
  if (ledger.zipPhase === "cleaned") return null;
  const legacyRetained = hasLegacyRetainedStaging(ledger);
  if (ledger.zipPhase === undefined && !legacyRetained) return null;
  if (ledger.zipPhase === "restaging-required") {
    return {
      connectorId: "gst",
      scopeId: filedReturnsScopeId(ledger.scope.returnType),
      state: "blocked",
      safeSignals: [
        "full-fiscal-year-run-needs-action",
        "full-fiscal-year-restaging-required",
        "gst-portal-tab-required",
        "full-fiscal-year-opfs-retained",
      ],
      safeMessage:
        "Pack must restage the saved fiscal-year periods from the GST Portal before rebuilding the ZIP.",
    };
  }

  const downloaded = ledger.zipPhase === "downloaded-cleanup-pending";
  const downloadAmbiguous = [
    "download-intent-persisted",
    "download-observing",
    "download-started",
  ].includes(ledger.zipPhase ?? "");
  const noArtifacts = ledger.zipPhase === "no-artifacts-cleanup-pending";
  const cleanup =
    downloaded || noArtifacts || ledger.zipPhase === "legacy-cleanup-pending" || legacyRetained;
  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
    state: downloadAmbiguous ? "download-unconfirmed" : "blocked",
    safeSignals: [
      ...(cleanup
        ? ["full-fiscal-year-local-cleanup-retry"]
        : downloadAmbiguous
          ? ["full-fiscal-year-final-zip-manual-review"]
          : ["full-fiscal-year-final-zip-retry"]),
      ...(downloaded ? ["full-fiscal-year-zip-downloaded"] : []),
      ...(downloadAmbiguous
        ? ["full-fiscal-year-zip-download-started", "full-fiscal-year-zip-download-unconfirmed"]
        : []),
      ...(noArtifacts ? ["full-fiscal-year-no-zip-artifacts"] : []),
      legacyRetained
        ? "full-fiscal-year-zip-phase:legacy-cleanup-pending"
        : ledger.zipPhase === "export-pending"
          ? "full-fiscal-year-zip-export-pending"
          : `full-fiscal-year-zip-phase:${ledger.zipPhase}`,
      "full-fiscal-year-opfs-retained",
    ],
    safeMessage: cleanup
      ? "Pack retained local fiscal-year staging and can finish cleanup without reopening the GST Portal."
      : downloadAmbiguous
        ? ledger.zipPhase === "download-observing"
          ? "Pack saved the browser download ID for the final fiscal-year ZIP and must reconcile that exact download before another ZIP can start."
          : "Pack may have started the final fiscal-year ZIP before the previous run stopped. Check browser Downloads; Pack will not start another ZIP from this ambiguous state."
        : "Pack retained the prepared fiscal-year files and can retry the final ZIP without repeating portal periods.",
    ...(downloadAmbiguous
      ? {
          userAction: {
            type: "NAVIGATE_TO_SUPPORTED_PAGE" as const,
            message:
              "Check browser Downloads for the saved fiscal-year ZIP. Do not start another ZIP until this state is resolved.",
            canResume: true,
          },
        }
      : {}),
  };
}

export function hasLegacyRetainedStaging(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return (
    ledger.zipPhase === undefined &&
    ledger.status === "complete" &&
    ledger.targets.some((target) =>
      target.safeSignals.some(
        (signal) =>
          signal === "full-fiscal-year-opfs-staged" ||
          signal.startsWith("full-fiscal-year-opfs-staged:"),
      ),
    )
  );
}

const COMPLETED_SUMMARY_TARGET_STATUSES = new Set<FiledReturnsFullFiscalYearTargetStatus>([
  "downloaded",
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
  if (step.safeSignals.includes("filed-return-positively-not-filed")) {
    return "not-filed";
  }
  if (step.safeSignals.some(isUnconfirmedBrowserDownloadSignal)) {
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
  const zipPhaseStep = fullFiscalYearZipPhaseStep(ledger);
  if (zipPhaseStep) return toFullFiscalYearSummary(ledger, zipPhaseStep);
  if (ledger.status === "complete" && canCompleteFullFiscalYearLedger(ledger)) {
    return toFullFiscalYearSummary(ledger, completeFullFiscalYearStep(ledger));
  }
  if (hasRecoverableActionRequiredTarget(ledger)) {
    return toFullFiscalYearSummary(ledger, recoverableActionRequiredFullFiscalYearStep(ledger));
  }
  if (needsResumeConfirmation(ledger)) {
    return toFullFiscalYearSummary(
      ledger,
      blockedFullFiscalYearStep("full-fiscal-year-resume-confirmation-required", ledger),
    );
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
  return toFullFiscalYearSummary(ledger, recoverableActionRequiredFullFiscalYearStep(ledger));
}

export function needsResumeConfirmation(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return (
    ledger.status !== "complete" &&
    ledger.targets.some((target) => target.status === "pending") &&
    !ledger.targets.some((target) => target.status === "running")
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
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
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
    target.status === "cancelled" ||
    target.status === "manually-observed"
  );
}

function hasRecoverableActionRequiredTarget(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return ledger.targets.some((target) =>
    ["blocked", "failed", "cancelled", "download-unconfirmed", "manually-observed"].includes(
      target.status,
    ),
  );
}

export function activeFullFiscalYearStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-active"],
    safeMessage: `A full fiscal year run for FY ${ledger.scope.financialYear} is already active.`,
  };
}

export function blockedFullFiscalYearStep(
  signal: string,
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  if (signal === "full-fiscal-year-resume-confirmation-required") {
    return {
      connectorId: "gst",
      scopeId: filedReturnsScopeId(ledger.scope.returnType),
      state: "blocked",
      safeSignals: [signal],
      safeMessage:
        "Pack cannot verify which GST account owns this saved full fiscal-year run. Resume only if the same GST account is currently open; otherwise discard the saved run.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message:
          "Resume only after confirming the same GST account is open in the current GST Portal tab.",
        canResume: true,
      },
    };
  }

  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
    state: "blocked",
    safeSignals: [signal],
    safeMessage: `Pack could not start a full fiscal year run for FY ${ledger.scope.financialYear}.`,
  };
}

function recoverableActionRequiredFullFiscalYearStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  const target =
    (ledger.currentTargetId
      ? ledger.targets.find((candidate) => candidate.targetId === ledger.currentTargetId)
      : null) ?? ledger.targets.find((candidate) => candidate.status !== "pending");
  if (!target) return blockedFullFiscalYearStep("full-fiscal-year-run-needs-action", ledger);

  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
    state: "blocked",
    safeSignals: Array.from(new Set(["full-fiscal-year-run-needs-action", ...target.safeSignals])),
    safeMessage:
      target.safeMessage ||
      `Pack needs action before it can continue the FY ${ledger.scope.financialYear} run.`,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: `Resolve ${target.period}, then retry this period.`,
      canResume: true,
    },
  };
}

export function downloadUnconfirmedFullFiscalYearStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  const target = ledger.targets.find((candidate) => candidate.status === "download-unconfirmed");
  return {
    connectorId: "gst",
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-download-unconfirmed"],
    safeMessage: target
      ? `Pack could not confirm the browser download for ${target.period}. Check Downloads before retrying this period.`
      : "Pack could not confirm one browser download. Check Downloads before retrying.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: `Check browser Downloads first. Retry only if no filed ${ledger.scope.returnType} ${artifactLabel(ledger)} appeared.`,
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
    scopeId: filedReturnsScopeId(ledger.scope.returnType),
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-interrupted"],
    safeMessage: target
      ? `Pack stopped before it could confirm the result for ${target.period}. Check Downloads before starting again.`
      : `Pack stopped before it could confirm the FY ${ledger.scope.financialYear} run. Check Downloads before starting again.`,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: `Check browser Downloads first. Retry only after confirming that no duplicate filed ${ledger.scope.returnType} ${artifactLabel(ledger)} was saved.`,
      canResume: true,
    },
  };
}

function artifactLabel(ledger: FiledReturnsFullFiscalYearLedger): string {
  return filedReturnsArtifactLabel(
    normaliseFiledReturnsArtifactType(ledger.scope.returnType, ledger.scope.artifactType),
    ledger.scope.returnType,
  );
}
