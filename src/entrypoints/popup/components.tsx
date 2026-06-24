import type { FiledReturnsDownloadScope, FiledReturnsFlowSummary } from "../../core/contracts";
import {
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsScopePeriodOptions,
  isFullFiscalYearScope,
  normaliseFiledReturnsScope,
} from "../../core/filed-returns-scope";

export interface ScopeFormProps {
  busy: string | null;
  scope: FiledReturnsDownloadScope;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: () => void;
}

export interface RecoveryActionsProps {
  busy: string | null;
  summary: FiledReturnsFlowSummary | null;
  onAcknowledgeInterruptedRun: () => void;
  onRetryTarget: () => void;
  onResolveTarget: (resolution: "downloaded" | "cancelled") => void;
}

export function RecoveryActions({
  busy,
  summary,
  onAcknowledgeInterruptedRun,
  onRetryTarget,
  onResolveTarget,
}: RecoveryActionsProps) {
  if (!summary) return null;

  const signals = new Set(summary.flowStep.safeSignals);
  const needsRunReview = signals.has("filed-returns-run-needs-review");
  const needsTargetReview = signals.has("filed-returns-target-review-required");
  if (!needsRunReview && !needsTargetReview) return null;

  return (
    <section className="actions" aria-label="Filed return recovery actions">
      {needsRunReview ? (
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={onAcknowledgeInterruptedRun}
        >
          {busy === "acknowledge-interrupted-run"
            ? "Acknowledging..."
            : "Acknowledge interrupted run"}
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
            {busy === "resolve-unconfirmed-download" ? "Saving..." : "Mark reviewed as downloaded"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => onResolveTarget("cancelled")}
          >
            {busy === "cancel-unconfirmed-download" ? "Cancelling..." : "Cancel target"}
          </button>
        </>
      ) : null}
    </section>
  );
}

export function ScopeForm({ busy, scope, onScopeChange, onStart }: ScopeFormProps) {
  const financialYearOptions = getFiledReturnsFinancialYearOptions();
  const periodOptions = getFiledReturnsScopePeriodOptions(scope.financialYear);
  const fullFiscalYear = isFullFiscalYearScope(scope);

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
          stops on ambiguous downloads and records local status only.
        </p>
      ) : null}
      <button type="button" disabled={busy !== null} onClick={onStart}>
        {busy === "start-filed-returns-flow"
          ? "Starting..."
          : fullFiscalYear
            ? "Start local full-year run"
            : "Start download"}
      </button>
    </section>
  );
}
