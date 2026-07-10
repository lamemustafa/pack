import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type { FiledReturnsFlowSummary } from "../../core/contracts";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import { ScopeForm } from "./components";
import { PackSummary } from "./pack-summary";
import { getPopupPresentationState, type PopupPresentationState } from "./presentation-state";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
import { RunProgress } from "./run-summary";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();
  const showRecovery = hasRecoveryActions(popup.scopedFlowSummary ?? null);
  const portalReady = popup.context?.supported === true;
  const presentation = getPopupPresentationState(
    popup.context,
    popup.scopedFlowSummary,
    popup.effectiveBusy,
  );
  const showBuilder = [
    "ready",
    "downloading",
    "partial",
    "complete",
    "unavailable",
    "blocked",
  ].includes(presentation.kind);

  return (
    <main className="popup-shell">
      <header className="popup-topbar">
        <div className="popup-brand">
          <img
            className="popup-wordmark"
            src="/brand/pack-logo-outlined.svg"
            alt="ComplyEaze Pack"
          />
          <div className="popup-title-block">
            <h1>Pack</h1>
            <p>GST return PDF downloader</p>
          </div>
        </div>
      </header>

      <PortalStatusCard
        status={presentation}
        summary={popup.scopedFlowSummary}
        onOpenDownloads={() => void browser.downloads.showDefaultFolder()}
        onOpenPortal={() => void browser.tabs.create({ url: "https://www.gst.gov.in" })}
      />

      {showBuilder ? (
        <>
          <ScopeForm
            busy={popup.effectiveBusy}
            context={popup.context}
            flowSummary={popup.scopedFlowSummary}
            scope={popup.scope}
            onScopeChange={popup.setScope}
            onStart={() => void popup.startFiledReturnsFlow()}
          />
          <PackSummary scope={popup.scope} summary={popup.scopedFlowSummary} />
        </>
      ) : null}

      {showRecovery ? (
        <section className="run-stack" aria-label="Run status and recovery">
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
        </section>
      ) : null}

      <footer className="fineprint" aria-label="Pack privacy boundary">
        <span>Runs locally. GST login and PDFs stay on your device.</span>
        <span className="fineprint-links">
          <a href="https://pack.complyeaze.com/privacy" target="_blank" rel="noreferrer">
            Data handling
          </a>
          <span aria-hidden="true">·</span>
          <a href="https://github.com/lamemustafa/pack" target="_blank" rel="noreferrer">
            Source
          </a>
        </span>
      </footer>
    </main>
  );
}

function PortalStatusCard({
  status,
  summary,
  onOpenDownloads,
  onOpenPortal,
}: {
  status: PopupPresentationState;
  summary: FiledReturnsFlowSummary | null;
  onOpenDownloads: () => void;
  onOpenPortal: () => void;
}) {
  return (
    <section className={`portal-status-card portal-status-card-${status.tone}`} aria-live="polite">
      <div className="status-icon" aria-hidden="true">
        {status.icon}
      </div>
      <div className="portal-status-content">
        <div className="portal-status-heading">
          <p className="section-label">GST Portal status</p>
          <span className={`state-pill state-pill-${status.tone}`}>{status.badge}</span>
        </div>
        <h2>{status.title}</h2>
        <p>{status.body}</p>
        {status.kind === "downloading" && summary ? <RunProgress summary={summary} /> : null}
        <div className="status-actions">
          {status.kind === "unsupported" ? (
            <button className="button-link" type="button" onClick={onOpenPortal}>
              Open GST Portal
            </button>
          ) : null}
          {status.kind === "session-expired" ? (
            <button className="button-link" type="button" onClick={onOpenPortal}>
              Open GST Portal sign-in
            </button>
          ) : null}
          {status.kind === "complete" || status.kind === "unavailable" ? (
            <>
              <a className="button-link secondary-button-link" href="#download-details">
                Download another
              </a>
              <button className="status-link-button" type="button" onClick={onOpenDownloads}>
                Open downloads
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
