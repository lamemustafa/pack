import React from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/panel.css";
import { ScopeForm } from "../popup/components";
import { InlineStatus } from "../popup/inline-status";
import { PackSummary } from "../popup/pack-summary";
import { getPopupPresentationState } from "../popup/presentation-state";
import { RecoveryActions, hasRecoveryActions } from "../popup/recovery-actions";
import { usePackPopupController } from "../popup/use-pack-popup-controller";
import { panelPresets, presetPeriodCount, type PanelView } from "./panel-presets";

/**
 * Phase A of the target-plan surface.
 *
 * This is an ordinary extension page — no manifest change and no new permission. The same
 * document is what a side panel would render if `sidePanel` is ever approved, which is why
 * the surface is built before the permission is asked for rather than after.
 *
 * It deliberately reuses the popup's controller. The flows, guards and recovery are the
 * existing ones; only the way a user reaches them is new. Duplicating the flow logic here
 * would create exactly the second source of truth this repo keeps paying for.
 */
function Panel() {
  const pack = usePackPopupController();
  const [view, setView] = React.useState<PanelView>("presets");
  const presets = React.useMemo(() => panelPresets(), []);

  const summary = pack.recoverySummary ?? pack.scopedFlowSummary;
  const presentation = getPopupPresentationState(
    pack.context,
    summary,
    pack.effectiveBusy,
    pack.actionError,
  );
  const portalReady = pack.context?.supported === true;
  const busy = pack.effectiveBusy !== null || summary?.status === "running";
  const running = Boolean(summary) && !["complete", "cancelled"].includes(summary?.status ?? "");

  return (
    <main className="panel-shell">
      <header className="panel-head">
        <img
          className="panel-wordmark"
          src="/brand/pack-logo-header.svg"
          alt="Pack by ComplyEaze"
        />
      </header>
      <p className="panel-source">
        <span
          className={portalReady ? "panel-source-dot" : "panel-source-dot panel-source-dot-off"}
          aria-hidden="true"
        />
        {portalReady ? "GST portal · signed in" : "Open a signed-in GST Portal tab"}
      </p>

      <div className="panel-body">
        {running || pack.effectiveBusy ? (
          <>
            <InlineStatus
              busy={pack.effectiveBusy}
              onOpenPortal={() => void browser.tabs.create({ url: "https://www.gst.gov.in" })}
              onRestartTarget={() => void pack.startFiledReturnsFlow()}
              onRetryFullFiscalYearTarget={() => void pack.retryFullFiscalYearTarget()}
              onRetryTarget={() => void pack.retryFiledReturnsTarget()}
              portalReady={portalReady}
              presentation={presentation}
              summary={summary}
            />
            <PackSummary scope={pack.scope} summary={pack.scopedFlowSummary} />
          </>
        ) : view === "presets" ? (
          <>
            <h2>What do you need?</h2>
            {presets.map((preset) => (
              <button
                key={preset.id}
                className="panel-choice"
                type="button"
                disabled={!portalReady || busy}
                onClick={() => void pack.startFiledReturnsFlow(preset.scope)}
              >
                <span>{preset.label}</span>
                <span className="panel-choice-detail">
                  {presetPeriodCount(preset)} periods · one ZIP
                </span>
              </button>
            ))}
            <button
              className="panel-choice"
              type="button"
              onClick={() => setView("custom")}
              disabled={busy}
            >
              <span>Choose a period</span>
              <span className="panel-choice-detail">pick your own</span>
            </button>
            {portalReady ? null : (
              <p className="panel-note">
                Pack works on the GST Portal tab you are already signed in to. Open one to start.
              </p>
            )}
          </>
        ) : (
          <>
            <ScopeForm
              busy={pack.effectiveBusy}
              context={pack.context}
              flowSummary={pack.scopedFlowSummary}
              scope={pack.scope}
              scopeLockedForReview={pack.scopeLockedForReview}
              onScopeChange={pack.setScope}
              onStart={() => void pack.startFiledReturnsFlow()}
            />
            <button className="panel-link" type="button" onClick={() => setView("presets")}>
              Back
            </button>
          </>
        )}

        {hasRecoveryActions(summary ?? null) ? (
          <RecoveryActions
            busy={pack.effectiveBusy}
            portalReady={portalReady}
            summary={summary}
            onStartFresh={() => void pack.startFreshFiledReturnsFlow()}
            onAcknowledgeInterruptedRun={() => void pack.acknowledgeInterruptedRun()}
            onRetryFullFiscalYearTarget={() => void pack.retryFullFiscalYearTarget()}
            onRetryTarget={() => void pack.retryFiledReturnsTarget()}
            onResolveFullFiscalYearTarget={(resolution) =>
              void pack.resolveFullFiscalYearTarget(resolution)
            }
            onResolveTarget={(resolution) => void pack.resolveUnconfirmedDownload(resolution)}
          />
        ) : null}
      </div>

      <footer className="panel-foot">
        <p className="panel-fine">Local only · GST login and files stay on this device.</p>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
