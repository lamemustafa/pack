import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/popup-target-summary.css";
import { ScopeForm } from "./components";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
import { RunEvidencePanel } from "./run-evidence-panel";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();
  const showRecovery = hasRecoveryActions(popup.scopedFlowSummary ?? null);
  const portalReady = popup.context?.supported === true;

  return (
    <main className="popup-shell">
      <header className="popup-topbar">
        <div className="popup-title-block">
          <p className="section-label">Pack</p>
          <h1>{popup.scope.returnType} download</h1>
        </div>
        <span
          className={portalReady ? "state-pill state-pill-ready" : "state-pill state-pill-needed"}
        >
          {portalReady ? "Portal ready" : "Portal needed"}
        </span>
      </header>

      <ScopeForm
        busy={popup.effectiveBusy}
        context={popup.context}
        flowSummary={popup.scopedFlowSummary}
        scope={popup.scope}
        onScopeChange={popup.setScope}
        onStart={() => void popup.startFiledReturnsFlow()}
      />

      <section className="run-stack" aria-label="Run status and recovery">
        <RunEvidencePanel
          portalReady={portalReady}
          filedReturnsObservation={popup.filedReturnsObservation}
          scopedFlowSummary={popup.scopedFlowSummary}
          summaryHeading={popup.summaryHeading}
        />
        {showRecovery ? (
          <RecoveryActions
            busy={popup.effectiveBusy}
            portalReady={portalReady}
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
      </section>

      <footer className="fineprint" aria-label="Pack privacy boundary">
        <span>No credentials</span>
        <span>No cookies or OTPs</span>
        <span>No GST files sent to ComplyEaze</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
