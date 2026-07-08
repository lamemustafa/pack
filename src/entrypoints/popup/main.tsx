import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/popup-target-summary.css";
import { ScopeForm } from "./components";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
import { RunEvidencePanel } from "./run-evidence-panel";
import { DownloadTargetSummary } from "./target-summary";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();
  const showRecovery = hasRecoveryActions(popup.scopedFlowSummary ?? null);

  return (
    <main className="popup-shell">
      <header className="brand-header">
        <div className="brand-title-block">
          <img className="brand-logo" src="/brand/pack-logo-outlined.svg" alt="ComplyEaze Pack" />
          <div>
            <p className="section-label">GST Portal collector</p>
            <h1>Return file workbench</h1>
          </div>
        </div>
        <div className="brand-badges" aria-label="Pack build status">
          <p className="brand-mode">Local-first</p>
          <p className="build-marker">No credential capture</p>
        </div>
      </header>

      <section className="command-workbench" aria-label="GST return download workbench">
        <div className="scope-column">
          <ScopeForm
            busy={popup.effectiveBusy}
            context={popup.context}
            flowSummary={popup.scopedFlowSummary}
            scope={popup.scope}
            onScopeChange={popup.setScope}
            onStart={() => void popup.startFiledReturnsFlow()}
          />
        </div>

        <aside className="run-column" aria-label="Target, run status, and recovery">
          <DownloadTargetSummary
            completionStatus={popup.completionStatus}
            context={popup.context}
            scope={popup.scope}
            status={popup.status}
          />
          <RunEvidencePanel
            portalReady={popup.context?.supported === true}
            filedReturnsObservation={popup.filedReturnsObservation}
            scopedFlowSummary={popup.scopedFlowSummary}
            summaryHeading={popup.summaryHeading}
          />
          {showRecovery ? (
            <RecoveryActions
              busy={popup.effectiveBusy}
              portalReady={popup.context?.supported === true}
              summary={popup.scopedFlowSummary}
              onAcknowledgeInterruptedRun={() => void popup.acknowledgeInterruptedRun()}
              onRetryFullFiscalYearTarget={() => void popup.retryFullFiscalYearTarget()}
              onRetryTarget={() => void popup.retryFiledReturnsTarget()}
              onResolveFullFiscalYearTarget={(resolution) =>
                void popup.resolveFullFiscalYearTarget(resolution)
              }
              onResolveTarget={(resolution) => void popup.resolveUnconfirmedDownload(resolution)}
            />
          ) : null}
        </aside>
      </section>

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
