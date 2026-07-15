import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
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

  it("explains that an unresolved target review blocks choosing another period", () => {
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

    expect(markup).toContain("May needs review");
    expect(markup).toContain("Resolve May before choosing another period");
    expect(markup).toContain("More run controls");
    expect(markup).toContain("after checking Browser Downloads");
    expect(markup).toContain("Retry May");
    expect(onRetryTarget).toHaveBeenCalledOnce();
    expect(onRestartTarget).not.toHaveBeenCalled();
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
