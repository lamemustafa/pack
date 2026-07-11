import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import { ScopeForm, ScopeFormAction } from "./components";
import { hasInlinePrimaryAction, InlineStatus } from "./inline-status";
import { PackSummary } from "./pack-summary";
import { getPopupPresentationState, type PopupPresentationState } from "./presentation-state";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
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
  const showBuilder =
    popup.context?.supported === true &&
    !["loading", "unsupported", "session-expired"].includes(presentation.kind);
  const statusOwnsPrimaryAction = hasInlinePrimaryAction(presentation, popup.scopedFlowSummary);

  return (
    <main className="popup-shell">
      <header className="popup-topbar">
        <div className="popup-brand">
          <img
            className="popup-wordmark"
            src="/brand/pack-logo-header.svg"
            alt="Pack by ComplyEaze"
          />
        </div>
      </header>

      {showBuilder ? (
        <>
          <p className="portal-context-line">
            <span className="portal-context-dot" aria-hidden="true" />
            GST Portal page detected
          </p>
          <ScopeForm
            busy={popup.effectiveBusy}
            context={popup.context}
            flowSummary={popup.scopedFlowSummary}
            scope={popup.scope}
            onScopeChange={popup.setScope}
            onStart={() => void popup.startFiledReturnsFlow()}
            showPrimaryAction={false}
          />
          <PackSummary scope={popup.scope} summary={popup.scopedFlowSummary} />
          <InlineStatus
            busy={popup.effectiveBusy}
            onOpenPortal={() => void browser.tabs.create({ url: "https://www.gst.gov.in" })}
            onRetryFullFiscalYearTarget={() => void popup.retryFullFiscalYearTarget()}
            onRetryTarget={() => void popup.retryFiledReturnsTarget()}
            presentation={presentation}
            summary={popup.scopedFlowSummary}
          />
          {!statusOwnsPrimaryAction ? (
            <ScopeFormAction
              busy={popup.effectiveBusy}
              context={popup.context}
              flowSummary={popup.scopedFlowSummary}
              scope={popup.scope}
              onStart={() => void popup.startFiledReturnsFlow()}
            />
          ) : null}
        </>
      ) : (
        <ContextState
          status={presentation}
          onOpenPortal={() => void browser.tabs.create({ url: "https://www.gst.gov.in" })}
        />
      )}

      {showBuilder && showRecovery ? (
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

      <footer className="fineprint" aria-label="Pack privacy boundary">
        <span>Local only · GST login and PDFs stay on your device.</span>
        <span className="fineprint-links">
          <a href="https://pack.complyeaze.com/privacy" target="_blank" rel="noreferrer">
            Details
          </a>
        </span>
      </footer>
    </main>
  );
}

function ContextState({
  status,
  onOpenPortal,
}: {
  status: PopupPresentationState;
  onOpenPortal: () => void;
}) {
  const isSessionExpired = status.kind === "session-expired";
  const isChecking = status.kind === "loading";
  return (
    <section className="context-state" aria-live="polite">
      <div className="context-state-icon" aria-hidden="true">
        {isSessionExpired ? "!" : "↗"}
      </div>
      <div className="context-state-content">
        <p className="context-state-kicker">GST Portal status</p>
        <h2>
          {isChecking
            ? "Checking this tab"
            : isSessionExpired
              ? "Sign in again on the GST Portal"
              : "Open the GST Portal to use Pack"}
        </h2>
        <p>
          {isChecking
            ? "Checking for a supported GST Portal page in this browser."
            : isSessionExpired
              ? "Your GST Portal session appears to have expired. Sign in there, then reopen Pack."
              : "Navigate to the filed returns page. Pack will detect the supported page automatically."}
        </p>
        {!isChecking ? (
          <button
            className="primary-action context-state-action"
            type="button"
            onClick={onOpenPortal}
          >
            {isSessionExpired ? "Open GST Portal sign-in" : "Open GST Portal"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
