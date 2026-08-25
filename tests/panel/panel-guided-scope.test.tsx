import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import {
  cataloguePeriodOptions,
  hasCompletePeriodicityModel,
  panelGuidedSteps,
} from "../../src/entrypoints/panel/panel-guided-scope-model";
import { PanelGuidedScope } from "../../src/entrypoints/panel/panel-guided-scope";
import { PANEL_TEST_SCOPE } from "./panel-controller.test-helpers";

function renderGuide() {
  return renderToStaticMarkup(
    <PanelGuidedScope
      busy={null}
      context={{ connectorId: "gst", pageKind: "gst-filed-returns", supported: true }}
      externalBlock={null}
      flowSummary={null}
      scope={PANEL_TEST_SCOPE}
      scopeLockedForReview={false}
      onScopeChange={vi.fn()}
      onStart={vi.fn()}
    />,
  );
}

describe("panel guided scope", () => {
  it("holds the initial view to three controls including the advanced door", () => {
    const markup = renderGuide();
    const controlCount =
      (markup.match(/<select/g) ?? []).length +
      (markup.match(/<button/g) ?? []).length +
      (markup.match(/<summary/g) ?? []).length;

    expect(controlCount).toBe(3);
    expect(markup).toContain("Step 1 of 4");
    expect(markup).toContain("One active scope");
  });

  it("keeps unsupported catalogue rows descriptive and out of the select", () => {
    const markup = renderGuide();
    const returnOptions = markup.match(/<select[^>]*>(.*?)<\/select>/)?.[1] ?? "";

    expect(returnOptions).toContain("GSTR-3B");
    expect(returnOptions).not.toContain("GSTR-9");
    expect(returnOptions).not.toContain("Ledgers");
    expect(markup).toContain("GSTR-9");
    expect(markup).toContain("Ledgers");
    expect(markup).toContain("Annual · not available in Pack");
    expect(markup).toContain("None · not available in Pack");
  });

  it("derives four exact scope steps from the selected catalogue row", () => {
    const steps = panelGuidedSteps(PANEL_TEST_SCOPE, new Date("2026-08-21T00:00:00.000Z"));

    expect(steps.map((step) => step.key)).toEqual([
      "returnType",
      "financialYear",
      "period",
      "artifactType",
    ]);
    expect(steps.map((step) => step.value)).toEqual([
      "GSTR-3B",
      "2025-26",
      FULL_FISCAL_YEAR_PERIOD,
      "PDF",
    ]);
    expect(steps[2]?.options[0]).toEqual({
      value: FULL_FISCAL_YEAR_PERIOD,
      label: "Full fiscal year",
    });
    expect(steps[3]?.options.map((option) => option.value)).toEqual(["PDF", "JSON"]);
  });

  it("derives every axis shape from periodicity rather than a return-name branch", () => {
    expect(hasCompletePeriodicityModel()).toBe(true);
    expect(cataloguePeriodOptions("quarterly", "2025-26")).toHaveLength(4);
    expect(cataloguePeriodOptions("annual", "2025-26")).toEqual([
      { value: "FULL_FISCAL_YEAR", label: "Annual · 2025-26" },
    ]);
    expect(cataloguePeriodOptions("none", "2025-26")).toEqual([
      { value: "NOT_PERIOD_BASED", label: "Not period-based" },
    ]);
  });
});
