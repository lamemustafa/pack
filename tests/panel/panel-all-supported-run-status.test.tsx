import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  type FiledReturnsAllSupportedFullFiscalYearTargetEvidence,
} from "../../src/connectors/gst/filed-returns-contracts";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import type { PackPanelController } from "../../src/entrypoints/panel/panel-surface";
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
    ledgerId: "ledger-under-review",
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

function render(
  summaryValue: FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  context: PackPanelController["context"] = {
    connectorId: "gst",
    pageKind: "gst-filed-returns",
    supported: true,
  },
): string {
  return renderToStaticMarkup(
    <PanelSurface
      pack={panelController({
        allSupportedFullFiscalYearFlowSummary: summaryValue,
        context,
      })}
    />,
  );
}

/** No signed-in GST tab: the page is supported, but it is asking the user to sign in. */
const SIGNED_OUT = {
  connectorId: "gst",
  pageKind: "gst-auth-landing",
  supported: true,
} as const;

/** The one button's own tag, so a `disabled` elsewhere in the panel cannot satisfy the assertion. */
function actionButton(markup: string, label: string): string {
  const index = markup.indexOf(label);
  expect(index, `expected the ${label} control to render`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf("<button", index), index);
}
const restartButton = (markup: string) =>
  actionButton(markup, "Discard this year&#x27;s saved plan and run again");
const resumeButton = (markup: string) => actionButton(markup, "Resume this plan");
const retryTargetButton = (markup: string) =>
  actionButton(markup, "Review Downloads, then retry GSTR-3B for April");

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

  it("compiles both all-supported actions out of a packaged build", () => {
    // The full-year flow is source-only until the gates in
    // docs/PUBLICATION_READINESS.md are recorded. `PanelGuidedScope` hides its
    // presets, but retained state rendered these controls here, so a packaged
    // build with a saved plan could still reach the source-only runner.
    const completed = summary(["saved", "not-filed"], "complete", [0, 1]);

    const packaged = render(completed);
    expect(packaged).not.toContain("Discard this year&#x27;s saved plan and run again");
    expect(packaged).not.toContain("Resume this plan");
    // The summary itself still renders; only the actions are withheld.
    expect(packaged).toContain("Your pack · All supported returns · FY 2025-26");

    vi.stubEnv("MODE", "alpha");
    expect(render(completed)).toContain("Discard this year&#x27;s saved plan and run again");
  });

  it("renders an identity-less malformed-index block without a fiscal year or plan action", () => {
    vi.stubEnv("MODE", "alpha");
    const malformedIndexBlock: FiledReturnsAllSupportedFullFiscalYearFlowSummary = {
      status: "blocked",
      completedTargetIds: [],
      targetEvidence: [],
      totalTargets: 0,
      resumeAvailable: false,
      flowStep: {
        connectorId: "gst",
        scopeId: "all-supported-full-fiscal-year",
        state: "blocked",
        safeSignals: ["all-supported-full-fiscal-year-plan-index-malformed"],
        safeMessage:
          "Pack could not verify the saved all-supported fiscal-year plan index. Open Pack's options and use \u201cClear local data and discard saved plans\u201d before starting another return.",
      },
    };

    const markup = render(malformedIndexBlock);

    expect(markup).toContain("Your pack · All supported returns");
    expect(markup).not.toContain("FY undefined");
    expect(markup).not.toContain("Discard this year&#x27;s saved plan and run again");
    expect(markup).not.toContain("Resume this plan");
    expect(markup).not.toContain("Review Downloads, then retry");
    expect(markup).toContain("Clear local data and discard saved plans");
    expect(markup).not.toContain(
      "Discard the saved all-supported fiscal-year plan from its run summary before starting another return.",
    );
  });

  it("will not restart without a signed-in portal tab", () => {
    // Restart clears local staging and removes the ledger before the runner
    // reaches its tab preflight, so an ungated click destroys the completed
    // history and then blocks on the first target.
    vi.stubEnv("MODE", "alpha");
    const completed = summary(["saved", "not-filed"], "complete", [0, 1]);

    const signedOut = render(completed, SIGNED_OUT);
    expect(signedOut).toContain("Discard this year&#x27;s saved plan and run again");
    expect(restartButton(signedOut)).toContain("disabled");

    expect(restartButton(render(completed))).not.toContain("disabled");
  });

  it("gates a portal-bound resume on the portal but never a local-only one", () => {
    vi.stubEnv("MODE", "alpha");
    const portalBound = {
      ...summary(["saved", "pending"], "running", [0]),
      resumeAvailable: true,
      resumeMode: "portal",
    } as const;
    expect(resumeButton(render(portalBound, SIGNED_OUT))).toContain("disabled");

    // Export, cleanup and download-observation retries touch no portal. Gating
    // them would disable the only productive control the reader has.
    const localOnly = { ...portalBound, resumeMode: "local-only" } as const;
    expect(resumeButton(render(localOnly, SIGNED_OUT))).not.toContain("disabled");
  });

  it("renders an explicit, portal-bound retry for the exact review target", () => {
    vi.stubEnv("MODE", "alpha");
    const reviewable = {
      ...summary(["pending"], "running", []),
      allSupportedFullFiscalYearRecovery: {
        targetId: "synthetic-0",
        expectedRevision: 7,
        targetStatus: "download-unconfirmed" as const,
      },
    };

    const signedOut = render(reviewable, SIGNED_OUT);
    expect(signedOut).toContain("Review Downloads, then retry GSTR-3B for April");
    expect(retryTargetButton(signedOut)).toContain("disabled");
    expect(retryTargetButton(render(reviewable))).not.toContain("disabled");
  });

  it("puts an explicit same-year restart beside the completed summary", () => {
    vi.stubEnv("MODE", "alpha");
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

  it("keeps every mixed all-supported outcome grouped beside a blocked run", () => {
    const targetEvidence: FiledReturnsAllSupportedFullFiscalYearTargetEvidence[] = [
      {
        targetId: "gstr1-april",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-1" as const,
        artifactType: "PDF" as const,
        outcome: "saved" as const,
      },
      {
        targetId: "gstr1-may",
        financialYear: "2025-26",
        period: "May",
        returnType: "GSTR-1" as const,
        artifactType: "PDF" as const,
        outcome: "not-filed" as const,
      },
      {
        targetId: "gstr2b-april",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-2B" as const,
        artifactType: "JSON" as const,
        outcome: "needs-review" as const,
      },
      {
        targetId: "gstr3b-april",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-3B" as const,
        artifactType: "PDF" as const,
        outcome: "pending" as const,
      },
    ];
    const markup = render({
      ...summary(["saved"], "running", [0]),
      status: "blocked",
      targetEvidence,
      totalTargets: targetEvidence.length,
      completedTargetIds: ["gstr1-april"],
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
        state: "blocked",
        safeSignals: ["synthetic-target-needs-review"],
        safeMessage: "Synthetic mixed all-supported review.",
      },
    });

    // The saved all-supported summary is the positive control: the rendered
    // run heading proves these rows belong to its blocked plan, not another
    // terminal surface.
    expect(markup).toContain("Your pack · All supported returns · FY 2025-26");
    expect(markup).toContain('aria-label="GSTR-1 results"');
    expect(markup).toContain('aria-label="GSTR-2B results"');
    expect(markup).toContain('aria-label="GSTR-3B results"');
    expect(markup.match(/class="evidence-row /g)).toHaveLength(4);
    expect(markup).toContain("Saved");
    expect(markup).toContain("Not filed");
    expect(markup).toContain("Needs review");
    expect(markup).toContain("Waiting");
    expect(markup).toContain("1 needs review");
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
