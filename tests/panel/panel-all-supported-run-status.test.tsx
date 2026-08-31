import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  outcomes: readonly ("saved" | "captured" | "not-filed" | "pending")[],
  status: "running" | "complete" = "running",
  completedIndexes = outcomes.flatMap((outcome, index) => (outcome === "saved" ? [index] : [])),
): FiledReturnsAllSupportedFullFiscalYearFlowSummary {
  return {
    summaryIdentity: {
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear: "2025-26",
    },
    status,
    completedTargetIds: completedIndexes.map((index) => `synthetic-${index}`),
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("draws the existing progress track with the one saved-file count", () => {
    const markup = render(summary(["saved", "pending"], "running", [0]));

    expect(markup).toContain('aria-label="All supported returns progress"');
    expect(markup).toContain("1 of 2 saved");
    expect(markup).not.toContain("targets checked");
    expect(markup).toContain('class="panel-run-progress-track"');
    expect(markup).toContain('style="width:50%"');
    expect(declaredProperty(".panel-run-progress-track span", "background")).toBe(
      "var(--pack-action)",
    );
  });

  it("puts an explicit same-year restart beside the completed summary", () => {
    const markup = render(summary(["saved", "not-filed"], "complete", [0, 1]));

    expect(markup).toContain("Your pack · All supported returns · FY 2025-26");
    expect(markup).toContain("Discard this year&#x27;s saved plan and run again");
    expect(markup).toContain("1 of 2 saved");
    expect(markup).toContain("browser may have saved the ZIP under a different name");
    expect(markup.indexOf("Your pack · All supported returns")).toBeLessThan(
      markup.indexOf("browser may have saved the ZIP under a different name"),
    );
    expect(markup).toContain('style="width:50%"');
  });

  it("renders all return groups at alpha mode with no duplicate summary or hidden identifiers", () => {
    vi.stubEnv("MODE", "alpha");
    const returnTypes = ["GSTR-1", "GSTR-2B", "GSTR-3B"] as const;
    const periods = [
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
      "January",
      "February",
      "March",
    ] as const;
    const targetEvidence = returnTypes.flatMap((returnType) =>
      periods.map((period, index) => ({
        targetId: `synthetic-${returnType}-${period}`,
        financialYear: "2025-26",
        period,
        returnType,
        artifactType: "PDF" as const,
        outcome: index === 0 ? ("saved" as const) : ("pending" as const),
      })),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const markup = render({
      ...summary(["saved"], "complete", [0]),
      targetEvidence,
      totalTargets: targetEvidence.length,
      completedTargetIds: targetEvidence
        .filter((entry) => entry.outcome === "saved")
        .map((entry) => entry.targetId),
    });

    // This all-returns preset is alpha-only. Its rendered restart control is
    // the precondition that keeps the grouped-evidence assertions non-vacuous.
    expect(markup).toContain("Discard this year&#x27;s saved plan and run everything last year");
    expect(markup.match(/class="evidence-row /g)).toHaveLength(36);
    expect(markup).toContain('aria-label="GSTR-1 results"');
    expect(markup).toContain('aria-label="GSTR-2B results"');
    expect(markup).toContain('aria-label="GSTR-3B results"');
    expect(markup.match(/3 of 36 saved/g)).toHaveLength(1);
    expect(markup).not.toContain("targets checked");
    expect(markup).not.toContain("synthetic-GSTR-1-April");
    expect(markup).not.toContain("all-supported-full-fiscal-year-run-active");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
