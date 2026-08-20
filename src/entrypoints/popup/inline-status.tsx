import type { FiledReturnsFlowSummary } from "../../connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../connectors/gst/filed-returns-scope";
import type { PopupPresentationState } from "./presentation-state";
import { canReconcileFiledReturnsTarget, RunProgress } from "./run-summary";
import {
  hasPersistedFullFiscalYearZipDownloadId,
  isAmbiguousFullFiscalYearZipHandoff,
} from "./flow-summary";
import { targetReviewPortalDisabledReason } from "./recovery-actions";

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
  const copy = getInlineStatusCopy(presentation, summary);
  if (!copy) return null;

  const actionBusy = busy !== null;
  const primaryAction = getInlinePrimaryAction(presentation, summary, {
    onOpenPortal,
    onRestartTarget,
    onRetryFullFiscalYearTarget,
    onRetryTarget,
  });
  const portalDisabledReason = !portalReady ? (primaryAction?.portalDisabledReason ?? null) : null;

  return (
    <section
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
        {presentation.kind === "downloading" && summary ? <RunProgress summary={summary} /> : null}
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
    return {
      body: "Keep the GST Portal tab open while Pack prepares the files.",
      icon: "↓",
      title: "Packing your files",
      tone: "neutral",
    };
  }
  if (presentation.kind === "complete") {
    const periods = summary?.completedPeriods.length ?? 0;
    const isFullYear = summary?.scope.period === FULL_FISCAL_YEAR_PERIOD;
    const filenameOverridden =
      summary?.flowStep.safeSignals.includes("download-filename-overridden") ||
      summary?.flowStep.safeSignals.includes("zip-download-filename-overridden");
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

export function getInlinePrimaryAction(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
  actions: Pick<
    InlineStatusProps,
    "onOpenPortal" | "onRestartTarget" | "onRetryFullFiscalYearTarget" | "onRetryTarget"
  >,
): { label: string; onClick: () => void; portalDisabledReason?: string } | null {
  if (presentation.kind === "error") {
    return { label: "Open GST Portal", onClick: actions.onOpenPortal };
  }
  if (!summary) return null;

  const signals = new Set(summary.flowStep.safeSignals);
  if (presentation.kind === "blocked" && summary.fullFiscalYearRecovery) {
    return {
      label: summary.currentPeriod ? `Retry ${summary.currentPeriod}` : "Resume saved period",
      onClick: actions.onRetryFullFiscalYearTarget,
      portalDisabledReason: summary.currentPeriod
        ? `Open a signed-in GST Portal tab before retrying ${summary.currentPeriod}.`
        : "Open a signed-in GST Portal tab before resuming the saved period.",
    };
  }
  if (signals.has("filed-returns-target-review-required") && summary.currentPeriod) {
    if (canReconcileFiledReturnsTarget(summary)) {
      return {
        label: "Reconcile browser download",
        onClick: actions.onRetryTarget,
        portalDisabledReason: targetReviewPortalDisabledReason(summary),
      };
    }
    if (signals.has("filed-returns-target-local-cleanup-required")) {
      return {
        label: "Retry local cleanup",
        onClick: actions.onRetryTarget,
        portalDisabledReason: targetReviewPortalDisabledReason(summary),
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
