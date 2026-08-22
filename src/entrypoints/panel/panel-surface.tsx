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
import { panelPresets, presetPeriodCount, type PanelPreset, type PanelView } from "./panel-presets";

export type PackPanelController = ReturnType<typeof usePackPopupController>;

/**
 * The panel's rendered surface, separated from the mount so it can be rendered in a test
 * with a controller in any state. The gap this separation exists to close was a terminal
 * run that rendered nothing at all: only a render assertion catches that.
 */
export function PanelSurface({ pack }: { pack: PackPanelController }) {
  const [view, setView] = React.useState<PanelView>("presets");
  const {
    presets,
    periodCounts,
    refresh: refreshPresets,
    isStale: presetsAreStale,
  } = usePanelPresets();

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
                {presets.map((preset, presetIndex) => {
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
                      onClick={() => {
                        // Never submit a scope the button is not showing. The
                        // first version of this recomputed at click time and
                        // started the fresh scope, so a stale label could read
                        // 2025-26 while the run downloaded 2026-27 -- a user
                        // getting something other than the target they clicked,
                        // which is worse than the staleness it was fixing.
                        if (presetsAreStale()) {
                          refreshPresets();
                          return;
                        }
                        void pack.startFiledReturnsFlow(preset.scope);
                      }}
                    >
                      <span>{preset.label}</span>
                      <span className="panel-choice-detail">
                        {blockedReason ??
                          `${preset.detail} · ${periodCounts[presetIndex]} periods · one ZIP`}
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
  useReturnToPage(
    React.useCallback(() => {
      void refresh();
    }, [refresh]),
  );
}

/**
 * Calls back when the user returns to this page, and only then. Both things the
 * panel must not answer from a mount-time reading -- the portal context and the
 * presets' "now" -- go stale for the same reason and are woken by the same
 * signals, so there is one listener pair rather than two.
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
 * Presets are normalised against "now". In April the new financial year has no
 * completed period, so `normaliseFiledReturnsScope` answers with the preceding
 * one -- and every string a preset shows is read back off that scope, so a
 * stale basis produces a label that reads correct while the click downloads the
 * wrong year.
 *
 * Computing once at mount was right for the popup, which dies on outside focus.
 * The panel outlives the boundary: one mounted on 30 April would still offer
 * April's answer in May. Recomputed on the browser's own return signals, so no
 * timer polls and no permission is added.
 *
 * The array is kept when the recomputed answer matches, which is every return
 * but the one that crosses a boundary. Handing back a new array each time would
 * re-render the list for nothing.
 */
function usePanelPresets(): {
  presets: PanelPreset[];
  periodCounts: number[];
  refresh: () => void;
  isStale: () => boolean;
} {
  // The identity is SNAPSHOTTED when the presets are stored. Recomputing it for
  // the stored presets defeats the check: `presetPeriodCount` reads the current
  // date, so a panel mounted in June and read in July produced three for both
  // sides and compared equal, while the button still showed two.
  const [rendered, setRendered] = React.useState(renderedPresetsNow);
  const refresh = React.useCallback(() => {
    setRendered((current) => {
      const next = renderedPresetsNow();
      return next.identity === current.identity ? current : next;
    });
  }, []);
  // Deliberately a plain closure over the CURRENT render's snapshot, not a ref:
  // it is only called from a click handler, which is itself recreated each
  // render, so there is no stale-closure risk and no ref read during render.
  const isStale = () => presetsIdentity(panelPresets()) !== rendered.identity;
  useReturnToPage(refresh);
  return {
    presets: rendered.presets,
    periodCounts: rendered.periodCounts,
    refresh,
    isStale,
  };
}

function renderedPresetsNow(): {
  presets: PanelPreset[];
  periodCounts: number[];
  identity: string;
} {
  const presets = panelPresets();
  // The counts are captured HERE, with the presets, and rendered from this
  // snapshot. Reading `presetPeriodCount` again at render time made the button
  // show the current month's count while the stored identity held the old one,
  // so the label moved without the freshness check ever noticing.
  return {
    presets,
    periodCounts: presets.map((preset) => presetPeriodCount(preset)),
    identity: presetsIdentity(presets),
  };
}

// Compares whole presets rather than the fields believed to matter: a preset
// that gained a time-dependent field would otherwise go stale again, silently.
function presetsIdentity(presets: readonly PanelPreset[]): string {
  // The rendered period count is part of what the user is agreeing to, and it is
  // NOT derivable from the preset alone: crossing an ordinary month boundary
  // inside one financial year leaves `panelPresets()` byte-identical while the
  // count rises, so a panel showing "2 periods" in June would accept a click in
  // July and download three.
  return JSON.stringify(presets.map((preset) => [preset, presetPeriodCount(preset)]));
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
