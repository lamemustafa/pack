import type { FiledReturnsFlowSummary } from "../../core/contracts";

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

function isDownloadDiagnosticSignal(signal: string): boolean {
  return (
    signal.includes("blob-capture") ||
    signal.includes("portal-blob") ||
    signal.includes("extension-download") ||
    signal.includes("native-blob-click") ||
    signal.includes("main-world-capture") ||
    signal.includes("chunk") ||
    signal.includes("opfs") ||
    signal.includes("file-reader") ||
    signal.includes("create-object-url") ||
    signal.startsWith("filed-gstr3b-direct-download-started") ||
    signal.startsWith("filed-gstr3b-direct-download-start-rejected")
  );
}
