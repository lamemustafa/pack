import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/popup-target-summary.css";
import { ScopeForm } from "./components";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
import { DiagnosticSignals, RunProgress } from "./run-summary";
import { DownloadTargetSummary } from "./target-summary";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();
  const hasRunSummary = Boolean(popup.scopedFlowSummary && popup.summaryHeading);
  const showRecovery = hasRecoveryActions(popup.scopedFlowSummary ?? null);

  return (
    <main className="popup-shell">
      <header className="brand-header">
        <div className="brand-title-block">
          <img className="brand-logo" src="/brand/pack-logo-outlined.svg" alt="ComplyEaze Pack" />
          <div>
            <p className="section-label">GST Portal local collector</p>
            <h1>Return downloads</h1>
          </div>
        </div>
        <div className="brand-badges" aria-label="Pack build status">
          <p className="brand-mode">Local-first</p>
          <p className="build-marker">No credential capture</p>
        </div>
      </header>

      <section className="status-workbench" aria-label="Selected target and run evidence">
        <DownloadTargetSummary
          completionStatus={popup.completionStatus}
          context={popup.context}
          scope={popup.scope}
          status={popup.status}
        />
        <aside
          className={hasRunSummary ? "summary-card summary-card-active" : "summary-card"}
          aria-label="Run status and recovery"
        >
          {popup.scopedFlowSummary && popup.summaryHeading ? (
            <>
              <div className="summary-header">
                <div>
                  <p className="section-label">Run evidence</p>
                  <p className="summary-title">{popup.summaryHeading}</p>
                </div>
                <RunProgress summary={popup.scopedFlowSummary} />
              </div>
              <p className="status-detail">{popup.scopedFlowSummary.flowStep.safeMessage}</p>
              <DiagnosticSignals summary={popup.scopedFlowSummary} />
            </>
          ) : popup.filedReturnsObservation ? (
            <>
              <p className="section-label">Portal observation</p>
              <p className="summary-title">
                Filed returns status: {popup.filedReturnsObservation.state}
              </p>
              <p className="status-detail">{popup.filedReturnsObservation.safeMessage}</p>
            </>
          ) : (
            <>
              <p className="section-label">Run evidence</p>
              <p className="summary-title">No active run</p>
              <p className="status-detail">
                Choose a target and start only from an authenticated GST Portal tab.
              </p>
            </>
          )}
        </aside>
      </section>

      <div className={showRecovery ? "popup-workbench" : "popup-workbench popup-workbench-wide"}>
        <ScopeForm
          busy={popup.effectiveBusy}
          flowSummary={popup.scopedFlowSummary}
          scope={popup.scope}
          onScopeChange={popup.setScope}
          onStart={() => void popup.startFiledReturnsFlow()}
        />

        {showRecovery ? (
          <aside className="run-column" aria-label="Run status and recovery">
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
        ) : null}
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
