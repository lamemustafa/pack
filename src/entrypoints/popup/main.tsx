import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import { ScopeForm } from "./components";
import { RecoveryActions } from "./recovery-actions";
import { DiagnosticSignals, RunProgress } from "./run-summary";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();

  return (
    <main className="popup-shell">
      <header className="brand-header">
        <div>
          <img className="brand-logo" src="/brand/pack-logo-outlined.svg" alt="ComplyEaze Pack" />
          <h1>GST return downloads</h1>
        </div>
        <p className="brand-mode">{popup.context?.supported ? "Portal ready" : "Local only"}</p>
      </header>

      <section className="status-card" aria-live="polite">
        <p className="status-title">{popup.completionStatus ?? popup.status}</p>
        <p className="status-detail">
          {popup.context === null
            ? "Open GST Portal and choose a filed GST return period to begin."
            : popup.context.supported
              ? `Detected ${popup.context.pageKind} on ${popup.context.origin ?? "GST Portal"}.`
              : (popup.context.requiredAction?.message ?? "This page is outside Pack V0 scope.")}
        </p>
      </section>

      <ScopeForm
        busy={popup.effectiveBusy}
        flowSummary={popup.scopedFlowSummary}
        scope={popup.scope}
        onScopeChange={popup.setScope}
        onStart={() => void popup.startFiledReturnsFlow()}
      />

      {popup.scopedFlowSummary && popup.summaryHeading ? (
        <section className="summary-card">
          <div>
            <p className="section-label">Current run</p>
            <p className="summary-title">{popup.summaryHeading}</p>
          </div>
          <RunProgress summary={popup.scopedFlowSummary} />
          <p className="status-detail">{popup.scopedFlowSummary.flowStep.safeMessage}</p>
          <DiagnosticSignals summary={popup.scopedFlowSummary} />
        </section>
      ) : popup.filedReturnsObservation ? (
        <section className="summary-card">
          <p className="section-label">Portal observation</p>
          <p className="summary-title">
            Filed returns status: {popup.filedReturnsObservation.state}
          </p>
          <p className="status-detail">{popup.filedReturnsObservation.safeMessage}</p>
        </section>
      ) : null}

      <RecoveryActions
        busy={popup.effectiveBusy}
        summary={popup.scopedFlowSummary}
        onAcknowledgeInterruptedRun={() => void popup.acknowledgeInterruptedRun()}
        onRetryFullFiscalYearTarget={() => void popup.retryFullFiscalYearTarget()}
        onRetryTarget={() => void popup.retryFiledReturnsTarget()}
        onResolveFullFiscalYearTarget={(resolution) =>
          void popup.resolveFullFiscalYearTarget(resolution)
        }
        onResolveTarget={(resolution) => void popup.resolveUnconfirmedDownload(resolution)}
      />

      <p className="fineprint">
        No credentials, cookies, OTP, CAPTCHA, or GST documents are sent to ComplyEaze.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
