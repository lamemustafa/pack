import React from "react";
import { browser } from "wxt/browser";
import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";
import { isFullFiscalYearScope } from "../../connectors/gst/filed-returns-scope";
import { ScopeForm } from "../popup/components";
import { ContextState } from "../popup/context-state";
import {
  canRetryFullFiscalYearZipWithoutPortal,
  getScopeMatchedFiledReturnsSummary,
  hasUnresolvedFiledReturnsRecovery,
} from "../popup/flow-summary";
import { InlineStatus } from "../popup/inline-status";
import { PackSummary } from "../popup/pack-summary";
import { getPopupPresentationState, isGstSignInRequired } from "../popup/presentation-state";
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
  /**
   * "Signed in" is a claim about the page, not about whether Pack supports it. The GST auth
   * landing page is `supported: true` — that is how Pack offers to act on it — so reading
   * `portalReady` here put "GST portal · signed in" above a body asking the user to sign in.
   * `isGstSignInRequired` is the same test the popup's disabled-reason copy consults.
   */
  const portalSignedIn = portalReady && !isGstSignInRequired(pack.context);
  const running = pack.effectiveBusy !== null || summary?.status === "running";

  usePortalContextRefresh(pack.refreshPortalContext);

  const savedRun = pack.lastRunSummary;
  const savedRunBlock = getSavedRunBlock(savedRun, pack.effectiveBusy);

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
      <p className={portalSignedIn ? "panel-source panel-source-live" : "panel-source"}>
        <span
          className={portalSignedIn ? "panel-source-dot" : "panel-source-dot panel-source-dot-off"}
          aria-hidden="true"
        />
        {portalSignedIn ? "GST portal · signed in" : "Open a signed-in GST Portal tab"}
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
                  // rather than re-deriving "is something running" is the point: a preset that
                  // the background will refuse must say so instead of looking available.
                  const ownScopeAction = getScopeFormStartAction(
                    preset.scope,
                    savedRun,
                    pack.effectiveBusy,
                    isFullFiscalYearScope(preset.scope),
                  );
                  // ...but that matrix filters the saved run's signals through `isSameScope`,
                  // so a saved run belonging to a different scope reads as no signal at all.
                  // The background does not work that way: `startFiledReturnsDownloadFlow`
                  // returns the outstanding target review before it looks at the requested
                  // scope, and refuses a mismatched fiscal-year ledger straight after. Reuse
                  // the block the saved run reports about itself rather than inventing one.
                  const savedRunIsThisPreset =
                    getScopeMatchedFiledReturnsSummary(preset.scope, savedRun) !== null;
                  const startAction =
                    savedRunBlock && !savedRunIsThisPreset ? savedRunBlock : ownScopeAction;
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
                        {blockedReason ??
                          `${preset.detail} · ${presetPeriodCount(preset)} periods · one ZIP`}
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

/**
 * Keeps the panel's portal context current for as long as the page stays open.
 *
 * The popup cannot go stale: it is torn down the moment the user looks away. This surface
 * is an ordinary extension page, so the user opens the GST tab, signs in, navigates, and
 * comes back — and the mount-time read would still be on screen. Focus and visibility are
 * the browser's own signals for exactly that return, so no timer polls and no permission is
 * added; `PACK_GET_CONTEXT` is the same message the mount already sends.
 *
 * A GST tab changed in a *different* window while this page stays focused raises no such
 * event. That case is left to the user's next interaction rather than answered with a poll.
 */
function usePortalContextRefresh(refresh: () => Promise<void>) {
  React.useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refresh]);
}

/**
 * What the one saved run says about starting anything at all, asked in the only scope where
 * its signals are visible: its own.
 *
 * `getScopeFormStartAction` filters a saved run's signals through `isSameScope`, which is
 * right for the popup — it only ever offers the scope on screen. The panel offers several at
 * once, and the background does not scope its refusal: `startFiledReturnsDownloadFlow`
 * returns the outstanding target review before it reads the requested scope, and refuses a
 * mismatched fiscal-year ledger immediately after. So a saved run that blocks itself blocks
 * every other preset too, and the reason it gives is the reason they must show.
 *
 * `null` while an action is in flight: every control is already disabled by its own guard
 * then, and the saved run's label would name the wrong scope.
 */
function getSavedRunBlock(
  savedRun: FiledReturnsFlowSummary | null,
  busy: string | null,
): { disabled: true; label: string } | null {
  if (!savedRun || busy !== null) return null;
  const action = getScopeFormStartAction(
    savedRun.scope,
    savedRun,
    null,
    isFullFiscalYearScope(savedRun.scope),
  );
  // An enabled action still blocks other scopes when recovery is outstanding: the retained
  // fiscal-year ZIP is offered a retry, not a replacement run under a different scope.
  if (!action.disabled && !hasUnresolvedFiledReturnsRecovery(savedRun)) return null;
  return { disabled: true, label: action.label };
}
