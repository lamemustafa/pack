import type { FiledReturnsFlowSummary } from "../../core/contracts";

export interface RecoveryActionsProps {
  busy: string | null;
  portalReady: boolean;
  summary: FiledReturnsFlowSummary | null;
  onAcknowledgeInterruptedRun: () => void;
  onRetryFullFiscalYearTarget: () => void;
  onRetryTarget: () => void;
  onResolveFullFiscalYearTarget: (resolution: "manually-observed" | "cancelled") => void;
  onResolveTarget: (resolution: "downloaded" | "cancelled") => void;
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
}: RecoveryActionsProps) {
  const recoveryState = getRecoveryActionState(summary);
  if (!summary || !recoveryState.visible) return null;
  const { needsFullFiscalYearReview, needsRunReview, needsTargetReview, runActive, signals } =
    recoveryState;
  const canManuallyObserveFullYear = canManuallyObserveFullFiscalYearTarget(summary);
  const retryDisabled = busy !== null || !portalReady;

  return (
    <section className="recovery-panel" aria-label="Filed return recovery actions">
      <div className="panel-heading">
        <p className="section-label">Run controls</p>
        <h2>Continue this download</h2>
      </div>
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
          {!portalReady ? (
            <p className="muted">Open a signed-in GST Portal tab before retrying this period.</p>
          ) : null}
          <button type="button" disabled={retryDisabled} onClick={onRetryTarget}>
            {busy === "retry-filed-returns-target" ? "Retrying..." : "Retry this period"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => onResolveTarget("downloaded")}
          >
            {busy === "resolve-unconfirmed-download" ? "Saving..." : "Mark reviewed manually"}
          </button>
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
          {signals.has("full-fiscal-year-resume-confirmation-required") ? (
            <p className="muted">
              This saved run is not bound to a GST account. Continue only if the same GST account is
              currently open.
            </p>
          ) : null}
          {!portalReady ? (
            <p className="muted">Open a signed-in GST Portal tab before retrying this period.</p>
          ) : null}
          <button type="button" disabled={retryDisabled} onClick={onRetryFullFiscalYearTarget}>
            {busy === "retry-full-fiscal-year-target" ? "Retrying..." : retryFullYearLabel(summary)}
          </button>
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
    </section>
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
  const needsFullFiscalYearReview =
    Boolean(summary?.fullFiscalYearRecovery) &&
    (signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      signals.has("full-fiscal-year-resume-confirmation-required") ||
      signals.has("full-fiscal-year-run-needs-action"));
  return {
    needsFullFiscalYearReview,
    needsRunReview,
    needsTargetReview,
    runActive,
    signals,
    visible: needsRunReview || needsTargetReview || needsFullFiscalYearReview || runActive,
  };
}
