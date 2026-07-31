import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";

const TERMINAL_STATUSES = new Set<FiledReturnsFlowSummary["status"]>([
  "blocked",
  "cancelled",
  "complete",
  "partial",
]);

export function LastRunDiagnostics({ summary }: { summary: FiledReturnsFlowSummary | null }) {
  if (!summary || !TERMINAL_STATUSES.has(summary.status)) return null;

  return (
    <details className="diagnostic-details" aria-label="Last run diagnostics">
      <summary>Details</summary>
      <dl className="diagnostic-line">
        <dt>Terminal state</dt>
        <dd>{summary.status}</dd>
        <dt>Reason</dt>
        <dd>{summary.flowStep.state}</dd>
        <dt>Safe signals</dt>
        <dd>
          {summary.flowStep.safeSignals.length === 0
            ? "none"
            : summary.flowStep.safeSignals.join(", ")}
        </dd>
      </dl>
    </details>
  );
}
