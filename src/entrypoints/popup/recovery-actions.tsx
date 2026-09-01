import React from "react";
import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";
import { canRetryFiledReturnsTargetWithoutPortal } from "./flow-summary";
import { getRecoveryFlowAvailability } from "./recovery-flow-availability";
import {
  canReconcileFiledReturnsTarget,
  DiagnosticSignals,
  hasDiagnosticSignals,
} from "./run-summary";

export interface RecoveryActionsProps {
  busy: string | null;
  portalReady: boolean;
  summary: FiledReturnsFlowSummary | null;
  onAcknowledgeInterruptedRun: () => void;
  onRetryFullFiscalYearTarget: () => void;
  onRetryTarget: () => void;
  onResolveFullFiscalYearTarget: (resolution: "manually-observed" | "cancelled") => void;
  onResolveTarget: (resolution: "manually-observed" | "cancelled") => void;
  onStartFresh: () => void;
  collapsed?: boolean;
  showPortalRetryReason?: boolean;
  /**
   * Whether this build may run a full fiscal year at all.
   *
   * A packaged build that withholds the full-year surface can still meet a ledger persisted by
   * an earlier release, and the controls below would happily resume or restart it -- so the
   * capability would be reachable through recovery after being withheld everywhere else.
   *
   * Gating cannot simply hide the whole block: that would strand the reader with a saved run
   * they can see and cannot dismiss. Only the two controls that re-enter the flow are
   * withheld; cancelling and recording an observation stay, because both are local and are the
   * way out.
   */
  fullYearFlowAvailable?: boolean;
}

export function RecoveryActions({
  busy,
  portalReady,
  summary,
  onAcknowledgeInterruptedRun,
  onRetryFullFiscalYearTarget,
  onRetryTarget,
  onResolveFullFiscalYearTarget,
  onResolveTarget,
  onStartFresh,
  collapsed = false,
  showPortalRetryReason = true,
  fullYearFlowAvailable = true,
}: RecoveryActionsProps) {
  const [moreOpen, setMoreOpen] = React.useState(!collapsed);
  const recoveryState = getRecoveryActionState(summary);
  if (!summary || !recoveryState.visible) return null;
  const recoveryAvailability = getRecoveryFlowAvailability(summary, fullYearFlowAvailable);
  const { needsFullFiscalYearReview, needsRunReview, needsTargetReview, runActive, signals } =
    recoveryState;
  const canManuallyObserveFullYear =
    summary.fullFiscalYearRecovery?.targetStatus === "download-unconfirmed";
  const canManuallyResolveTarget =
    !signals.has("single-period-zip-incomplete") &&
    !signals.has("filed-returns-target-manually-observed");
  const canReconcileTarget = canReconcileFiledReturnsTarget(summary);
  const canRetryTargetCleanup = signals.has("filed-returns-target-local-cleanup-required");
  const fullYearTargetReviewUnavailable =
    needsTargetReview && recoveryAvailability.isWithheldFullYearRecovery;
  const retryDisabled = busy !== null || !portalReady;
  // Reconciling the browser download and retrying local cleanup both return locally in
  // retryFiledReturnsTargetDownloadFlow before any portal action, so they must not require
  // portalReady. Every other retry here (full-year retry, start fresh) does reach the portal.
  const targetRetryDisabled = canRetryFiledReturnsTargetWithoutPortal(summary)
    ? busy !== null
    : retryDisabled;
  const portalDisabledReason =
    !portalReady &&
    showPortalRetryReason &&
    !(needsFullFiscalYearReview && !fullYearFlowAvailable) &&
    !fullYearTargetReviewUnavailable
      ? recoveryPortalDisabledReason(summary, {
          needsFullFiscalYearReview,
          needsTargetReview,
        })
      : null;
  return (
    <details
      className="recovery-details"
      open={moreOpen}
      onToggle={(event) => setMoreOpen(event.currentTarget.open)}
    >
      <summary>{collapsed ? "Recovery options" : "Saved run options"}</summary>
      {moreOpen ? (
        <div
          className="recovery-details-content"
          role="group"
          aria-label="Filed return recovery actions"
        >
          {runActive ? (
            <>
              <button type="button" disabled aria-describedby="recovery-run-active-reason">
                Run in progress
              </button>
              <p className="muted" id="recovery-run-active-reason">
                {recoveryAvailability.isWithheldFullYearRecovery
                  ? recoveryAvailability.guidance
                  : "Retry controls appear automatically if the run stops making progress."}
              </p>
            </>
          ) : null}
          {needsRunReview ? (
            <button
              type="button"
              className="secondary"
              disabled={busy !== null}
              onClick={onAcknowledgeInterruptedRun}
            >
              {busy === "acknowledge-interrupted-run" ? "Resetting..." : "Reset stuck run"}
            </button>
          ) : null}
          {needsTargetReview ? (
            <>
              <p className="muted">
                Why Pack paused: {targetReviewRecoveryMessage(recoveryAvailability)}
              </p>
              {hasDiagnosticSignals(summary) ? (
                <details className="diagnostic-details">
                  <summary>Safe diagnostics</summary>
                  <DiagnosticSignals summary={summary} />
                </details>
              ) : null}
              {canReconcileTarget || canRetryTargetCleanup ? (
                <button
                  type="button"
                  className={collapsed ? "secondary" : undefined}
                  disabled={targetRetryDisabled}
                  onClick={onRetryTarget}
                >
                  {busy === "retry-filed-returns-target"
                    ? canReconcileTarget
                      ? "Reconciling..."
                      : "Cleaning up..."
                    : canReconcileTarget
                      ? "Reconcile browser download"
                      : "Retry local cleanup"}
                </button>
              ) : null}
              {fullYearTargetReviewUnavailable ? (
                <p className="muted">{recoveryAvailability.guidance}</p>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={retryDisabled}
                  aria-describedby={
                    portalDisabledReason ? "recovery-portal-disabled-reason" : undefined
                  }
                  onClick={onStartFresh}
                >
                  {busy === "start-fresh-filed-returns-flow"
                    ? "Starting fresh..."
                    : "Discard saved state and start selected download"}
                </button>
              )}
              {canManuallyResolveTarget ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy !== null}
                  onClick={() => onResolveTarget("manually-observed")}
                >
                  {busy === "resolve-unconfirmed-download"
                    ? "Saving..."
                    : "Record manual observation"}
                </button>
              ) : null}
              {signals.has("filed-returns-target-manually-observed") ? (
                <p className="muted">
                  Manual observation recorded. It does not complete this target.
                </p>
              ) : null}
              <button
                type="button"
                className="secondary"
                disabled={busy !== null}
                onClick={() => onResolveTarget("cancelled")}
              >
                {busy === "cancel-unconfirmed-download" ? "Cancelling..." : "Cancel and reset"}
              </button>
            </>
          ) : null}
          {needsFullFiscalYearReview ? (
            <>
              <p className="muted">Why Pack paused: {recoveryAvailability.message}</p>
              {fullYearFlowAvailable &&
              recoveryAvailability.canContinueFullYear &&
              signals.has("full-fiscal-year-resume-confirmation-required") ? (
                <p className="muted">
                  This saved run is not bound to a GST account. Continue only if the same GST
                  account is currently open.
                </p>
              ) : null}
              {recoveryAvailability.canContinueFullYear ? (
                <>
                  <button
                    type="button"
                    className={collapsed ? "secondary" : undefined}
                    disabled={retryDisabled}
                    aria-describedby={
                      portalDisabledReason ? "recovery-portal-disabled-reason" : undefined
                    }
                    onClick={onRetryFullFiscalYearTarget}
                  >
                    {busy === "retry-full-fiscal-year-target"
                      ? "Retrying..."
                      : getSavedFullFiscalYearActionDecision(summary).label}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={retryDisabled}
                    aria-describedby={
                      portalDisabledReason ? "recovery-portal-disabled-reason" : undefined
                    }
                    onClick={onStartFresh}
                  >
                    {busy === "start-fresh-filed-returns-flow"
                      ? "Starting fresh..."
                      : "Discard saved run and start selected download"}
                  </button>
                </>
              ) : (
                <p className="muted">{recoveryAvailability.guidance}</p>
              )}
              {canManuallyObserveFullYear ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy !== null}
                  onClick={() => onResolveFullFiscalYearTarget("manually-observed")}
                >
                  {busy === "resolve-full-fiscal-year-target"
                    ? "Saving..."
                    : "Mark as manually observed"}
                </button>
              ) : null}
              <button
                type="button"
                className="secondary"
                disabled={busy !== null}
                onClick={() => onResolveFullFiscalYearTarget("cancelled")}
              >
                {busy === "cancel-full-fiscal-year-target"
                  ? "Cancelling..."
                  : cancelFullYearLabel(summary)}
              </button>
            </>
          ) : null}
          {portalDisabledReason ? (
            <p className="muted" id="recovery-portal-disabled-reason">
              {portalDisabledReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

/**
 * Only "Discard saved state and start selected download" is portal-gated within target
 * review — reconciling the browser download and retrying local cleanup are not (see
 * `canRetryFiledReturnsTargetWithoutPortal` in ./flow-summary), so this reason always refers
 * to starting again.
 */
export function targetReviewPortalDisabledReason(): string {
  return "Open a signed-in GST Portal tab before starting again.";
}

export function getSavedFullFiscalYearActionDecision(summary: FiledReturnsFlowSummary): {
  gerund: string;
  label: string;
} {
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-resume-confirmation-required")) {
    return { label: "Resume saved run", gerund: "resuming the saved run" };
  }
  if (summary.fullFiscalYearRecovery?.targetStatus === "pending") {
    return { label: "Resume saved period", gerund: "resuming the saved period" };
  }
  return summary.currentPeriod
    ? { label: `Retry ${summary.currentPeriod}`, gerund: `retrying ${summary.currentPeriod}` }
    : { label: "Retry this period", gerund: "retrying this period" };
}

function recoveryPortalDisabledReason(
  summary: FiledReturnsFlowSummary,
  {
    needsFullFiscalYearReview,
    needsTargetReview,
  }: {
    needsFullFiscalYearReview: boolean;
    needsTargetReview: boolean;
  },
): string | null {
  if (needsTargetReview) return targetReviewPortalDisabledReason();
  if (!needsFullFiscalYearReview) return null;
  const { gerund } = getSavedFullFiscalYearActionDecision(summary);
  return `Open a signed-in GST Portal tab before ${gerund} or starting again.`;
}

function targetReviewRecoveryMessage({
  message,
}: ReturnType<typeof getRecoveryFlowAvailability>): string {
  return message ?? "Pack needs a saved-run review.";
}

export function hasRecoveryActions(summary: FiledReturnsFlowSummary | null): boolean {
  return getRecoveryActionState(summary).visible;
}

function cancelFullYearLabel(summary: FiledReturnsFlowSummary): string {
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-resume-confirmation-required")) {
    return "Discard saved run";
  }
  return "Cancel and reset";
}

function getRecoveryActionState(summary: FiledReturnsFlowSummary | null): {
  needsFullFiscalYearReview: boolean;
  needsRunReview: boolean;
  needsTargetReview: boolean;
  runActive: boolean;
  signals: Set<string>;
  visible: boolean;
} {
  const signals = new Set(summary?.flowStep.safeSignals ?? []);
  const needsRunReview = signals.has("filed-returns-run-needs-review");
  const needsTargetReview = signals.has("filed-returns-target-review-required");
  const runActive =
    signals.has("filed-returns-run-active") || signals.has("full-fiscal-year-run-active");
  const needsResumeConfirmation = signals.has("full-fiscal-year-resume-confirmation-required");
  const needsFullFiscalYearReview =
    Boolean(summary?.fullFiscalYearRecovery) &&
    (summary?.status !== "running" || needsResumeConfirmation) &&
    !runActive;
  return {
    needsFullFiscalYearReview,
    needsRunReview,
    needsTargetReview,
    runActive,
    signals,
    visible: needsRunReview || needsTargetReview || needsFullFiscalYearReview || runActive,
  };
}
