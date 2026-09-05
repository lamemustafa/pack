import type {
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  FiledReturnsFlowSummary,
} from "../../connectors/gst/filed-returns-contracts";
import { isFullFiscalYearScope } from "../../connectors/gst/filed-returns-scope";

type DiagnosticsSummary =
  FiledReturnsFlowSummary | FiledReturnsAllSupportedFullFiscalYearFlowSummary;

export function LastRunDiagnostics({ summary }: { summary: DiagnosticsSummary | null }) {
  if (!summary) return null;
  const scope = "scope" in summary ? summary.scope : summary.flowStepScope;

  return (
    <details className="diagnostic-details" aria-label="Run diagnostics">
      <summary>Details</summary>
      <dl className="diagnostic-line">
        <dt>Run state</dt>
        <dd>{summary.status}</dd>
        <dt>Reason</dt>
        <dd>{summary.flowStep.state}</dd>
        <dt>Safe signals</dt>
        <dd>
          {summary.flowStep.safeSignals.length === 0
            ? "none"
            : summary.flowStep.safeSignals.join(", ")}
        </dd>
        {scope ? (
          <>
            <dt>Affected return type</dt>
            <dd>{scope.returnType}</dd>
            <dt>Affected period</dt>
            <dd>{isFullFiscalYearScope(scope) ? "Full fiscal year" : scope.period}</dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}
