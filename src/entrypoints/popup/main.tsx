import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/popup-target-summary.css";
import { ScopeForm } from "./components";
import { RecoveryActions } from "./recovery-actions";
import { DiagnosticSignals, RunProgress } from "./run-summary";
import { DownloadTargetSummary } from "./target-summary";
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
        <div className="brand-badges" aria-label="Pack build status">
          <p className="brand-mode">Local-first</p>
          <p className="build-marker">Target-first UI</p>
        </div>
      </header>

      <DownloadTargetSummary
        completionStatus={popup.completionStatus}
        context={popup.context}
        scope={popup.scope}
        status={popup.status}
      />

      <div className="popup-workbench">
        <ScopeForm
          busy={popup.effectiveBusy}
          flowSummary={popup.scopedFlowSummary}
          scope={popup.scope}
          onScopeChange={popup.setScope}
          onStart={() => void popup.startFiledReturnsFlow()}
        />

        <aside className="run-column" aria-label="Run status and recovery">
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
          ) : (
            <section className="summary-card summary-card-empty">
              <p className="section-label">Current run</p>
              <p className="summary-title">No active run</p>
              <p className="status-detail">
                Choose a target and start only from an authenticated GST Portal tab.
              </p>
            </section>
          )}

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
        </aside>
      </div>

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
