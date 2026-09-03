import React from "react";
import { browser } from "wxt/browser";
import type {
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  FiledReturnsFlowSummary,
  FiledReturnsTargetOutcome,
} from "../../connectors/gst/filed-returns-contracts";
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
import { getRecoveryFlowAvailability } from "../popup/recovery-flow-availability";
import { getScopeFormStartAction } from "../popup/scope-form-model";
import type { usePackPopupController } from "../popup/use-pack-popup-controller";
import { PanelGuidedScope, isPackAlphaBuildMode } from "./panel-guided-scope";
import {
  panelAllReturnsFullYearPreset,
  panelAllReturnsFullYearResumePlan,
} from "./panel-guided-scope-model";

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
  const allSupportedSummary = pack.allSupportedFullFiscalYearFlowSummary;
  const allSupportedRunning = allSupportedSummary?.status === "running";
  const running =
    pack.effectiveBusy !== null || summary?.status === "running" || allSupportedRunning;
  const fullYearFlowAvailable = isPackAlphaBuildMode(import.meta.env.MODE);
  const recoveryAvailability = getRecoveryFlowAvailability(summary, fullYearFlowAvailable);
  const recoveryReason = recoveryAvailability.message;

  useRefreshOnReturn(pack.refreshPortalContext, pack.refreshFlowSummary);

  const savedRun = pack.lastRunSummary;
  const savedRunBlock = getSavedRunBlock(savedRun, pack.effectiveBusy, fullYearFlowAvailable);
  const allSupportedRunBlock = getAllSupportedRunBlock(allSupportedSummary, pack.effectiveBusy);
  const allReturnsTerminalBlocks = getAllSupportedTerminalBlocks(allSupportedSummary);

  /**
   * The summary card's restart, revalidated the way the preset's is. A panel
   * left open across a period boundary still shows the completed evidence, but
   * a restart rebuilds the plan from the current date -- so dispatching the
   * captured identity would delete the completed ledger and then start periods
   * the displayed evidence never contained. Refresh instead and let the reader
   * act on what they can see.
   */
  const restartFromSummaryCard = async () => {
    if (!allSupportedSummary) return;
    const financialYear = allSupportedSummary.summaryIdentity.financialYear;
    const displayedPeriods = new Set(
      allSupportedSummary.targetEvidence.map((entry) => entry.period),
    ).size;
    if (
      panelAllReturnsFullYearPreset(financialYear, new Date())?.periodCount !== displayedPeriods
    ) {
      await pack.refreshFlowSummary();
      return;
    }
    if (allSupportedSummary.ledgerId === undefined) {
      await pack.refreshFlowSummary();
      return;
    }
    await pack.restartAllSupportedFullFiscalYearFlow({
      ...allSupportedSummary.summaryIdentity,
      ledgerId: allSupportedSummary.ledgerId,
    });
  };
  const allSupportedNeedsRecovery = Boolean(
    allSupportedSummary && ["blocked", "partial", "cancelled"].includes(allSupportedSummary.status),
  );
  // The saved plan blocks other scopes, but not its own resume: the runner retries the saved ZIP or
  // cleanup phase when this same start is invoked again, and blocking that leaves discarding the
  // plan as the only route out of a recoverable state.
  const allReturnsResumePlan = allSupportedSummary?.resumeAvailable
    ? panelAllReturnsFullYearResumePlan(allSupportedSummary)
    : null;
  const allReturnsResumeLocalOnly = allSupportedResumeIsLocalOnly(allSupportedSummary);

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
    Boolean(allSupportedSummary) ||
    hasRecoveryActions(summary ?? null) ||
    terminalSummary ||
    ((portalReady || canRetryFullFiscalYearZipWithoutPortal(summary)) &&
      !["access-denied", "loading", "session-expired", "unsupported"].includes(presentation.kind));

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
            {allSupportedSummary ? (
              <AllSupportedRunStatus
                summary={allSupportedSummary}
                busy={pack.effectiveBusy}
                fullYearFlowAvailable={fullYearFlowAvailable}
                portalReady={portalSignedIn}
                onRestart={() => void restartFromSummaryCard()}
                onResume={() =>
                  void pack.startAllSupportedFullFiscalYearFlow(allSupportedSummary.summaryIdentity)
                }
                onRetryTarget={() => {
                  const recovery = allSupportedSummary.allSupportedFullFiscalYearRecovery;
                  if (!recovery || allSupportedSummary.ledgerId === undefined) return;
                  void pack.retryAllSupportedFullFiscalYearTarget({
                    financialYear: allSupportedSummary.summaryIdentity.financialYear,
                    ledgerId: allSupportedSummary.ledgerId,
                    targetId: recovery.targetId,
                    expectedRevision: recovery.expectedRevision,
                  });
                }}
              />
            ) : null}
            <InlineStatus
              busy={pack.effectiveBusy}
              fullYearFlowAvailable={fullYearFlowAvailable}
              onOpenPortal={openPortal}
              onRestartTarget={() => void pack.startFiledReturnsFlow()}
              onRetryFullFiscalYearTarget={() => void pack.retryFullFiscalYearTarget()}
              onRetryTarget={() => void pack.retryFiledReturnsTarget()}
              portalReady={portalSignedIn}
              presentation={presentation}
              summary={summary}
            />
            {terminalSummary && presentation.kind === "session-expired" ? (
              <p className="panel-recovery-reason">{recoveryReason}</p>
            ) : null}
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
            {allSupportedSummary ? (
              <>
                <PanelRunProgress evidence={allSupportedSummary.targetEvidence} />
                <TargetEvidence evidence={allSupportedSummary.targetEvidence} groupByReturn />
              </>
            ) : runComplete ? (
              <details className="panel-finished-run">
                <summary>Show what this run saved</summary>
                <PanelRunProgress
                  {...(summary?.targetEvidence ? { evidence: summary.targetEvidence } : {})}
                />
                <TargetEvidence summary={summary ?? null} />
              </details>
            ) : (
              <>
                <PanelRunProgress
                  {...(summary?.targetEvidence ? { evidence: summary.targetEvidence } : {})}
                />
                <TargetEvidence summary={summary ?? null} />
              </>
            )}
            {allSupportedNeedsRecovery ? (
              <p className="panel-recovery-reason">
                Why Pack paused: {allSupportedSummary?.flowStep.safeMessage}
              </p>
            ) : null}
            {hasRecoveryActions(summary ?? null) ? (
              <p className="panel-recovery-reason">Why Pack paused: {recoveryReason}</p>
            ) : null}
            {hasRecoveryActions(summary ?? null) ? (
              <RecoveryActions
                // Withheld everywhere else in a packaged build, the full-year flow was still
                // reachable here: a ledger persisted by an earlier release renders recovery
                // controls that resume or restart it.
                fullYearFlowAvailable={fullYearFlowAvailable}
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
                externalBlock={savedRunBlock ?? allSupportedRunBlock}
                allReturnsExternalBlock={savedRunBlock ?? allSupportedRunBlock}
                {...(allReturnsTerminalBlocks.length > 0 ? { allReturnsTerminalBlocks } : {})}
                {...(allReturnsResumePlan ? { allReturnsResumePlan } : {})}
                flowSummary={pack.scopedFlowSummary}
                portalSignedIn={portalSignedIn || allReturnsResumeLocalOnly}
                savedRun={savedRun}
                scope={pack.scope}
                scopeLockedForReview={pack.scopeLockedForReview}
                onScopeChange={pack.setScope}
                onStart={(scope) => void pack.startFiledReturnsFlow(scope)}
                onStartAllReturnsFullYear={(plan) =>
                  void pack.startAllSupportedFullFiscalYearFlow(plan)
                }
                // The plan already carries the ledger id of the root whose
                // control was clicked, which is not always the projected
                // summary's: several completed roots can each render one.
                onRestartAllReturnsFullYear={(plan) => {
                  const ledgerId = plan.ledgerId;
                  if (ledgerId === undefined) {
                    void pack.refreshFlowSummary();
                    return;
                  }
                  void pack.restartAllSupportedFullFiscalYearFlow({
                    kind: plan.kind,
                    financialYear: plan.financialYear,
                    ledgerId,
                  });
                }}
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

function AllSupportedRunStatus({
  summary,
  busy,
  fullYearFlowAvailable,
  portalReady,
  onRestart,
  onResume,
  onRetryTarget,
}: {
  summary: FiledReturnsAllSupportedFullFiscalYearFlowSummary;
  busy: string | null;
  fullYearFlowAvailable: boolean;
  portalReady: boolean;
  onRestart: () => void;
  onResume: () => void;
  onRetryTarget: () => void;
}) {
  const returnCount = new Set(summary.targetEvidence.map((entry) => entry.returnType)).size;
  const periodCount = new Set(summary.targetEvidence.map((entry) => entry.period)).size;
  // Withheld everywhere else in a packaged build, the full-year flow was still
  // reachable here: retained all-supported state renders controls that restart
  // or resume a source-only runner, while `PanelGuidedScope` correctly hides
  // its presets.
  //
  // Both actions reach the portal, so both need a signed-in tab -- restarting
  // clears the completed plan *before* the runner's tab preflight, so without
  // this the history is already gone by the time the first target blocks. The
  // one exception is a resume whose remaining work is local ZIP or cleanup:
  // that needs no portal, and requiring one would disable the only productive
  // control the reader has.
  const localOnlyResume = summary.resumeAvailable && summary.resumeMode === "local-only";
  const canRestart = fullYearFlowAvailable && summary.status === "complete";
  const canResume = fullYearFlowAvailable && summary.resumeAvailable === true;
  const recovery = summary.allSupportedFullFiscalYearRecovery;
  const recoveryEvidence = recovery
    ? summary.targetEvidence.find((target) => target.targetId === recovery.targetId)
    : undefined;
  const canRetryTarget =
    fullYearFlowAvailable && recovery !== undefined && recoveryEvidence !== undefined;
  return (
    <section className="panel-all-supported-run" aria-label="All supported returns progress">
      <p>
        <strong>
          Your pack · All supported returns · FY {summary.summaryIdentity.financialYear}
        </strong>
      </p>
      {summary.targetEvidence.length > 0 ? (
        <p>
          {returnCount} return types · {periodCount} periods
        </p>
      ) : null}
      <p aria-live="polite">{summary.flowStep.safeMessage}</p>
      {canRestart ? (
        <button
          className="panel-all-supported-action"
          type="button"
          disabled={busy !== null || !portalReady}
          onClick={onRestart}
        >
          Discard this year's saved plan and run again
        </button>
      ) : canResume ? (
        <button
          className="panel-all-supported-action"
          type="button"
          disabled={busy !== null || (!portalReady && !localOnlyResume)}
          onClick={onResume}
        >
          Resume this plan
        </button>
      ) : canRetryTarget ? (
        <button
          className="panel-all-supported-action"
          type="button"
          disabled={busy !== null || !portalReady}
          onClick={onRetryTarget}
        >
          Review Downloads, then retry {recoveryEvidence.returnType} for {recoveryEvidence.period}
        </button>
      ) : null}
    </section>
  );
}

function PanelRunProgress({
  evidence,
}: {
  evidence?: readonly { outcome: FiledReturnsTargetOutcome }[];
}) {
  if (!evidence || evidence.length === 0) return null;
  const saved = evidence.filter((target) => target.outcome === "saved").length;
  return (
    <section className="panel-run-progress" aria-label="Run progress">
      <div className="panel-run-progress-track" aria-hidden="true">
        <span style={{ width: `${(saved / evidence.length) * 100}%` }} />
      </div>
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
  fullYearFlowAvailable: boolean,
): { disabled: true; label: string } | null {
  if (!savedRun || busy !== null) return null;
  const action = getScopeFormStartAction(
    savedRun.scope,
    savedRun,
    null,
    isFullFiscalYearScope(savedRun.scope),
  );
  const recoveryAvailability = getRecoveryFlowAvailability(savedRun, fullYearFlowAvailable);
  if (recoveryAvailability.isWithheldFullYearRecovery) {
    return {
      disabled: true,
      label: recoveryAvailability.guidance!,
    };
  }
  // An enabled action still blocks other scopes when recovery is outstanding: the retained
  // fiscal-year ZIP is offered a retry, not a replacement run under a different scope.
  if (!action.disabled && !hasUnresolvedFiledReturnsRecovery(savedRun)) return null;
  return { disabled: true, label: action.label };
}

function getAllSupportedRunBlock(
  summary: PackPanelController["allSupportedFullFiscalYearFlowSummary"],
  busy: string | null,
): { disabled: true; label: string } | null {
  if (!summary || busy !== null) return null;
  if (["complete", "cancelled"].includes(summary.status)) return null;
  return {
    disabled: true,
    label:
      "Discard the saved all-supported fiscal-year plan from its run summary before starting another return.",
  };
}

function getAllSupportedTerminalBlocks(
  summary: PackPanelController["allSupportedFullFiscalYearFlowSummary"],
): readonly {
  financialYear: string;
  label: string;
  restartPlan?: true;
  ledgerId?: string;
}[] {
  const terminalRoots =
    summary?.terminalPlanRoots ??
    (summary && ["complete", "cancelled"].includes(summary.status)
      ? [
          {
            financialYear: summary.summaryIdentity.financialYear,
            status: summary.status,
            periodCount: panelAllReturnsFullYearResumePlan(summary)?.periodCount ?? 0,
            ledgerId: summary.ledgerId,
          },
        ]
      : []);
  return terminalRoots.flatMap((root) => {
    const currentPlan = panelAllReturnsFullYearPreset(root.financialYear);
    if (root.status === "complete" && currentPlan && currentPlan.periodCount > root.periodCount)
      return [];
    return [
      {
        financialYear: root.financialYear,
        label:
          root.status === "complete"
            ? "Pack already completed this all-supported plan. Discard this fiscal year's saved plan and start again."
            : "Pack retained this cancelled all-supported plan. It remains unavailable until Pack can safely resolve its saved recovery state.",
        ...(root.status === "complete" ? { restartPlan: true as const } : {}),
        // Carried per root: a restart must name the plan the reader reviewed,
        // and there can be more retained roots than the one projected here.
        ...(root.ledgerId === undefined ? {} : { ledgerId: root.ledgerId }),
      },
    ];
  });
}

function allSupportedResumeIsLocalOnly(
  summary: PackPanelController["allSupportedFullFiscalYearFlowSummary"],
): boolean {
  return summary?.resumeAvailable === true && summary.resumeMode === "local-only";
}
