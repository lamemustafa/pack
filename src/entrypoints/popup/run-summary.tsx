import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";

export function DiagnosticSignals({ summary }: { summary: FiledReturnsFlowSummary }) {
  const signals = summary.flowStep.safeSignals.filter(isDownloadDiagnosticSignal);
  if (signals.length === 0) return null;

  return <p className="diagnostic-line">Signals: {signals.slice(0, 8).join(", ")}</p>;
}

export function RunProgress({ summary }: { summary: FiledReturnsFlowSummary }) {
  const totalPeriods = summary.totalPeriods ?? 0;
  if (totalPeriods <= 1) return null;
  const value = Math.round((summary.completedPeriods.length / totalPeriods) * 100);
  return (
    <div
      className="run-progress"
      aria-label={`${summary.completedPeriods.length} of ${totalPeriods} periods complete`}
    >
      <div className="run-progress-track">
        <span style={{ width: `${value}%` }} />
      </div>
      <span>
        {summary.completedPeriods.length}/{totalPeriods}
      </span>
    </div>
  );
}

export function hasDiagnosticSignals(summary: FiledReturnsFlowSummary): boolean {
  return summary.flowStep.safeSignals.some(isDownloadDiagnosticSignal);
}

/** Whether retry can inspect a retained exact-ID artifact download without a portal click. */
export function canReconcileFiledReturnsTarget(summary: FiledReturnsFlowSummary): boolean {
  const signals = summary.flowStep.safeSignals;
  if (signals.includes("artifact-acquisition-session-proof-expired")) return false;
  if (
    summary.scope.artifactType === "PDF_AND_EXCEL" &&
    !signals.includes("filed-returns-download-reconciliation-required")
  ) {
    return false;
  }
  if (
    signals.includes("artifact-acquisition-start-unreconciled") ||
    signals.includes("artifact-acquisition-checkpoint-malformed")
  ) {
    return false;
  }
  return signals.some((signal) =>
    [
      "filed-returns-download-reconciliation-required",
      "artifact-acquisition-download-completed-unpersisted",
      "artifact-acquisition-download-interrupted",
      "artifact-acquisition-download-search-unavailable",
      "artifact-acquisition-download-unconfirmed",
      "artifact-acquisition-download-unreconciled",
    ].includes(signal),
  );
}

function isDownloadDiagnosticSignal(signal: string): boolean {
  return (
    signal.includes("blob-capture") ||
    signal.includes("browser-download") ||
    signal.includes("portal-blob") ||
    signal.includes("extension-download") ||
    signal.includes("native-blob-click") ||
    signal.includes("main-world-capture") ||
    signal.includes("chunk") ||
    signal.includes("opfs") ||
    signal.includes("file-reader") ||
    signal.includes("create-object-url")
  );
}
