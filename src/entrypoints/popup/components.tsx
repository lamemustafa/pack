import type { FiledReturnsDownloadScope } from "../../core/contracts";
import {
  getFiledReturnsFinancialYearOptions,
  getFiledReturnsPeriodOptions,
  normaliseFiledReturnsScope,
} from "../../core/filed-returns-scope";

export interface ScopeFormProps {
  busy: string | null;
  scope: FiledReturnsDownloadScope;
  onScopeChange: (scope: FiledReturnsDownloadScope) => void;
  onStart: () => void;
}

export function ScopeForm({ busy, scope, onScopeChange, onStart }: ScopeFormProps) {
  const financialYearOptions = getFiledReturnsFinancialYearOptions();
  const periodOptions = getFiledReturnsPeriodOptions(scope.financialYear);

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
      <button type="button" disabled={busy !== null} onClick={onStart}>
        {busy === "start-filed-returns-flow" ? "Starting..." : "Start download"}
      </button>
    </section>
  );
}

export interface ReviewerToolsProps {
  busy: string | null;
  onRunDemo: () => void;
  onLoadLastManifest: () => void;
  onClearLocalData: () => void;
}

export function ReviewerTools({
  busy,
  onRunDemo,
  onLoadLastManifest,
  onClearLocalData,
}: ReviewerToolsProps) {
  return (
    <details className="advanced">
      <summary>Reviewer and local data tools</summary>
      <section className="actions" aria-label="Pack reviewer and local data tools">
        <button type="button" className="secondary" disabled={busy !== null} onClick={onRunDemo}>
          {busy === "demo" ? "Building demo..." : "Run local reviewer demo"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={onLoadLastManifest}
        >
          {busy === "manifest" ? "Loading..." : "Last manifest"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={onClearLocalData}
        >
          {busy === "clear" ? "Clearing..." : "Clear local data"}
        </button>
      </section>
    </details>
  );
}
