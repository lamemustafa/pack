import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../core/contracts";
import {
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsScopePeriodOptions,
  isFullFiscalYearScope,
  normaliseFiledReturnsScope,
} from "../../core/filed-returns-scope";

export interface ScopeFormProps {
  busy: string | null;
  flowSummary?: FiledReturnsFlowSummary | null;
  scope: FiledReturnsDownloadScope;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: () => void;
}

export interface RecoveryActionsProps {
  busy: string | null;
  summary: FiledReturnsFlowSummary | null;
  onAcknowledgeInterruptedRun: () => void;
  onRetryFullFiscalYearTarget: () => void;
  onRetryTarget: () => void;
  onResolveFullFiscalYearTarget: (resolution: "manually-observed" | "cancelled") => void;
  onResolveTarget: (resolution: "downloaded" | "cancelled") => void;
}

export function RecoveryActions({
  busy,
  summary,
  onAcknowledgeInterruptedRun,
  onRetryFullFiscalYearTarget,
  onRetryTarget,
  onResolveFullFiscalYearTarget,
  onResolveTarget,
}: RecoveryActionsProps) {
  if (!summary) return null;

  const signals = new Set(summary.flowStep.safeSignals);
  const needsRunReview = signals.has("filed-returns-run-needs-review");
  const needsTargetReview = signals.has("filed-returns-target-review-required");
  const runActive =
    signals.has("filed-returns-run-active") || signals.has("full-fiscal-year-run-active");
  const needsFullFiscalYearReview =
    Boolean(summary.fullFiscalYearRecovery) &&
    (signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      signals.has("full-fiscal-year-resume-confirmation-required") ||
      signals.has("full-fiscal-year-run-needs-action"));
  const canManuallyObserveFullYear = canManuallyObserveFullFiscalYearTarget(summary);
  if (!needsRunReview && !needsTargetReview && !needsFullFiscalYearReview && !runActive) {
    return null;
  }

  return (
    <section className="actions" aria-label="Filed return recovery actions">
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
          <button type="button" disabled={busy !== null} onClick={onRetryTarget}>
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
          <p className="muted">
            This saved run is not bound to a GST account. Continue only if the same GST account is
            currently open.
          </p>
          <button type="button" disabled={busy !== null} onClick={onRetryFullFiscalYearTarget}>
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

export function ScopeForm({ busy, flowSummary, scope, onScopeChange, onStart }: ScopeFormProps) {
  const financialYearOptions = getFiledReturnsFinancialYearOptions();
  const periodOptions = getFiledReturnsScopePeriodOptions(scope.financialYear);
  const fullFiscalYear = isFullFiscalYearScope(scope);
  const startAction = getScopeFormStartAction(scope, flowSummary, busy, fullFiscalYear);

  return (
    <section className="flow-panel" aria-label="Filed return download scope">
      <label>
        Filing
        <select value={scope.returnType} disabled>
          <option value="GSTR-3B">GSTR-3B</option>
        </select>
      </label>
      <label>
        Financial year
        <select
          value={scope.financialYear}
          onChange={(event) =>
            onScopeChange(
              normaliseFiledReturnsScope({
                ...scope,
                financialYear: event.target.value,
              }),
            )
          }
        >
          {financialYearOptions.map((financialYear) => (
            <option key={financialYear} value={financialYear}>
              {financialYear}
            </option>
          ))}
        </select>
      </label>
      <label>
        Period
        <select
          value={scope.period}
          onChange={(event) => onScopeChange({ ...scope, period: event.target.value })}
        >
          {periodOptions.map((period) => (
            <option key={period.value} value={period.value}>
              {period.label}
            </option>
          ))}
        </select>
      </label>
      {fullFiscalYear ? (
        <p className="muted">
          Runs eligible filed GSTR-3B periods one by one from your signed-in GST Portal tab. Pack
          stops on ambiguous downloads and records local status only. V0 supports monthly GSTR-3B
          filers only.
        </p>
      ) : null}
      <button type="button" disabled={startAction.disabled} onClick={onStart}>
        {startAction.label}
      </button>
    </section>
  );
}

function getScopeFormStartAction(
  scope: FiledReturnsDownloadScope,
  summary: FiledReturnsFlowSummary | null | undefined,
  busy: string | null,
  fullFiscalYear: boolean,
): { disabled: boolean; label: string } {
  if (busy === "start-filed-returns-flow") return { disabled: true, label: "Starting..." };
  if (busy !== null) return { disabled: true, label: defaultStartLabel(fullFiscalYear) };
  if (summary && isSameScope(scope, summary.scope)) {
    const signals = new Set(summary.flowStep.safeSignals);
    if (signals.has("filed-returns-run-active") || signals.has("full-fiscal-year-run-active")) {
      return { disabled: true, label: "Run in progress" };
    }
    if (signals.has("filed-returns-run-needs-review")) {
      return { disabled: true, label: "Reset stuck run first" };
    }
    if (
      signals.has("filed-returns-target-review-required") ||
      signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      signals.has("full-fiscal-year-run-needs-action")
    ) {
      return { disabled: true, label: "Resolve current period first" };
    }
    if (signals.has("full-fiscal-year-resume-confirmation-required")) {
      return { disabled: true, label: "Resume or discard saved run" };
    }
  }
  return { disabled: false, label: defaultStartLabel(fullFiscalYear) };
}

function defaultStartLabel(fullFiscalYear: boolean): string {
  return fullFiscalYear ? "Start local full-year run" : "Start download";
}

function isSameScope(left: FiledReturnsDownloadScope, right: FiledReturnsDownloadScope): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType
  );
}
