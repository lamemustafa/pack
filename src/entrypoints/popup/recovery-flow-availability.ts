import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";
import { isFullFiscalYearScope } from "../../connectors/gst/filed-returns-scope";
import { hasUnresolvedFiledReturnsRecovery } from "./flow-summary";

/**
 * The recovery controls and every explanation of them share this model. A packaged build can
 * meet saved full-year state created by an earlier build, but it must not describe resuming or
 * restarting that flow after withholding the controls that would perform it.
 */
export type RecoveryFlowAction =
  "cancel-saved-full-year-run" | "continue-saved-full-year-run" | "start-another-download";

export interface RecoveryFlowAvailability {
  availableActions: readonly RecoveryFlowAction[];
  canContinueFullYear: boolean;
  guidance: string | null;
  isWithheldFullYearRecovery: boolean;
  message: string | null;
  mentionedActions: readonly RecoveryFlowAction[];
}

const AVAILABLE_FULL_YEAR_ACTIONS: readonly RecoveryFlowAction[] = [
  "continue-saved-full-year-run",
  "start-another-download",
  "cancel-saved-full-year-run",
];

const WITHHELD_FULL_YEAR_MESSAGE =
  "Pack cannot continue this saved full-year run in this build. Cancel the saved run below.";

/**
 * Derives both recovery availability and its copy from the same build capability. `mentionedActions`
 * is deliberately semantic rather than text-matched: tests assert that no explanation names an
 * action outside `availableActions`, so moving a gate cannot leave stale guidance behind.
 */
export function getRecoveryFlowAvailability(
  summary: FiledReturnsFlowSummary | null | undefined,
  fullYearFlowAvailable: boolean,
  hasSavedFullYearRun = false,
): RecoveryFlowAvailability {
  const isWithheldFullYearRecovery = Boolean(
    !fullYearFlowAvailable &&
    summary &&
    isFullFiscalYearScope(summary.scope) &&
    (hasUnresolvedFiledReturnsRecovery(summary) || hasSavedFullYearRun),
  );
  if (isWithheldFullYearRecovery) {
    const targetStatus = summary?.fullFiscalYearRecovery?.targetStatus;
    const actionGuidanceIsWithheld =
      targetStatus === "blocked" ||
      targetStatus === "download-unconfirmed" ||
      targetStatus === "failed" ||
      summary?.flowStep.safeSignals.includes("filed-returns-target-review-required") === true ||
      summary?.flowStep.safeSignals.includes("artifact-acquisition-session-proof-expired") === true;
    return {
      availableActions: ["cancel-saved-full-year-run"],
      canContinueFullYear: false,
      guidance: WITHHELD_FULL_YEAR_MESSAGE,
      isWithheldFullYearRecovery: true,
      message: actionGuidanceIsWithheld
        ? WITHHELD_FULL_YEAR_MESSAGE
        : summary!.flowStep.safeMessage,
      mentionedActions: ["cancel-saved-full-year-run"],
    };
  }

  if (!summary) {
    return {
      availableActions: [],
      canContinueFullYear: fullYearFlowAvailable,
      guidance: null,
      isWithheldFullYearRecovery: false,
      message: null,
      mentionedActions: [],
    };
  }

  if (summary.flowStep.safeSignals.includes("artifact-acquisition-session-proof-expired")) {
    return {
      availableActions: AVAILABLE_FULL_YEAR_ACTIONS,
      canContinueFullYear: fullYearFlowAvailable,
      guidance: null,
      isWithheldFullYearRecovery: false,
      message:
        "The extension reload cleared Pack's temporary exact-download proof. Check Browser Downloads, then start fresh or cancel and reset.",
      mentionedActions: ["start-another-download", "cancel-saved-full-year-run"],
    };
  }

  return {
    availableActions: AVAILABLE_FULL_YEAR_ACTIONS,
    canContinueFullYear: fullYearFlowAvailable,
    guidance: null,
    isWithheldFullYearRecovery: false,
    message: summary.flowStep.safeMessage,
    mentionedActions: AVAILABLE_FULL_YEAR_ACTIONS,
  };
}
