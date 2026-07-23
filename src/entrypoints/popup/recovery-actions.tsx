import * as React from "react";
import type { FiledReturnsFlowSummary } from "../../core/contracts";

export interface RecoveryActionsProps {
  busy: string | null;
  portalReady: boolean;
  summary: FiledReturnsFlowSummary | null;
  onAcknowledgeInterruptedRun: () => void;
  onRetryFullFiscalYearTarget: (confirmCurrentPortalAccount?: boolean) => void;
  onRetryTarget: (mode?: "direct-download" | "portal-click") => void;
  onResolveFullFiscalYearTarget: (resolution: "manually-observed" | "cancelled") => void;
  onResolveTarget: (resolution: "manually-observed" | "cancelled") => void;
  onStartFresh: () => void;
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
}: RecoveryActionsProps) {
  const [currentPortalAccountConfirmed, setCurrentPortalAccountConfirmed] = React.useState(false);
  const recoveryState = getRecoveryActionState(summary);
  if (!summary || !recoveryState.visible) return null;
  const {
    needsActionJournalReview,
    needsFullFiscalYearReview,
    needsRunReview,
    needsTargetReview,
    runActive,
    signals,
  } = recoveryState;
  const canManuallyObserveFullYear = canManuallyObserveFullFiscalYearTarget(summary);
  const canManuallyResolveTarget =
    !signals.has("single-period-zip-incomplete") &&
    !signals.has("filed-returns-target-manually-observed");
  const retryDisabled = busy !== null || !portalReady;
  const fullFiscalYearPaused = signals.has("full-fiscal-year-temporarily-paused");
  const needsResumeConfirmation = signals.has("full-fiscal-year-resume-confirmation-required");
  const supportsPortalClickFallback = signals.has(
    "filed-returns-target-review-portal-click-available",
  );
  const supportsDirectDownloadFallback = signals.has(
    "filed-returns-target-review-direct-download-available",
  );
  return (
    <details className="recovery-details" open>
      <summary>Saved run options</summary>
      <div className="recovery-details-content" aria-label="Filed return recovery actions">
        {runActive ? (
          <>
            <button type="button" disabled>
              Run in progress
            </button>
            <p className="muted">
              Retry controls appear automatically if the run stops making progress.
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
            <p className="muted">Why Pack paused: {summary.flowStep.safeMessage}</p>
            {!portalReady ? (
              <p className="muted">Open a signed-in GST Portal tab before retrying this period.</p>
            ) : null}
            {supportsPortalClickFallback ? (
              <p className="muted">
                Pack could not capture the portal-generated file automatically. A native portal
                download may use the browser's own filename and location because Pack cannot safely
                rename an uncorrelated portal file.
              </p>
            ) : null}
            {supportsDirectDownloadFallback ? (
              <button
                type="button"
                disabled={retryDisabled}
                onClick={() => onRetryTarget("direct-download")}
              >
                {busy === "retry-filed-returns-target" ? "Retrying..." : "Try Pack download"}
              </button>
            ) : null}
            <button
              type="button"
              className={supportsDirectDownloadFallback ? "secondary" : undefined}
              disabled={retryDisabled}
              onClick={() =>
                onRetryTarget(supportsPortalClickFallback ? "portal-click" : undefined)
              }
            >
              {busy === "retry-filed-returns-target"
                ? "Retrying..."
                : supportsPortalClickFallback
                  ? "Download through GST Portal"
                  : "Retry this period"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={retryDisabled}
              onClick={onStartFresh}
            >
              {busy === "start-fresh-filed-returns-flow"
                ? "Starting fresh..."
                : "Discard saved state and start selected download"}
            </button>
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
        {needsActionJournalReview ? (
          summary.actionJournalRecovery ? (
            <>
              <p className="muted">
                Pack could not confirm the previous browser action. Review browser Downloads before
                discarding it. Discarding does not mark the return as downloaded.
              </p>
              <button
                type="button"
                className="secondary"
                disabled={retryDisabled}
                onClick={onStartFresh}
              >
                {busy === "start-fresh-filed-returns-flow"
                  ? "Discarding paused action..."
                  : "Discard paused action"}
              </button>
            </>
          ) : (
            <p className="muted">
              Pack found more than one paused browser action and cannot safely choose one to
              discard. Choose Plan another archive, then select the exact single-period PDF or
              Excel download to expose its recovery control.
            </p>
          )
        ) : null}
        {needsFullFiscalYearReview ? (
          <>
            <p className="muted">Why Pack paused: {summary.flowStep.safeMessage}</p>
            {fullFiscalYearPaused ? (
              <p className="muted">
                This saved run is retained locally for inspection or discard. Pack will not retry,
                export, or manually complete it in this version.
              </p>
            ) : null}
            {needsResumeConfirmation ? (
              <label className="recovery-confirmation">
                <input
                  type="checkbox"
                  checked={currentPortalAccountConfirmed}
                  disabled={busy !== null || fullFiscalYearPaused}
                  onChange={(event) =>
                    setCurrentPortalAccountConfirmed(event.currentTarget.checked)
                  }
                />
                <span>
                  I confirm the intended GST account is open in this GST Portal tab. Pack does not
                  retain or verify account identity.
                </span>
              </label>
            ) : null}
            {!portalReady && !fullFiscalYearPaused ? (
              <p className="muted">Open a signed-in GST Portal tab before retrying this period.</p>
            ) : null}
            {!fullFiscalYearPaused ? (
              <button
                type="button"
                disabled={
                  retryDisabled || (needsResumeConfirmation && !currentPortalAccountConfirmed)
                }
                onClick={() => onRetryFullFiscalYearTarget(currentPortalAccountConfirmed)}
              >
                {busy === "retry-full-fiscal-year-target"
                  ? "Retrying..."
                  : retryFullYearLabel(summary)}
              </button>
            ) : null}
            {!fullFiscalYearPaused ? (
              <button
                type="button"
                className="secondary"
                disabled={retryDisabled}
                onClick={onStartFresh}
              >
                {busy === "start-fresh-filed-returns-flow"
                  ? "Starting fresh..."
                  : "Discard saved run and start selected download"}
              </button>
            ) : null}
            {canManuallyObserveFullYear && !fullFiscalYearPaused ? (
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
        {!portalReady ? (
          <p className="muted">Open a signed-in GST Portal tab before retrying.</p>
        ) : null}
      </div>
    </details>
  );
}

export function hasRecoveryActions(summary: FiledReturnsFlowSummary | null): boolean {
  return getRecoveryActionState(summary).visible;
}

export function canManuallyObserveFullFiscalYearTarget(
  summary: FiledReturnsFlowSummary | null,
): boolean {
  return summary?.fullFiscalYearRecovery?.targetStatus === "download-unconfirmed";
}

function retryFullYearLabel(summary: FiledReturnsFlowSummary): string {
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-resume-confirmation-required")) {
    return "Resume saved run";
  }
  return summary.fullFiscalYearRecovery?.targetStatus === "pending"
    ? "Resume saved period"
    : "Retry this period";
}

function cancelFullYearLabel(summary: FiledReturnsFlowSummary): string {
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-resume-confirmation-required")) {
    return "Discard saved run";
  }
  return "Cancel and reset";
}

function getRecoveryActionState(summary: FiledReturnsFlowSummary | null): {
  needsActionJournalReview: boolean;
  needsFullFiscalYearReview: boolean;
  needsRunReview: boolean;
  needsTargetReview: boolean;
  runActive: boolean;
  signals: Set<string>;
  visible: boolean;
} {
  const signals = new Set(summary?.flowStep.safeSignals ?? []);
  const needsRunReview = signals.has("filed-returns-run-needs-review");
  const needsActionJournalReview = signals.has("filed-returns-action-journal-review-required");
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
    needsActionJournalReview,
    needsRunReview,
    needsTargetReview,
    runActive,
    signals,
    visible:
      needsRunReview ||
      needsActionJournalReview ||
      needsTargetReview ||
      needsFullFiscalYearReview ||
      runActive,
  };
}
