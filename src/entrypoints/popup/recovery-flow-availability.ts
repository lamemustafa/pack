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

/**
 * Drops the sentences that name an unavailable action and keeps the rest, appending the withheld
 * guidance. Whole-message replacement lost diagnostic clauses that were still true and still
 * needed -- the download check before a retry being the one that matters.
 */
function withheldRemedyReplaced(message: string | null): string {
  if (!message) return WITHHELD_FULL_YEAR_MESSAGE;
  // Only continuing the saved full-year run is withheld. Starting a download is not: a packaged
  // build still offers single-period downloads, and "check Downloads before starting again" is a
  // safety instruction rather than an offer of an unavailable control.
  const withheld: readonly RecoveryFlowAction[] = ["continue-saved-full-year-run"];
  const kept = message
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !actionsNamedIn(sentence).some((action) => withheld.includes(action)))
    .join(" ")
    .trim();
  return kept ? `${kept} ${WITHHELD_FULL_YEAR_MESSAGE}` : WITHHELD_FULL_YEAR_MESSAGE;
}

/**
 * Which actions a message actually tells the reader to take.
 *
 * `mentionedActions` used to be asserted by hand at each return, which made the invariant it
 * exists for -- no explanation naming an action the build will not perform -- self-certified and
 * therefore vacuous: the withheld branch returned `["cancel-saved-full-year-run"]` regardless of
 * what the message beside it said, so a durable message telling the reader to retry passed the
 * check that was meant to catch exactly that.
 *
 * Reading the message is coarser than a structured field, and it is the only thing that cannot
 * disagree with what the reader sees.
 */
function actionsNamedIn(message: string | null): readonly RecoveryFlowAction[] {
  if (!message) return [];
  // "cannot continue" tells the reader an action is unavailable; counting it as naming that action
  // would make every withheld message fail its own check. Negated forms are dropped before the
  // scan rather than special-cased after it.
  const text = message
    .toLowerCase()
    .replace(
      /\b(?:cannot|can't|will not|won't|does not|doesn't|is not|isn't|no longer)\s+\w+/g,
      " ",
    );
  const named: RecoveryFlowAction[] = [];
  if (/\bretry\b|\bretrying\b|\bresume\b|\bcontinue\b|\btry again\b/.test(text)) {
    named.push("continue-saved-full-year-run");
  }
  if (/\bcancel\b|\bdiscard\b|\bremove\b/.test(text)) named.push("cancel-saved-full-year-run");
  if (/\bstart\b/.test(text)) named.push("start-another-download");
  return named;
}

const ACTIVE_WITHHELD_FULL_YEAR_MESSAGE =
  "A saved full-year run is still in progress in this browser profile.";

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
    // An active run offers nothing to cancel: `RecoveryActions` takes its `runActive` path, which
    // renders a disabled "Run in progress" and no cancellation at all. Promising a cancel control
    // there is the same defect as promising a retry -- copy naming an action the surface withholds.
    const runIsActive =
      summary?.flowStep.safeSignals.includes("full-fiscal-year-run-active") === true ||
      summary?.flowStep.safeSignals.includes("filed-returns-run-active") === true;
    if (runIsActive) {
      return {
        availableActions: [],
        canContinueFullYear: false,
        guidance: ACTIVE_WITHHELD_FULL_YEAR_MESSAGE,
        isWithheldFullYearRecovery: true,
        message: ACTIVE_WITHHELD_FULL_YEAR_MESSAGE,
        mentionedActions: actionsNamedIn(ACTIVE_WITHHELD_FULL_YEAR_MESSAGE),
      };
    }
    const targetStatus = summary?.fullFiscalYearRecovery?.targetStatus;
    const actionGuidanceIsWithheld =
      targetStatus === "blocked" ||
      targetStatus === "download-unconfirmed" ||
      targetStatus === "failed" ||
      summary?.flowStep.safeSignals.includes("filed-returns-target-review-required") === true ||
      summary?.flowStep.safeSignals.includes("full-fiscal-year-resume-confirmation-required") ===
        true ||
      summary?.flowStep.safeSignals.includes("artifact-acquisition-session-proof-expired") === true;
    // Fail closed on the message as well as the controls. The status list above cannot be
    // exhaustive -- `manually-observed` was missing from it, and its durable message tells the
    // reader to retry or cancel while retry is hidden -- so any durable message that names an
    // action this build withholds is replaced rather than shown.
    const durableMessage = summary!.flowStep.safeMessage;
    const withheldActions: readonly RecoveryFlowAction[] = ["continue-saved-full-year-run"];
    const durableMessageNamesWithheldAction = actionsNamedIn(durableMessage).some((action) =>
      withheldActions.includes(action),
    );
    // Replace only the clause that names an unavailable remedy, never the whole message. An
    // interrupted run's durable message says to check browser Downloads before starting again, and
    // discarding that sentence with the remedy let the reader dismiss the evidence and start a
    // second run without the check -- trading a false remedy for a missing safety instruction.
    const message = actionGuidanceIsWithheld
      ? WITHHELD_FULL_YEAR_MESSAGE
      : durableMessageNamesWithheldAction
        ? withheldRemedyReplaced(durableMessage)
        : durableMessage;
    return {
      availableActions: ["cancel-saved-full-year-run"],
      canContinueFullYear: false,
      guidance: WITHHELD_FULL_YEAR_MESSAGE,
      isWithheldFullYearRecovery: true,
      message,
      mentionedActions: actionsNamedIn(message),
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
