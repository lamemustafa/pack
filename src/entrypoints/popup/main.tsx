import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import { ScopeForm, ScopeFormAction } from "./components";
import { ContextState } from "./context-state";
import { canRetryFullFiscalYearZipWithoutPortal } from "./flow-summary";
import {
  hasInlinePrimaryAction,
  inlinePrimaryActionIsPortalGated,
  InlineStatus,
} from "./inline-status";
import { PackSummary } from "./pack-summary";
import { LastRunDiagnostics } from "./last-run-diagnostics";
import { PopupPrimaryActionSlot } from "./popup-primary-action-slot";
import { getPopupPresentationState } from "./presentation-state";
import { RecoveryActions, hasRecoveryActions } from "./recovery-actions";
import { usePackPopupController } from "./use-pack-popup-controller";

function App() {
  const popup = usePackPopupController();
  const displaySummary = popup.recoverySummary ?? popup.scopedFlowSummary;
  const showRecovery = hasRecoveryActions(displaySummary ?? null);
  const portalReady = popup.context?.supported === true;
  const presentation = getPopupPresentationState(
    popup.context,
    displaySummary,
    popup.effectiveBusy,
    popup.actionError,
  );
  const portalIndependentZipRetry = canRetryFullFiscalYearZipWithoutPortal(displaySummary);
  const terminalSummary = Boolean(
    displaySummary &&
    ["complete", "partial", "blocked", "cancelled"].includes(displaySummary.status),
  );
  const showBuilder =
    (popup.context?.supported === true || portalIndependentZipRetry || terminalSummary) &&
    !["loading", "unsupported", "session-expired"].includes(presentation.kind);
  const statusOwnsPrimaryAction = hasInlinePrimaryAction(presentation, displaySummary);

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
            {portalIndependentZipRetry
              ? "Local ZIP recovery available"
              : "GST Portal page detected"}
          </p>
          <ScopeForm
            busy={popup.effectiveBusy}
            context={popup.context}
            flowSummary={displaySummary}
            scope={popup.scope}
            scopeLockedForReview={popup.scopeLockedForReview}
            onScopeChange={popup.setScope}
            onStart={() => void popup.startFiledReturnsFlow()}
            showPrimaryAction={false}
          />
          <PackSummary scope={popup.scope} summary={popup.scopedFlowSummary} />
          <InlineStatus
            busy={popup.effectiveBusy}
            portalReady={portalReady}
            onOpenPortal={() => void browser.tabs.create({ url: "https://www.gst.gov.in" })}
            onRestartTarget={() => void popup.startFiledReturnsFlow()}
            onRetryFullFiscalYearTarget={() => void popup.retryFullFiscalYearTarget()}
            onRetryTarget={() => void popup.retryFiledReturnsTarget()}
            presentation={presentation}
            summary={displaySummary}
          />
          <PopupPrimaryActionSlot
            recoverySummary={popup.recoverySummary}
            statusOwnsPrimaryAction={statusOwnsPrimaryAction}
          >
            <ScopeFormAction
              busy={popup.effectiveBusy}
              context={popup.context}
              flowSummary={popup.scopedFlowSummary}
              scope={popup.scope}
              onStart={() => void popup.startFiledReturnsFlow()}
            />
          </PopupPrimaryActionSlot>
        </>
      ) : (
        <ContextState
          status={presentation}
          onOpenPortal={() => void browser.tabs.create({ url: "https://www.gst.gov.in" })}
        />
      )}

      {showRecovery ? (
        <RecoveryActions
          busy={popup.effectiveBusy}
          portalReady={portalReady}
          summary={displaySummary}
          onStartFresh={() => void popup.startFreshFiledReturnsFlow()}
          onAcknowledgeInterruptedRun={() => void popup.acknowledgeInterruptedRun()}
          onRetryFullFiscalYearTarget={() => void popup.retryFullFiscalYearTarget()}
          onRetryTarget={() => void popup.retryFiledReturnsTarget()}
          onResolveFullFiscalYearTarget={(resolution) =>
            void popup.resolveFullFiscalYearTarget(resolution)
          }
          onResolveTarget={(resolution) => void popup.resolveUnconfirmedDownload(resolution)}
          showPortalRetryReason={!inlinePrimaryActionIsPortalGated(presentation, displaySummary)}
        />
      ) : null}

      <footer className="fineprint" aria-label="Pack privacy boundary">
        <span>Local only · GST login and PDFs stay on your device.</span>
        <div className="fineprint-links">
          <button
            className="fineprint-action"
            type="button"
            onClick={() => void browser.tabs.create({ url: browser.runtime.getURL("/panel.html") })}
          >
            Open Pack panel
          </button>
          <LastRunDiagnostics summary={popup.lastRunSummary} />
          <a href="https://pack.complyeaze.com/privacy" target="_blank" rel="noreferrer">
            Privacy
          </a>
        </div>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
