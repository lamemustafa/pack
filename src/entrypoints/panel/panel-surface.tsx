import React from "react";
import { browser } from "wxt/browser";
import { isFullFiscalYearScope } from "../../connectors/gst/filed-returns-scope";
import { ScopeForm } from "../popup/components";
import { ContextState } from "../popup/context-state";
import { canRetryFullFiscalYearZipWithoutPortal } from "../popup/flow-summary";
import { InlineStatus } from "../popup/inline-status";
import { PackSummary } from "../popup/pack-summary";
import { getPopupPresentationState } from "../popup/presentation-state";
import { RecoveryActions, hasRecoveryActions } from "../popup/recovery-actions";
import { getScopeFormStartAction } from "../popup/scope-form-model";
import type { usePackPopupController } from "../popup/use-pack-popup-controller";
import { panelPresets, presetPeriodCount, type PanelView } from "./panel-presets";

export type PackPanelController = ReturnType<typeof usePackPopupController>;

/**
 * The panel's rendered surface, separated from the mount so it can be rendered in a test
 * with a controller in any state. The gap this separation exists to close was a terminal
 * run that rendered nothing at all: only a render assertion catches that.
 */
export function PanelSurface({ pack }: { pack: PackPanelController }) {
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
  const running = pack.effectiveBusy !== null || summary?.status === "running";

  /**
   * Which surface owns the body. Mirrors the popup deliberately: a terminal run, a retained
   * local ZIP, and an action error each stay visible even when this tab is not a Pack page,
   * and every remaining presentation kind falls through to `ContextState` rather than to a
   * blank body. The panel previously rendered the flow only while a run was in flight, so a
   * completed run, a partly-available run and a failed action all showed nothing.
   */
  const terminalSummary = Boolean(
    summary && ["complete", "partial", "blocked", "cancelled"].includes(summary.status),
  );
  const showFlow =
    (portalReady || canRetryFullFiscalYearZipWithoutPortal(summary) || terminalSummary) &&
    !["loading", "unsupported", "session-expired"].includes(presentation.kind);

  const openPortal = () => void browser.tabs.create({ url: "https://www.gst.gov.in" });

  return (
    <main className="panel-shell">
      {/* Lockup per design-lab/01-claude/04-brand.md: mark, "Pack" at full weight, then
          ComplyEaze as a separate muted publisher credit. Legible precisely because it is not
          squeezed into one wordmark asset. */}
      <header className="panel-head">
        <img className="panel-mark" src="/brand/pack-mark.svg" alt="" aria-hidden="true" />
        <span className="panel-name">Pack</span>
        <span className="panel-publisher">ComplyEaze</span>
      </header>
      <p className={portalReady ? "panel-source panel-source-live" : "panel-source"}>
        <span
          className={portalReady ? "panel-source-dot" : "panel-source-dot panel-source-dot-off"}
          aria-hidden="true"
        />
        {portalReady ? "GST portal · signed in" : "Open a signed-in GST Portal tab"}
      </p>

      <div className="panel-body">
        {showFlow ? (
          <>
            <InlineStatus
              busy={pack.effectiveBusy}
              onOpenPortal={openPortal}
              onRestartTarget={() => void pack.startFiledReturnsFlow()}
              onRetryFullFiscalYearTarget={() => void pack.retryFullFiscalYearTarget()}
              onRetryTarget={() => void pack.retryFiledReturnsTarget()}
              portalReady={portalReady}
              presentation={presentation}
              summary={summary}
            />
            {summary ? <PackSummary scope={pack.scope} summary={pack.scopedFlowSummary} /> : null}
            {running ? null : view === "presets" ? (
              <>
                <h2>What do you need?</h2>
                {presets.map((preset) => {
                  // The same guard matrix the popup's start control consults. Reading it here
                  // rather than re-deriving "is something running" is the point: the saved run
                  // may be for a scope this panel is not currently showing, and a preset that
                  // the background will refuse must say so instead of looking available.
                  const startAction = getScopeFormStartAction(
                    preset.scope,
                    pack.lastRunSummary,
                    pack.effectiveBusy,
                    isFullFiscalYearScope(preset.scope),
                  );
                  const blockedReason = startAction.disabled
                    ? startAction.label
                    : portalReady
                      ? null
                      : "Open a signed-in GST Portal tab";
                  return (
                    <button
                      key={preset.id}
                      className="panel-choice"
                      type="button"
                      disabled={blockedReason !== null}
                      onClick={() => void pack.startFiledReturnsFlow(preset.scope)}
                    >
                      <span>{preset.label}</span>
                      <span className="panel-choice-detail">
                        {blockedReason ?? `${presetPeriodCount(preset)} periods · one ZIP`}
                      </span>
                    </button>
                  );
                })}
                <button
                  className="panel-choice"
                  type="button"
                  onClick={() => setView("custom")}
                  disabled={pack.effectiveBusy !== null}
                >
                  <span>Choose a period</span>
                  <span className="panel-choice-detail">pick your own</span>
                </button>
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
          </>
        ) : (
          <ContextState status={presentation} onOpenPortal={openPortal} />
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
        {/* Required wherever the Pack mark appears. See DESIGN.md and AGENTS.md. */}
        <p className="panel-fine">
          Not affiliated with, endorsed by, or operated by GSTN, CBIC, or the Government of India.
        </p>
      </footer>
    </main>
  );
}
