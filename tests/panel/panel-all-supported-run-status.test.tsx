import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type FiledReturnsAllSupportedFullFiscalYearFlowSummary,
} from "../../src/connectors/gst/filed-returns-contracts";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { PANEL_TEST_SCOPE, panelController } from "./panel-controller.test-helpers";

const PANEL_STYLESHEET = readFileSync(join(process.cwd(), "src/styles/panel.css"), "utf8");

function declaredProperty(selector: string, property: string): string | undefined {
  const escapedSelector = selector.replaceAll(".", "\\.").replaceAll(" ", "\\s+");
  const rule = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "m").exec(PANEL_STYLESHEET);
  return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule?.[1] ?? "")?.[1]?.trim();
}

function summary(
  outcomes: readonly ("saved" | "pending")[],
  status: "running" | "complete" = "running",
): FiledReturnsAllSupportedFullFiscalYearFlowSummary {
  return {
    summaryIdentity: {
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear: "2025-26",
    },
    status,
    completedTargetIds: outcomes.flatMap((outcome, index) =>
      outcome === "saved" ? [`synthetic-${index}`] : [],
    ),
    targetEvidence: outcomes.map((outcome, index) => ({
      targetId: `synthetic-${index}`,
      financialYear: "2025-26",
      period: index === 0 ? "April" : "May",
      returnType: "GSTR-3B",
      artifactType: "PDF",
      outcome,
    })),
    totalTargets: outcomes.length,
    flowStepScope: PANEL_TEST_SCOPE,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: status === "complete" ? "downloaded" : "ready",
      safeSignals: ["all-supported-full-fiscal-year-run-active"],
      safeMessage:
        status === "complete"
          ? "The browser may have saved the ZIP under a different name. Check browser Downloads before using it."
          : "Pack is checking the selected fiscal-year returns.",
    },
    resumeAvailable: false,
  };
}

function render(summaryValue: FiledReturnsAllSupportedFullFiscalYearFlowSummary): string {
  return renderToStaticMarkup(
    <PanelSurface
      pack={panelController({ allSupportedFullFiscalYearFlowSummary: summaryValue })}
    />,
  );
}

describe("all-supported panel progress", () => {
  it("draws the existing progress track at the live saved-target percentage", () => {
    const markup = render(summary(["saved", "pending"]));

    expect(markup).toContain('aria-label="All supported returns progress"');
    expect(markup).toContain("1 of 2 saved");
    expect(markup).toContain('class="panel-run-progress-track"');
    expect(markup).toContain('style="width:50%"');
    expect(declaredProperty(".panel-run-progress-track span", "background")).toBe(
      "var(--pack-action)",
    );
  });

  it("puts a completed outcome before the retained browser-name caveat", () => {
    const markup = render(summary(["saved", "saved"], "complete"));

    expect(markup).toContain("Run complete");
    expect(markup).toContain("2 of 2 saved");
    expect(markup).toContain("browser may have saved the ZIP under a different name");
    expect(markup.indexOf("Run complete")).toBeLessThan(
      markup.indexOf("browser may have saved the ZIP under a different name"),
    );
    expect(markup).toContain('style="width:100%"');
  });
});
