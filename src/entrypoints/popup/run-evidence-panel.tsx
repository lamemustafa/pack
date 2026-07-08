import type { FiledReturnsFlowSummary, PortalObservation } from "../../core/contracts";
import { DiagnosticSignals, RunProgress } from "./run-summary";

export function RunEvidencePanel({
  portalReady,
  filedReturnsObservation,
  scopedFlowSummary,
  summaryHeading,
}: {
  portalReady: boolean;
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
        <p className="status-detail">{displayFlowStepMessage(scopedFlowSummary)}</p>
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
      <h2>{portalReady ? "Ready for a local run" : "GST Portal tab needed"}</h2>
      <p className="status-detail">
        {portalReady
          ? "Choose the target and start when the GST Portal page is still open in this window."
          : "Open an authenticated GST return dashboard or return page in this window before starting."}
      </p>
    </section>
  );
}

function displayFlowStepMessage(summary: FiledReturnsFlowSummary): string {
  if (summary.flowStep.safeSignals.includes("gst-login-tab-opened")) {
    return "Open a signed-in GST Portal tab, then retry this period or cancel and reset.";
  }
  if (summary.flowStep.safeSignals.includes("full-fiscal-year-zip-download-unconfirmed")) {
    return "Pack prepared the final ZIP. If the Save panel is open, click Save. If you already saved it, verify the ZIP in Downloads before starting another run.";
  }
  return summary.flowStep.safeMessage;
}
