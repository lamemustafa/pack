import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { InlineStatus, hasInlinePrimaryAction } from "../../src/entrypoints/popup/inline-status";
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
  });
});
