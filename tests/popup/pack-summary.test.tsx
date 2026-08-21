import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { PackSummary } from "../../src/entrypoints/popup/pack-summary";

describe("popup pack summary", () => {
  const singlePeriodScope = {
    artifactType: "PDF" as const,
    financialYear: "2026-27",
    period: "April",
    returnType: "GSTR-3B" as const,
  };

  const singlePeriodSummary = (
    status: FiledReturnsFlowSummary["status"],
  ): FiledReturnsFlowSummary => ({
    scope: singlePeriodScope,
    status,
    completedPeriods: status === "complete" ? ["April"] : [],
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: status === "complete" ? "downloaded" : status === "running" ? "clicked" : "blocked",
      safeSignals:
        status === "complete" ? ["browser-download-completed", "browser-download-non-empty"] : [],
      safeMessage: "Safe test status.",
    },
  });

  it("describes an unstarted single-period selection without claiming it was saved", () => {
    const markup = renderToStaticMarkup(<PackSummary scope={singlePeriodScope} summary={null} />);

    expect(markup).toContain("Local browser download");
    expect(markup).not.toContain("Saved by your browser");
  });

  it("shows single-period browser progress without claiming completion", () => {
    const markup = renderToStaticMarkup(
      <PackSummary scope={singlePeriodScope} summary={singlePeriodSummary("running")} />,
    );

    expect(markup).toContain("Filed-returns run in progress");
    expect(markup).not.toContain("Saved by your browser");
  });

  it("uses saved copy only for a confirmed single-period completion", () => {
    const markup = renderToStaticMarkup(
      <PackSummary scope={singlePeriodScope} summary={singlePeriodSummary("complete")} />,
    );

    expect(markup).toContain("Saved by your browser");
  });

  it("does not claim a complete-but-not-filed period was saved", () => {
    const summary = singlePeriodSummary("complete");
    summary.flowStep.state = "candidate-not-found";
    summary.flowStep.safeSignals = ["filed-return-positively-not-filed"];

    const markup = renderToStaticMarkup(
      <PackSummary scope={singlePeriodScope} summary={summary} />,
    );

    expect(markup).toContain("No browser download needed");
    expect(markup).not.toContain("Saved by your browser");
  });

  it("keeps confirmed single-period ZIP copy when only local cleanup remains blocked", () => {
    const summary = singlePeriodSummary("blocked");
    summary.flowStep.safeSignals = [
      "single-period-zip-downloaded",
      "single-period-opfs-clear-failed",
    ];

    const markup = renderToStaticMarkup(
      <PackSummary scope={singlePeriodScope} summary={summary} />,
    );

    expect(markup).toContain("Saved by your browser");
    expect(markup).toContain("needs review");
    expect(markup).not.toContain("Browser download not confirmed");
  });

  it("does not infer a browser save from complete status without positive evidence", () => {
    const summary = singlePeriodSummary("complete");
    summary.flowStep.safeSignals = [];

    const markup = renderToStaticMarkup(
      <PackSummary scope={singlePeriodScope} summary={summary} />,
    );

    expect(markup).toContain("Browser download not confirmed");
    expect(markup).not.toContain("Saved by your browser");
  });

  it.each(["blocked", "partial"] as const)(
    "does not claim an unconfirmed %s single-period run was saved",
    (status) => {
      const markup = renderToStaticMarkup(
        <PackSummary scope={singlePeriodScope} summary={singlePeriodSummary(status)} />,
      );

      expect(markup).toContain("Browser download not confirmed");
      expect(markup).not.toContain("Saved by your browser");
    },
  );

  it("does not claim an ambiguous final ZIP was saved", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2024-25",
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
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-final-zip-retry",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-zip-phase:download-started",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage: "Check Browser Downloads before retrying the final ZIP.",
      },
    };

    const markup = renderToStaticMarkup(<PackSummary scope={scope} summary={summary} />);

    expect(markup).toContain("Final ZIP may already have started");
    expect(markup).toContain("check Browser Downloads");
    expect(markup).not.toContain("saved by your browser");
  });

  it("uses saved copy only after completed evidence", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2024-25",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const summary: FiledReturnsFlowSummary = {
      scope,
      status: "complete",
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["full-fiscal-year-complete", "full-fiscal-year-zip-downloaded"],
        safeMessage: "The final ZIP completed.",
      },
    };

    const markup = renderToStaticMarkup(<PackSummary scope={scope} summary={summary} />);

    expect(markup).toContain("One ZIP · saved by your browser");
  });

  it("shows only a summary period count and never renders summary contents", () => {
    const scope = {
      artifactType: "JSON" as const,
      financialYear: "2024-25",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const summary: FiledReturnsFlowSummary = {
      scope,
      status: "complete",
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: [
          "full-fiscal-year-zip-downloaded",
          "full-fiscal-year-summary-included",
          "full-fiscal-year-summary-parsed-period-count:2",
          "full-fiscal-year-summary-row-count:2",
        ],
        safeMessage: "Portal content that must stay inside the ZIP: synthetic_private_leaf=999999.",
      },
    };

    const markup = renderToStaticMarkup(<PackSummary scope={scope} summary={summary} />);

    expect(markup).toContain("summary for 2 periods");
    expect(markup).not.toContain("synthetic_private_leaf");
    expect(markup).not.toContain("999999");
    expect(markup).not.toContain("row-count");
  });

  it("shows a fixed unavailable status when the artifact ZIP omitted a failed summary", () => {
    const scope = {
      artifactType: "JSON" as const,
      financialYear: "2024-25",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const summary: FiledReturnsFlowSummary = {
      scope,
      status: "complete",
      completedPeriods: ["April"],
      totalPeriods: 1,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: [
          "full-fiscal-year-zip-downloaded",
          "full-fiscal-year-summary-failed",
          "full-fiscal-year-summary-error:generation-failed",
        ],
        safeMessage: "A fixed failure reason.",
      },
    };

    const markup = renderToStaticMarkup(<PackSummary scope={scope} summary={summary} />);

    expect(markup).toContain("summary unavailable");
  });

  it("does not claim a ZIP was saved when a completed full-year run had no artifacts", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2024-25",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const summary: FiledReturnsFlowSummary = {
      scope,
      status: "complete",
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["full-fiscal-year-complete", "full-fiscal-year-no-zip-artifacts"],
        safeMessage: "No fiscal-year artifacts were available.",
      },
    };

    const markup = renderToStaticMarkup(<PackSummary scope={scope} summary={summary} />);

    expect(markup).toContain("No ZIP created · no eligible files");
    expect(markup).not.toContain("saved by your browser");
  });

  it("does not imply a ZIP handoff from a running full-year lease alone", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2024-25",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B" as const,
    };
    const summary: FiledReturnsFlowSummary = {
      scope,
      status: "running",
      completedPeriods: [],
      totalPeriods: 12,
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "ready",
        safeSignals: ["filed-returns-run-active"],
        safeMessage: "A filed-returns run lease is active.",
      },
    };

    const markup = renderToStaticMarkup(<PackSummary scope={scope} summary={summary} />);

    expect(markup).toContain("Filed-returns run in progress");
    expect(markup).not.toContain("saved by your browser");
    expect(markup).not.toContain("preparing locally");
  });

  it("shows exact browser status as pending when a download ID is persisted", () => {
    const scope = {
      artifactType: "PDF" as const,
      financialYear: "2024-25",
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
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-final-zip-manual-review",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-zip-phase:download-observing",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage: "Check the saved browser download ID.",
      },
    };

    const markup = renderToStaticMarkup(<PackSummary scope={scope} summary={summary} />);

    expect(markup).toContain("Final ZIP started");
    expect(markup).toContain("browser status not yet confirmed");
    expect(markup).not.toContain("saved by your browser");
  });
});
