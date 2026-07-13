import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
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
  it("offers an explicit retry for a blocked period", () => {
    expect(hasInlinePrimaryAction(blockedPresentation, blockedSummary)).toBe(true);

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={blockedSummary}
      />,
    );

    expect(markup).toContain("Retry May");
    expect(markup).toContain(
      "Select the filed return filters in the GST portal, then start Pack again.",
    );
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
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        onOpenPortal={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={targetReviewSummary}
      />,
    );

    expect(markup).toContain("May needs review");
    expect(markup).toContain("Resolve May before choosing another period");
    expect(markup).toContain("More run controls");
    expect(markup).toContain("after checking Browser Downloads");
    expect(markup).toContain("Retry May");
  });

  it("routes a blocked full-year period to the revision-checked full-year retry", () => {
    const onRetryFullFiscalYearTarget = vi.fn();
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
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={fullYearSummary}
      />,
    );

    expect(markup).toContain("kept its summary overlay open after Pack clicked");
  });
});
