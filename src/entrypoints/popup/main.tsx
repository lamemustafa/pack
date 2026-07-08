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
            <p className="section-label">GST return downloader</p>
            <h1>Pack</h1>
          </div>
        </div>
        <div className="brand-badges" aria-label="Pack build status">
          <a className="workbench-link" href="/popup.html" target="_blank" rel="noreferrer">
            Open full workbench
          </a>
          <p className="brand-mode">Local-first</p>
          <p className="build-marker">No credential capture</p>
        </div>
      </header>

      <DownloadTargetSummary
        completionStatus={popup.completionStatus}
        context={popup.context}
        scope={popup.scope}
        status={popup.status}
      />

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
