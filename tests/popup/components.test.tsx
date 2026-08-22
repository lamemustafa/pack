import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortalContext } from "../../src/core/contracts";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { ScopeForm, ScopeFormAction } from "../../src/entrypoints/popup/components";
import { hasInlinePrimaryAction } from "../../src/entrypoints/popup/inline-status";

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
  it("does not render Start download while target review is unresolved without an inline action", () => {
    expect(
      hasInlinePrimaryAction(
        {
          badge: "Needs review",
          body: "Review the target.",
          icon: "!",
          kind: "blocked",
          title: "Review required",
          tone: "warning",
        },
        targetReviewSummary,
      ),
    ).toBe(false);

    // The slot component that used to be asserted here went with the popup
    // entrypoint. `hasInlinePrimaryAction` is the part the panel still consults,
    // so the predicate keeps its coverage and the orphaned rendering does not.
  });

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
    expect(markup).toContain("Summary (PDF)");
    expect(markup).toContain("Details (Excel)");
    expect(markup).toContain("All formats");
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

  it("enables retained final-ZIP retry without a supported portal tab", () => {
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

    expect(markup).toContain("Retry final ZIP");
    expect(markup).not.toContain("disabled");
    expect(markup).not.toContain("Open GST Portal to continue");

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
});
