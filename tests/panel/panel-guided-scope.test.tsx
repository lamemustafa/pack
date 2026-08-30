import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import {
  cataloguePeriodOptions,
  panelGuidedStepForDisplay,
  panelGuidedSteps,
} from "../../src/entrypoints/panel/panel-guided-scope-model";
import { PanelGuidedScope } from "../../src/entrypoints/panel/panel-guided-scope";
import { PANEL_TEST_SCOPE } from "./panel-controller.test-helpers";
import { FILED_RETURNS_PERIODICITIES } from "../../src/connectors/gst/filed-returns-capabilities";

function renderGuide() {
  return renderToStaticMarkup(
    <PanelGuidedScope
      busy={null}
      context={{ connectorId: "gst", pageKind: "gst-filed-returns", supported: true }}
      externalBlock={null}
      flowSummary={null}
      portalSignedIn
      scope={PANEL_TEST_SCOPE}
      savedRun={null}
      scopeLockedForReview={false}
      onScopeChange={vi.fn()}
      onStart={vi.fn()}
      onStartAllReturnsFullYear={vi.fn()}
    />,
  );
}

describe("panel guided scope", () => {
  beforeEach(() => {
    vi.stubEnv("MODE", "alpha");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("orders a complete-year recipe, a partial-year recipe, return recipes, and the advanced door", () => {
    const markup = renderGuide();
    const controlCount =
      (markup.match(/<select/g) ?? []).length +
      (markup.match(/<button/g) ?? []).length +
      (markup.match(/<summary/g) ?? []).length;

    expect(controlCount).toBe(6);
    expect(markup).toContain("Everything last year · all supported returns");
    expect(markup).toContain("Complete financial year.");
    expect(markup).toContain("Everything this year · all supported returns");
    expect(markup).toContain("Partial year · 4 eligible periods so far.");
    expect(markup).toContain("This year&#x27;s GSTR-3B");
    expect(markup).toContain("This year&#x27;s GSTR-1");
    expect(markup).toContain("This year&#x27;s GSTR-2B");
    expect(markup).toContain("Choose return, year and period");
    expect(markup).not.toContain("Catalogue &amp; limits");
    expect(markup).not.toContain("Step 1 of 4");
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
    expect(steps[3]?.options.map((option) => option.value)).toContain("PDF");
    expect(steps[3]?.options.map((option) => option.value)).toContain("JSON");
  });

  it("keeps a saved full-year value visible but disabled in the production period step", () => {
    const periodStep = panelGuidedSteps(PANEL_TEST_SCOPE).find((step) => step.key === "period");
    if (!periodStep) throw new Error("Expected a period step.");

    const displayed = panelGuidedStepForDisplay(periodStep, false);
    const labels = displayed.options.map((option) => option.label);

    expect(displayed.options[0]).toEqual({
      value: FULL_FISCAL_YEAR_PERIOD,
      label: "Full fiscal year (saved run)",
      disabled: true,
    });
    expect(displayed.hint).toBe(`Choose one of: ${labels.join(", ")}.`);
  });

  it("derives a new production period hint from exactly its selectable options", () => {
    const periodStep = panelGuidedSteps({ ...PANEL_TEST_SCOPE, period: "April" }).find(
      (step) => step.key === "period",
    );
    if (!periodStep) throw new Error("Expected a period step.");

    const displayed = panelGuidedStepForDisplay(periodStep, false);
    const labels = displayed.options.map((option) => option.label);

    expect(labels).not.toContain("Full fiscal year");
    expect(displayed.hint).toBe(`Choose one of: ${labels.join(", ")}.`);
  });

  it("withholds a new financial year until it has a selectable filed period", () => {
    const steps = panelGuidedSteps(PANEL_TEST_SCOPE, new Date("2026-04-01T06:00:00.000Z"));
    const financialYear = steps.find((step) => step.key === "financialYear");

    expect(financialYear?.options.map((option) => option.value)).not.toContain("2026-27");
    expect(financialYear?.options.map((option) => option.value)).toContain("2025-26");
  });

  it("derives every axis shape from periodicity rather than a return-name branch", () => {
    for (const periodicity of FILED_RETURNS_PERIODICITIES) {
      const options = cataloguePeriodOptions(periodicity, "2025-26", "GSTR-3B");
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.value.length).toBeGreaterThan(0);
        expect(option.label.length).toBeGreaterThan(0);
      }
    }
    expect(cataloguePeriodOptions("quarterly", "2025-26", "GSTR-3B")).toHaveLength(4);
    expect(cataloguePeriodOptions("annual", "2025-26", "GSTR-3B")).toEqual([
      { value: "FULL_FISCAL_YEAR", label: "Annual · 2025-26" },
    ]);
    expect(cataloguePeriodOptions("none", "2025-26", "GSTR-3B")).toEqual([
      { value: "NOT_PERIOD_BASED", label: "Not period-based" },
    ]);
  });
});
