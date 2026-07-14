import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary, PortalContext } from "../../src/core/contracts";
import { ScopeForm } from "../../src/entrypoints/popup/components";

const context: PortalContext = {
  connectorId: "gst",
  pageKind: "gst-auth-landing",
  supported: true,
};

const targetReviewSummary: FiledReturnsFlowSummary = {
  scope: { financialYear: "2026-27", period: "April", returnType: "GSTR-3B" },
  status: "blocked",
  completedPeriods: [],
  totalPeriods: 1,
  currentPeriod: "April",
  updatedAt: "2026-07-10T00:00:00.000Z",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "download-unconfirmed",
    safeSignals: ["filed-returns-target-review-required"],
    safeMessage: "Review the browser download before continuing.",
  },
};

describe("popup scope form", () => {
  it("renders exposed GST artifact formats as an accessible radio group", () => {
    const markup = renderToStaticMarkup(
      <ScopeForm
        busy={null}
        context={context}
        scope={{
          financialYear: "2026-27",
          period: "April",
          returnType: "GSTR-2B",
          artifactType: "PDF",
        }}
        onScopeChange={vi.fn()}
        onStart={vi.fn()}
        showPrimaryAction={false}
      />,
    );

    expect(markup).toContain("<legend>File format</legend>");
    expect(markup).toContain('name="scope-file-format"');
    expect(markup).toContain("Summary PDF");
    expect(markup).toContain("Details Excel");
    expect(markup).toContain("PDF + Excel ZIP");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("More options");
    expect(markup).not.toContain('id="scope-file-format"');
  });

  it("keeps scope controls usable while explaining the explicit recovery choice", () => {
    const markup = renderToStaticMarkup(
      <ScopeForm
        busy={null}
        context={context}
        flowSummary={targetReviewSummary}
        scope={targetReviewSummary.scope}
        scopeLockedForReview
        onScopeChange={vi.fn()}
        onStart={vi.fn()}
        showPrimaryAction={false}
      />,
    );

    expect(markup).toContain("A saved run is paused at April");
    expect(markup).toContain("explicitly discard it and start the selected download");
    expect(markup).not.toMatch(/<select[^>]*disabled=""/);
  });
});
