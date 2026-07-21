import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary, PortalContext } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import { ScopeForm, ScopeFormAction } from "../../src/entrypoints/popup/components";
import { LocalProcessingAcknowledgement } from "../../src/entrypoints/popup/local-processing-acknowledgement";

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

  it("renders a bounded custom range with explicit start and end controls", () => {
    const markup = renderToStaticMarkup(
      <ScopeForm
        busy={null}
        context={context}
        scope={{
          financialYear: "2025-26",
          period: "October",
          rangeEndPeriod: "January",
          returnType: "GSTR-1",
          artifactType: "PDF_AND_EXCEL",
        }}
        onScopeChange={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(markup).toContain("Custom range");
    expect(markup).toContain("scope-select-row-custom-range");
    expect(markup).toContain('for="scope-start"');
    expect(markup).toContain('for="scope-end"');
    expect(markup).toContain("Only the selected contiguous periods");
    expect(markup).toContain("Download October–January 2025-26 GSTR-1 ZIP");
  });

  it("does not present completed calendar months as a filing or availability guarantee", () => {
    const markup = renderToStaticMarkup(
      <ScopeForm
        busy={null}
        context={context}
        scope={{ financialYear: "2026-27", period: "April", returnType: "GSTR-3B" }}
        onScopeChange={vi.fn()}
        onStart={vi.fn()}
        showPrimaryAction={false}
      />,
    );

    expect(markup).toContain("Pack lists completed calendar months.");
    expect(markup).toContain("The GST Portal determines whether a record is available");
    expect(markup).toContain("A no-record result does not mean “never filed.”");
  });

  it("previews Pack's requested download location without claiming Chrome's final folder", () => {
    const markup = renderToStaticMarkup(
      <ScopeForm
        busy={null}
        context={context}
        scope={{ financialYear: "2026-27", period: "April", returnType: "GSTR-3B" }}
        onScopeChange={vi.fn()}
        onStart={vi.fn()}
        showPrimaryAction={false}
      />,
    );

    expect(markup).toContain("Requested relative path:");
    expect(markup).toContain("complyeaze-pack/gst/2026-27/gstr-3b/april.pdf");
    expect(markup).toContain("Chrome&#x27;s configured download location controls the final folder.");
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

  it("keeps retained full-FY ZIP retry paused without a supported portal tab", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2025-26",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const summary: FiledReturnsFlowSummary = {
      scope,
      status: "blocked",
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: ["full-fiscal-year-final-zip-retry", "full-fiscal-year-opfs-retained"],
        safeMessage: "Retry local cleanup.",
      },
    };
    const markup = renderToStaticMarkup(
      <ScopeFormAction
        busy={null}
        context={{ connectorId: "gst", pageKind: "unsupported", supported: false }}
        flowSummary={summary}
        scope={scope}
        onStart={vi.fn()}
      />,
    );

    expect(markup).toContain("Full fiscal year temporarily paused");
    expect(markup).toContain('disabled=""');

    const formMarkup = renderToStaticMarkup(
      <ScopeForm
        busy={null}
        context={{ connectorId: "gst", pageKind: "unsupported", supported: false }}
        flowSummary={summary}
        scope={scope}
        onScopeChange={vi.fn()}
        onStart={vi.fn()}
        showPrimaryAction={false}
      />,
    );
    expect(formMarkup).toMatch(/<select[^>]*disabled=""/);
    expect(formMarkup).toMatch(/<input[^>]*disabled=""/);
  });

  it("requires the local-processing acknowledgement before a live start", () => {
    const markup = renderToStaticMarkup(
      <ScopeFormAction
        busy={null}
        context={context}
        localProcessingAcknowledged={false}
        scope={{ financialYear: "2026-27", period: "April", returnType: "GSTR-3B" }}
        onStart={vi.fn()}
      />,
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Acknowledge local processing before starting a live GST download.");
  });

  it("shows the custody boundary before acknowledgement", () => {
    const markup = renderToStaticMarkup(
      <LocalProcessingAcknowledgement acknowledged={false} busy={false} onAcknowledge={vi.fn()} />,
    );

    expect(markup).toContain("Before the first live action");
    expect(markup).toContain("Temporary bytes may be staged in this browser");
    expect(markup).toContain("Chrome saves downloads separately");
    expect(markup).toContain("I understand — continue");
  });
});
