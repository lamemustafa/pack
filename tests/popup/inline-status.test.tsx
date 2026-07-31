import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import {
  getInlinePrimaryAction,
  InlineStatus,
  hasInlinePrimaryAction,
} from "../../src/entrypoints/popup/inline-status";
import type { PopupPresentationState } from "../../src/entrypoints/popup/presentation-state";

const blockedPresentation: PopupPresentationState = {
  badge: "Needs review",
  body: "Retry after checking the GST Portal page.",
  icon: "!",
  kind: "blocked",
  title: "May needs attention",
  tone: "warning",
};

const blockedSummary: FiledReturnsFlowSummary = {
  scope: { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" },
  status: "blocked",
  completedPeriods: [],
  totalPeriods: 1,
  currentPeriod: "May",
  updatedAt: "2026-07-10T00:00:00.000Z",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "user-action-required",
    safeSignals: ["filed-return-filter-candidate-not-found"],
    safeMessage: "Select the filed return filters in the GST portal, then start Pack again.",
  },
};

describe("inline filed-return recovery status", () => {
  it("renders every safe missing artifact reason for a partial ZIP", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      status: "partial",
      currentPeriod: undefined,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "partial",
        safeSignals: ["filed-return-artifact-unavailable:EXCEL", "artifact-generation-timeout"],
        safeMessage: "Pack prepared a partial ZIP; missing EXCEL (artifact-generation-timeout).",
      },
    };
    const presentation: PopupPresentationState = {
      badge: "Partly complete",
      body: summary.flowStep.safeMessage,
      icon: "!",
      kind: "partial",
      title: "Download partly complete",
      tone: "warning",
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={presentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("EXCEL (artifact-generation-timeout)");
  });

  it("renders the cross-origin blocked start message", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["wrong-origin-open-returns-dashboard"],
        safeMessage: "Open Returns Dashboard in the GST Portal, then press Start again.",
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("Open Returns Dashboard in the GST Portal");
  });

  it("describes a completed full fiscal year as one ZIP", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      status: "complete",
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "downloaded",
        safeSignals: ["full-fiscal-year-complete", "full-fiscal-year-zip-downloaded"],
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Complete",
          body: "Complete.",
          icon: "✓",
          kind: "complete",
          title: "Download complete",
          tone: "success",
        }}
        summary={summary}
      />,
    );

    expect(markup).toContain("2 periods saved as one ZIP.");
    expect(markup).not.toContain("The selected file was saved by your browser.");
  });

  it("renders a completed filename override message", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      status: "complete",
      completedPeriods: ["May"],
      flowStep: {
        ...blockedSummary.flowStep,
        state: "downloaded",
        safeSignals: ["download-filename-overridden"],
        safeMessage:
          "Another extension changed where this file was saved. Check browser Downloads before using it.",
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Complete",
          body: "Complete.",
          icon: "✓",
          kind: "complete",
          title: "Download complete",
          tone: "success",
        }}
        summary={summary}
      />,
    );

    expect(markup).toContain("Another extension changed where this file was saved");
    expect(markup).not.toContain("download.pdf");
  });

  it("renders the filename-free ZIP override message ahead of the full-year success summary", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      status: "complete",
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "downloaded",
        safeSignals: ["full-fiscal-year-zip-downloaded", "zip-download-filename-overridden"],
        safeMessage:
          "Pack completed the ZIP download, but the browser saved it under a different name. Check browser Downloads before using the file.",
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Complete",
          body: "Complete.",
          icon: "✓",
          kind: "complete",
          title: "Download complete",
          tone: "success",
        }}
        summary={summary}
      />,
    );

    expect(markup).toContain("browser saved it under a different name");
    expect(markup).not.toContain("2 periods saved as one ZIP.");
  });

  it("shows the final-ZIP check warning without requiring a current period", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      currentPeriod: undefined,
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-final-zip-retry",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-zip-phase:download-started",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage:
          "Pack started the final fiscal-year ZIP download before the previous run stopped. Check browser Downloads before retrying it.",
      },
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("Check Browser Downloads");
    expect(markup).toContain("Check browser Downloads before retrying it");
  });

  it("offers exact-ID status reconciliation without another ZIP download", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      currentPeriod: undefined,
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-final-zip-manual-review",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-zip-phase:download-observing",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage:
          "Pack saved the browser download ID and must reconcile that exact download before another ZIP can start.",
      },
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("Check final ZIP status");
    expect(markup).toContain("reconcile that exact download");
  });

  it("offers an explicit retry for a blocked period", () => {
    expect(hasInlinePrimaryAction(blockedPresentation, blockedSummary)).toBe(true);
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const action = getInlinePrimaryAction(blockedPresentation, blockedSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget,
    });
    action?.onClick();

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={blockedSummary}
      />,
    );

    expect(markup).toContain("Retry May");
    expect(markup).toContain(
      "Select the filed return filters in the GST portal, then start Pack again.",
    );
    expect(onRestartTarget).toHaveBeenCalledOnce();
    expect(onRetryTarget).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous no-ID review fail-closed behind explicit run controls", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-target-review-required"],
      },
    };
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const action = getInlinePrimaryAction(blockedPresentation, targetReviewSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget,
    });
    expect(action).toBeNull();
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={targetReviewSummary}
      />,
    );

    expect(markup).toContain("May needs review");
    expect(markup).toContain("Resolve May before choosing another period");
    expect(markup).toContain("More run controls");
    expect(markup).toContain("Check Browser Downloads");
    expect(markup).not.toContain("Retry May");
    expect(onRetryTarget).not.toHaveBeenCalled();
    expect(onRestartTarget).not.toHaveBeenCalled();
  });

  it("labels an exact-ID target action as reconciliation", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "filed-returns-target-review-required",
          "filed-returns-download-reconciliation-required",
        ],
      },
    };
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const action = getInlinePrimaryAction(blockedPresentation, targetReviewSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget,
    });
    action?.onClick();

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={targetReviewSummary}
      />,
    );

    expect(action?.label).toBe("Reconcile browser download");
    expect(markup).toContain("Reconcile browser download");
    expect(markup).not.toContain("Retry May");
    expect(onRetryTarget).toHaveBeenCalledOnce();
    expect(onRestartTarget).not.toHaveBeenCalled();
  });

  it("does not advertise manual completion for an incomplete selected-file ZIP", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-target-review-required", "single-period-zip-incomplete"],
      },
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={() => undefined}
        onRestartTarget={() => undefined}
        onRetryFullFiscalYearTarget={() => undefined}
        onRetryTarget={() => undefined}
        presentation={blockedPresentation}
        summary={targetReviewSummary}
      />,
    );

    expect(markup).toContain("discard the saved state and start the selected files again");
    expect(markup).toContain("cancel and reset");
    expect(markup).not.toContain("mark it reviewed");
  });

  it("routes a blocked full-year period to the revision-checked full-year retry", () => {
    const onRetryFullFiscalYearTarget = vi.fn();
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const fullYearSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: "ALL" },
      fullFiscalYearRecovery: {
        ledgerId: "ledger-safe",
        targetId: "target-safe",
        expectedRevision: 2,
        targetStatus: "blocked",
      },
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["detail-summary-modal-close-control-not-found"],
      },
    };
    const action = getInlinePrimaryAction(blockedPresentation, fullYearSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget,
      onRetryTarget,
    });

    action?.onClick();

    expect(action?.label).toBe("Retry May");
    expect(onRetryFullFiscalYearTarget).toHaveBeenCalledOnce();
    expect(onRetryTarget).not.toHaveBeenCalled();

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={onRetryFullFiscalYearTarget}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={fullYearSummary}
      />,
    );
    expect(markup).toContain("Full-year run paused at May");
    expect(markup).toContain("summary overlay opened before Pack found a recognized Close control");
  });

  it("explains when the portal keeps its overlay open after the recognized Close click", () => {
    const fullYearSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: "ALL" },
      fullFiscalYearRecovery: {
        ledgerId: "ledger-safe",
        targetId: "target-safe",
        expectedRevision: 2,
        targetStatus: "blocked",
      },
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["detail-summary-modal-close-blocked"],
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={fullYearSummary}
      />,
    );

    expect(markup).toContain("kept its summary overlay open after Pack clicked");
  });
});
