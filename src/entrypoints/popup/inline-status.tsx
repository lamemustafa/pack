import React from "react";
import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../connectors/gst/filed-returns-scope";
import type { PopupPresentationState } from "./presentation-state";
import { canReconcileFiledReturnsTarget, RunProgress } from "./run-summary";
import {
  getFullFiscalYearCleanupCopy,
  hasPersistedFullFiscalYearZipDownloadId,
  isAmbiguousFullFiscalYearZipHandoff,
} from "./flow-summary";
import { getSavedFullFiscalYearActionDecision } from "./recovery-actions";

export interface InlineStatusProps {
  busy: string | null;
  portalReady: boolean;
  onOpenPortal: () => void;
  onRestartTarget: () => void;
  onRetryFullFiscalYearTarget: () => void;
  onRetryTarget: () => void;
  presentation: PopupPresentationState;
  summary: FiledReturnsFlowSummary | null;
}

export function InlineStatus({
  busy,
  portalReady,
  onOpenPortal,
  onRestartTarget,
  onRetryFullFiscalYearTarget,
  onRetryTarget,
  presentation,
  summary,
}: InlineStatusProps) {
  const checkingCleanup =
    busy === "start-filed-returns-flow" && Boolean(getFullFiscalYearCleanupCopy(summary));
  const statusRef = React.useRef<HTMLElement>(null);
  const wasCheckingCleanup = React.useRef(checkingCleanup);
  React.useEffect(() => {
    // The clicked guide disappears; bring its replacement feedback into view.
    if (checkingCleanup && !wasCheckingCleanup.current) statusRef.current?.focus();
    wasCheckingCleanup.current = checkingCleanup;
  }, [checkingCleanup]);
  const copy = getInlineStatusCopy(presentation, summary);
  if (!copy) return null;

  const actionBusy = busy !== null;
  const primaryAction = getInlinePrimaryAction(presentation, summary, {
    onOpenPortal,
    onRestartTarget,
    onRetryFullFiscalYearTarget,
    onRetryTarget,
  });
  const portalDisabledReason = portalReady ? null : (primaryAction?.portalDisabledReason ?? null);

  return (
    <section
      ref={statusRef}
      tabIndex={checkingCleanup ? -1 : undefined}
      className={`inline-status inline-status-${copy.tone}`}
      aria-live="polite"
      aria-label={copy.title}
    >
      <span className="inline-status-icon" aria-hidden="true">
        {copy.icon}
      </span>
      <div className="inline-status-content">
        <strong>{copy.title}</strong>
        <p>{copy.body}</p>
        {presentation.kind === "downloading" &&
        summary &&
        !getFullFiscalYearCleanupCopy(summary) ? (
          <RunProgress summary={summary} />
        ) : null}
        {primaryAction ? (
          <button
            className="inline-status-primary"
            type="button"
            disabled={actionBusy || Boolean(portalDisabledReason)}
            onClick={primaryAction.onClick}
          >
            {actionBusy ? "Working..." : primaryAction.label}
          </button>
        ) : null}
        {portalDisabledReason ? <p className="muted">{portalDisabledReason}</p> : null}
      </div>
    </section>
  );
}

/**
 * Whether the inline primary action is itself portal-gated. The recovery panel
 * suppresses its own portal reason only when this is true, because that is the
 * only case where the two surfaces would print the same sentence twice.
 *
 * Suppressing whenever an inline action merely exists left a portal-gated
 * secondary action in the panel disabled with nothing explaining it, once the
 * inline action became portal-independent.
 */
export function inlinePrimaryActionIsPortalGated(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
): boolean {
  const action = getInlinePrimaryAction(presentation, summary, {
    onOpenPortal: () => undefined,
    onRestartTarget: () => undefined,
    onRetryFullFiscalYearTarget: () => undefined,
    onRetryTarget: () => undefined,
  });
  return action?.portalDisabledReason != null;
}

export function hasInlinePrimaryAction(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
): boolean {
  return Boolean(
    getInlinePrimaryAction(presentation, summary, {
      onOpenPortal: () => undefined,
      onRestartTarget: () => undefined,
      onRetryFullFiscalYearTarget: () => undefined,
      onRetryTarget: () => undefined,
    }),
  );
}

function getInlineStatusCopy(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
): { body: string; icon: string; title: string; tone: "warning" | "success" | "neutral" } | null {
  if (presentation.kind === "downloading") {
    const cleanupCopy = getFullFiscalYearCleanupCopy(summary);
    return {
      body: cleanupCopy
        ? presentation.body
        : "Keep the GST Portal tab open while Pack prepares the files.",
      icon: presentation.icon,
      title: presentation.title,
      tone: "neutral",
    };
  }
  if (presentation.kind === "ready" && summary?.status === "cancelled") {
    return {
      body: presentation.body,
      icon: "✓",
      title: presentation.title,
      tone: "success",
    };
  }
  if (presentation.kind === "complete") {
    const periods = summary?.completedPeriods.length ?? 0;
    const isFullYear = summary?.scope.period === FULL_FISCAL_YEAR_PERIOD;
    const filenameOverridden =
      summary?.flowStep.safeSignals.includes("download-filename-overridden") ||
      summary?.flowStep.safeSignals.includes("zip-download-filename-overridden");
    /**
     * A full-year run carries two separate facts, and `status: "complete"` only
     * knows the first: every period was fetched. `canCompleteFullFiscalYearLedger`
     * requires each target to be positive and says nothing about the final ZIP,
     * so this branch used to announce "12 periods saved as one ZIP" while the
     * delivery line three rows below read "browser download not confirmed" --
     * both on screen, from one run. The ZIP claim was the false one: it asserted
     * a delivery from a state that cannot observe it, and would have said the
     * same had the ZIP never arrived.
     */
    const zipConfirmed = summary?.flowStep.safeSignals.includes("full-fiscal-year-zip-downloaded");
    // A run where every period was positively not-filed produces no ZIP BY
    // DESIGN and says so through its own signal. Treating that absence as an
    // unconfirmed download would send the user hunting in Downloads for a file
    // Pack deliberately never created -- the same contradiction this branch
    // exists to remove, pointed the other way.
    const noZipExpected = summary?.flowStep.safeSignals.includes(
      "full-fiscal-year-no-zip-artifacts",
    );
    // Three distinct full-year outcomes, stated separately. Patching one of them
    // into an exclusion on another is what produced two rounds of contradiction
    // here: excluding the no-artifacts case from the warning dropped it into the
    // success body, which claimed a ZIP that was deliberately never created.
    if (isFullYear && !filenameOverridden && noZipExpected) {
      return {
        body: `${periods} periods processed. No ZIP was created because no eligible files were found.`,
        icon: "–",
        title: "No ZIP created",
        tone: "neutral",
      };
    }
    if (isFullYear && !filenameOverridden && !zipConfirmed) {
      return {
        // `completedPeriods` counts downloaded AND not-filed targets, so these
        // are periods Pack finished with, not files it fetched. "Fetched" would
        // claim a download for every period the portal reported nothing for.
        body: `${periods} periods processed. Pack has not confirmed the browser saved the ZIP -- check browser Downloads.`,
        icon: "!",
        title: "Periods processed, ZIP unconfirmed",
        tone: "warning",
      };
    }
    return {
      body: filenameOverridden
        ? (summary?.flowStep.safeMessage ??
          "The browser changed the saved filename. Check browser Downloads.")
        : isFullYear
          ? `${periods} periods saved as one ZIP.`
          : "The selected file was saved by your browser.",
      icon: "✓",
      title: "Download complete",
      tone: "success",
    };
  }
  if (presentation.kind === "unavailable") {
    return {
      body: "The GST Portal did not report a filed return for this selection.",
      icon: "–",
      title: "No filed return found",
      tone: "neutral",
    };
  }
  if (presentation.kind === "partial") {
    if (summary?.flowStep.safeMessage) {
      return {
        body: summary.flowStep.safeMessage,
        icon: "!",
        title: "Download partly complete",
        tone: "warning",
      };
    }
    const completed = summary?.completedPeriods.length ?? 0;
    const total = summary?.totalPeriods ?? completed;
    return {
      body: `${completed} of ${total} periods downloaded. Pack could not confirm the remaining selection.`,
      icon: "!",
      title: summary?.currentPeriod
        ? `${summary.currentPeriod} could not be confirmed`
        : "Download partly complete",
      tone: "warning",
    };
  }
  if (presentation.kind === "blocked" && isAmbiguousFullFiscalYearZipHandoff(summary)) {
    const exactIdSaved = hasPersistedFullFiscalYearZipDownloadId(summary);
    return {
      body:
        summary?.flowStep.safeMessage ??
        (exactIdSaved
          ? "Pack saved the browser download ID for the final ZIP. Check that exact download before starting another ZIP."
          : "The final ZIP may already have started. Check Browser Downloads before retrying it."),
      icon: "!",
      title: exactIdSaved ? "Check final ZIP status" : "Check Browser Downloads",
      tone: "warning",
    };
  }
  if (presentation.kind === "blocked" && summary?.currentPeriod) {
    const signals = new Set(summary.flowStep.safeSignals);
    const needsTargetReview = signals.has("filed-returns-target-review-required");
    const needsFullFiscalYearRecovery = Boolean(summary.fullFiscalYearRecovery);
    const canReconcileTarget = canReconcileFiledReturnsTarget(summary);
    const canRetryTargetCleanup = signals.has("filed-returns-target-local-cleanup-required");
    return {
      body: needsTargetReview
        ? signals.has("artifact-acquisition-session-proof-expired")
          ? `Pack cannot reconcile ${summary.currentPeriod} after the extension reload cleared its temporary exact-download proof. Check Browser Downloads, then start fresh or cancel and reset.`
          : canReconcileTarget
            ? `Resolve ${summary.currentPeriod} before choosing another period. Finish or cancel any open Save dialog, then reconcile the exact browser download.`
            : canRetryTargetCleanup
              ? `Resolve ${summary.currentPeriod} before choosing another period. Retry the local cleanup; Pack will not click the GST Portal again.`
              : signals.has("single-period-zip-incomplete")
                ? `Resolve ${summary.currentPeriod} before choosing another period. Open More run controls to discard the saved state and start the selected files again, or cancel and reset.`
                : `Resolve ${summary.currentPeriod} before choosing another period. Check Browser Downloads, then open More run controls to record a manual observation, explicitly start fresh, or cancel and reset.`
        : needsFullFiscalYearRecovery
          ? getFullFiscalYearRecoveryBody(summary.currentPeriod, signals)
          : summary.flowStep.safeMessage,
      icon: "!",
      title: needsTargetReview
        ? `${summary.currentPeriod} needs review`
        : needsFullFiscalYearRecovery
          ? `Full-year run paused at ${summary.currentPeriod}`
          : `${summary.currentPeriod} needs a quick check`,
      tone: "warning",
    };
  }
  if (presentation.kind === "blocked" && summary) {
    return {
      body: summary.flowStep.safeMessage,
      icon: "!",
      title: presentation.title,
      tone: "warning",
    };
  }
  if (presentation.kind === "error") {
    return {
      body: presentation.body,
      icon: "!",
      title: "Pack could not confirm the download",
      tone: "warning",
    };
  }
  return null;
}

function getFullFiscalYearRecoveryBody(currentPeriod: string, signals: Set<string>): string {
  if (signals.has("detail-summary-modal-close-blocked")) {
    return `The GST Portal kept its summary overlay open after Pack clicked its recognized Close control. Close it in the portal, then retry ${currentPeriod} to continue the saved full-year run.`;
  }
  if (signals.has("detail-summary-modal-close-control-not-found")) {
    return `The GST Portal summary overlay opened before Pack found a recognized Close control. Wait for it to finish loading, then retry ${currentPeriod} to continue the saved full-year run.`;
  }
  return `The saved full-year run paused at ${currentPeriod}. Resolve the GST Portal page, then retry this period to continue the remaining periods.`;
}

/**
 * `portalDisabledReason` is required, not optional: an action that can be gated on
 * `portalReady` must say why it is disabled, and a missing reason would render a
 * silently disabled button. `null` is the deliberate "never portal-gated" choice.
 */
interface InlinePrimaryAction {
  label: string;
  onClick: () => void;
  portalDisabledReason: string | null;
}

export function getInlinePrimaryAction(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
  actions: Pick<
    InlineStatusProps,
    "onOpenPortal" | "onRestartTarget" | "onRetryFullFiscalYearTarget" | "onRetryTarget"
  >,
): InlinePrimaryAction | null {
  if (presentation.kind === "error") {
    // The only action that makes the portal ready, so it is never portal-gated.
    return { label: "Open GST Portal", onClick: actions.onOpenPortal, portalDisabledReason: null };
  }
  if (!summary) return null;

  const signals = new Set(summary.flowStep.safeSignals);
  if (presentation.kind === "blocked" && summary.currentPeriod && summary.fullFiscalYearRecovery) {
    const { gerund, label } = getSavedFullFiscalYearActionDecision(summary);
    return {
      label,
      onClick: actions.onRetryFullFiscalYearTarget,
      portalDisabledReason: `Open a signed-in GST Portal tab before ${gerund}.`,
    };
  }
  if (signals.has("filed-returns-target-review-required") && summary.currentPeriod) {
    // Both branches below return locally in retryFiledReturnsTargetDownloadFlow before any
    // portal action (see canRetryFiledReturnsTargetWithoutPortal in ./flow-summary), so
    // neither is portal-gated.
    if (canReconcileFiledReturnsTarget(summary)) {
      return {
        label: "Reconcile browser download",
        onClick: actions.onRetryTarget,
        portalDisabledReason: null,
      };
    }
    if (signals.has("filed-returns-target-local-cleanup-required")) {
      return {
        label: "Retry local cleanup",
        onClick: actions.onRetryTarget,
        portalDisabledReason: null,
      };
    }
    return null;
  }
  if (presentation.kind === "blocked" && summary.currentPeriod) {
    return {
      label: `Retry ${summary.currentPeriod}`,
      onClick: actions.onRestartTarget,
      portalDisabledReason: `Open a signed-in GST Portal tab before retrying ${summary.currentPeriod}.`,
    };
  }
  return null;
}
