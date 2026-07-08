import type { FiledReturnsFlowSummary, PortalObservation } from "../../core/contracts";
import { DiagnosticSignals, RunProgress } from "./run-summary";

export function RunEvidencePanel({
  filedReturnsObservation,
  scopedFlowSummary,
  summaryHeading,
}: {
  filedReturnsObservation: PortalObservation | null;
  scopedFlowSummary: FiledReturnsFlowSummary | null;
  summaryHeading: string | null;
}) {
  if (scopedFlowSummary && summaryHeading) {
    return (
      <section className="evidence-panel evidence-panel-active" aria-label="Run evidence">
        <div className="evidence-heading">
          <div>
            <p className="section-label">Run evidence</p>
            <h2>{summaryHeading}</h2>
          </div>
          <RunProgress summary={scopedFlowSummary} />
        </div>
        <p className="status-detail">{scopedFlowSummary.flowStep.safeMessage}</p>
        <DiagnosticSignals summary={scopedFlowSummary} />
      </section>
    );
  }

  if (filedReturnsObservation) {
    return (
      <section className="evidence-panel" aria-label="Portal observation">
        <p className="section-label">Portal observation</p>
        <h2>Filed returns status: {filedReturnsObservation.state}</h2>
        <p className="status-detail">{filedReturnsObservation.safeMessage}</p>
      </section>
    );
  }

  return (
    <section className="evidence-panel" aria-label="Run evidence">
      <p className="section-label">Run evidence</p>
      <h2>No active run</h2>
      <p className="status-detail">
        Open an authenticated GST Portal tab, choose a target, then start the local download.
      </p>
    </section>
  );
}
