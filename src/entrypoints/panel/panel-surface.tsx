import React from "react";
import { browser } from "wxt/browser";
import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";
import { isFullFiscalYearScope } from "../../connectors/gst/filed-returns-scope";
import { ContextState } from "../popup/context-state";
import {
  canRetryFullFiscalYearZipWithoutPortal,
  getFullFiscalYearCleanupCopy,
  hasUnresolvedFiledReturnsRecovery,
} from "../popup/flow-summary";
import { InlineStatus } from "../popup/inline-status";
import { LastRunDiagnostics } from "../popup/last-run-diagnostics";
import { PackSummary } from "../popup/pack-summary";
import { TargetEvidence } from "../popup/target-evidence";
import { getPopupPresentationState, isGstSignInRequired } from "../popup/presentation-state";
import { RecoveryActions, hasRecoveryActions } from "../popup/recovery-actions";
import { getScopeFormStartAction } from "../popup/scope-form-model";
import type { usePackPopupController } from "../popup/use-pack-popup-controller";
import { PanelGuidedScope } from "./panel-guided-scope";

export type PackPanelController = ReturnType<typeof usePackPopupController>;

/**
 * The panel's rendered surface, separated from the mount so it can be rendered in a test
 * with a controller in any state. The gap this separation exists to close was a terminal
 * run that rendered nothing at all: only a render assertion catches that.
 */
export function PanelSurface({ pack }: { pack: PackPanelController }) {
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
  const portalAccessDenied = pack.context?.pageKind === "gst-access-denied";
  const cleanupCopy = getFullFiscalYearCleanupCopy(summary);
  const running = pack.effectiveBusy !== null || summary?.status === "running";

  useRefreshOnReturn(pack.refreshPortalContext, pack.refreshFlowSummary);

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
  // Only a clean completion collapses its history. A run that needs review keeps
  // every row visible -- an exception must never be behind a disclosure.
  const runComplete = presentation.kind === "complete" && !hasRecoveryActions(summary ?? null);

  const showFlow =
    (portalReady || canRetryFullFiscalYearZipWithoutPortal(summary) || terminalSummary) &&
    !["access-denied", "loading", "unsupported"].includes(presentation.kind);

  const openPortal = () => void browser.tabs.create({ url: "https://www.gst.gov.in" });

  return (
    <main className="panel-shell">
      {/* Lockup per design-lab/01-claude/04-brand.md: mark, "Pack" at full weight, then
          ComplyEaze as a separate muted publisher credit. Legible precisely because it is not
          squeezed into one wordmark asset. */}
      <header className="panel-head">
        <img className="panel-mark" src="/brand/pack-mark.svg" alt="" aria-hidden="true" />
        <span className="panel-name" role="heading" aria-level={1}>
          Pack
        </span>
        <span className="panel-publisher">ComplyEaze</span>
      </header>
      <p className={portalSignedIn ? "panel-source panel-source-live" : "panel-source"}>
        <span
          className={portalSignedIn ? "panel-source-dot" : "panel-source-dot panel-source-dot-off"}
          aria-hidden="true"
        />
        {portalSignedIn
          ? "GST portal · signed in"
          : portalAccessDenied
            ? "GST Portal · access blocked"
            : (cleanupCopy?.contextLabel ?? "Open a signed-in GST Portal tab")}
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
            {/* Below the pack card, above the recovery actions: a reader who
                sees "needs review" here is one row away from the control that
                resolves it.
                
                `summary`, not `scopedFlowSummary`. Changing the selection while
                a saved run still needs recovery nulls the scoped summary while
                the recovery controls stay actionable -- reading the scoped one
                here hid the per-period evidence at exactly the moment it
                explains what those controls are for. */}
            {/* A finished run is history, not the current context. Left expanded
                it pushed the presets four sections down, so every new run began
                by scrolling past the last one, and the custom door -- further
                down still -- was harder to find than the presets. Only a clean
                completion folds away; anything needing review stays open. */}
            {runComplete ? (
              <details className="panel-finished-run">
                <summary>Show what this run saved</summary>
                <PanelRunProgress summary={summary ?? null} />
                <TargetEvidence summary={summary ?? null} />
              </details>
            ) : (
              <>
                <PanelRunProgress summary={summary ?? null} />
                <TargetEvidence summary={summary ?? null} />
              </>
            )}
            {hasRecoveryActions(summary ?? null) ? (
              <p className="panel-recovery-reason">
                Why Pack paused: {summary?.flowStep.safeMessage}
              </p>
            ) : null}
            {hasRecoveryActions(summary ?? null) ? (
              <RecoveryActions
                busy={pack.effectiveBusy}
                collapsed
                /*
                 * Signed-in, not merely supported. The auth landing page is
                 * `supported: true` -- that is how Pack offers to act on it -- so
                 * gating on `portalReady` enabled portal-dependent recovery on a
                 * signed-out tab. The background then discards saved recovery state
                 * for a run it cannot continue, which is not recoverable afterwards.
                 */
                portalReady={portalSignedIn}
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
            {running ? null : (
              <PanelGuidedScope
                busy={pack.effectiveBusy}
                context={pack.context}
                externalBlock={savedRunBlock}
                flowSummary={pack.scopedFlowSummary}
                portalSignedIn={portalSignedIn}
                savedRun={savedRun}
                scope={pack.scope}
                scopeLockedForReview={pack.scopeLockedForReview}
                onScopeChange={pack.setScope}
                onStart={(scope) => void pack.startFiledReturnsFlow(scope)}
              />
            )}
          </>
        ) : (
          <ContextState status={presentation} onOpenPortal={openPortal} />
        )}
      </div>

      <footer className="panel-foot">
        <p className="panel-fine">Local only · GST login and files stay on this device.</p>
        {/*
          Carried over when the popup folded into this surface. It was the popup's
          only route to the last run's state, reason and safe signals, so folding
          without it would have deleted a diagnostic rather than moved it.
        */}
        <LastRunDiagnostics summary={pack.lastRunSummary} />
        {/* Required wherever the Pack mark appears. See DESIGN.md and AGENTS.md. */}
        <p className="panel-fine">
          Not affiliated with, endorsed by, or operated by GSTN, CBIC, or the Government of India.
        </p>
      </footer>
    </main>
  );
}

function PanelRunProgress({ summary }: { summary: FiledReturnsFlowSummary | null }) {
  const plan = summary?.targetEvidence;
  if (!plan || plan.length === 0) return null;
  const saved = plan.filter((target) => target.outcome === "saved").length;
  return (
    <section className="panel-run-progress" aria-label="Run progress">
      <div className="panel-run-progress-track" aria-hidden="true">
        <span style={{ width: `${(saved / plan.length) * 100}%` }} />
      </div>
      <p>
        <strong>
          {saved} of {plan.length} saved
        </strong>
      </p>
    </section>
  );
}

/**
 * Keeps the panel's portal context and saved run current for as long as the page stays open.
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
function useRefreshOnReturn(
  refreshPortalContext: () => Promise<void>,
  refreshFlowSummary: () => Promise<void>,
) {
  useReturnToPage(
    React.useCallback(() => {
      void refreshPortalContext();
      // The saved run is re-read here for the same reason the portal context is, and one
      // reason more: a run that has stopped emits no storage change, so this is the only
      // moment the panel learns that the background now calls it interrupted.
      void refreshFlowSummary();
    }, [refreshPortalContext, refreshFlowSummary]),
  );
}

/**
 * Calls back when the user returns to this page, and only then. Portal context
 * must not be answered from a mount-time reading, so it is woken by the browser's
 * own focus and visibility signals rather than a polling timer.
 */
function useReturnToPage(onReturn: () => void) {
  React.useEffect(() => {
    const handle = () => {
      if (document.visibilityState !== "visible") return;
      onReturn();
    };
    window.addEventListener("focus", handle);
    document.addEventListener("visibilitychange", handle);
    return () => {
      window.removeEventListener("focus", handle);
      document.removeEventListener("visibilitychange", handle);
    };
  }, [onReturn]);
}

/**
 * What the one saved run says about starting anything at all, asked in the only scope where
 * its signals are visible: its own.
 *
 * `getScopeFormStartAction` filters a saved run's signals through `isSameScope`, which is
 * right for the popup — it only ever offers the scope on screen. The panel lets the user change
 * that scope while a saved run remains, and the background does not scope its refusal:
 * `startFiledReturnsDownloadFlow`
 * returns the outstanding target review before it reads the requested scope, and refuses a
 * mismatched fiscal-year ledger immediately after. So a saved run that blocks itself blocks
 * every other selected scope too, and the reason it gives is the reason they must show.
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
