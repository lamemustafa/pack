import type { FiledReturnsFlowSummary } from "../../core/contracts";
import type { PopupPresentationState } from "./presentation-state";
import { RunProgress } from "./run-summary";

export interface InlineStatusProps {
  busy: string | null;
  onOpenPortal: () => void;
  onRetryFullFiscalYearTarget: () => void;
  onRetryTarget: () => void;
  presentation: PopupPresentationState;
  summary: FiledReturnsFlowSummary | null;
}

export function InlineStatus({
  busy,
  onOpenPortal,
  onRetryFullFiscalYearTarget,
  onRetryTarget,
  presentation,
  summary,
}: InlineStatusProps) {
  const copy = getInlineStatusCopy(presentation, summary);
  if (!copy) return null;

  const actionBusy = busy !== null;
  const primaryAction = getPrimaryAction(presentation, summary, {
    onOpenPortal,
    onRetryFullFiscalYearTarget,
    onRetryTarget,
  });

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
            disabled={actionBusy}
            onClick={primaryAction.onClick}
          >
            {actionBusy ? "Working..." : primaryAction.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function hasInlinePrimaryAction(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
): boolean {
  if (presentation.kind === "error") return true;
  if (!summary) return false;

  const signals = new Set(summary.flowStep.safeSignals);
  return Boolean(
    (presentation.kind === "blocked" && summary.currentPeriod) ||
    (signals.has("filed-returns-target-review-required") && summary.currentPeriod) ||
    (summary.fullFiscalYearRecovery &&
      (signals.has("full-fiscal-year-download-unconfirmed") ||
        signals.has("full-fiscal-year-run-interrupted") ||
        signals.has("full-fiscal-year-run-needs-action") ||
        signals.has("full-fiscal-year-resume-confirmation-required"))),
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
    const isFullYear = summary?.scope.period === "ALL";
    return {
      body: isFullYear
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
  if (presentation.kind === "blocked" && summary?.currentPeriod) {
    return {
      body: "Pack could not confirm this filed return for the selected period.",
      icon: "!",
      title: `${summary.currentPeriod} needs a quick check`,
      tone: "warning",
    };
  }
  if (presentation.kind === "error") {
    return {
      body: "Reopen the filed-return page on the GST Portal, then retry.",
      icon: "!",
      title: "Pack could not confirm the download",
      tone: "warning",
    };
  }
  return null;
}

function getPrimaryAction(
  presentation: PopupPresentationState,
  summary: FiledReturnsFlowSummary | null,
  actions: Pick<
    InlineStatusProps,
    "onOpenPortal" | "onRetryFullFiscalYearTarget" | "onRetryTarget"
  >,
): { label: string; onClick: () => void } | null {
  if (presentation.kind === "error") {
    return { label: "Open GST Portal", onClick: actions.onOpenPortal };
  }
  if (!summary) return null;

  const signals = new Set(summary.flowStep.safeSignals);
  if (presentation.kind === "blocked" && summary.currentPeriod) {
    return { label: `Retry ${summary.currentPeriod}`, onClick: actions.onRetryTarget };
  }
  if (signals.has("filed-returns-target-review-required") && summary.currentPeriod) {
    return { label: `Retry ${summary.currentPeriod}`, onClick: actions.onRetryTarget };
  }
  if (
    summary.fullFiscalYearRecovery &&
    (signals.has("full-fiscal-year-download-unconfirmed") ||
      signals.has("full-fiscal-year-run-interrupted") ||
      signals.has("full-fiscal-year-run-needs-action") ||
      signals.has("full-fiscal-year-resume-confirmation-required"))
  ) {
    return { label: "Resume saved period", onClick: actions.onRetryFullFiscalYearTarget };
  }
  return null;
}
