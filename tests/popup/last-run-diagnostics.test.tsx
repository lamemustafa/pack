import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { LastRunDiagnostics } from "../../src/entrypoints/popup/last-run-diagnostics";

const summary: FiledReturnsFlowSummary = {
  scope: { financialYear: "2026-27", period: "April", returnType: "GSTR-3B" },
  status: "blocked",
  completedPeriods: [],
  totalPeriods: 1,
  currentPeriod: "April",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "candidate-not-found",
    safeSignals: ["portal-control-missing", "artifact-acquisition-failed"],
    safeMessage: "A portal message that must not be rendered here.",
  },
};

describe("last-run diagnostics", () => {
  it("renders the run reason fields, safe signals, and affected target only", () => {
    const markup = renderToStaticMarkup(<LastRunDiagnostics summary={summary} />);

    expect(markup).toContain("blocked");
    expect(markup).toContain("candidate-not-found");
    expect(markup).toContain("portal-control-missing, artifact-acquisition-failed");
    expect(markup).toContain("GSTR-3B");
    expect(markup).toContain("April");
    expect(markup).not.toContain(summary.flowStep.safeMessage);
    expect(markup).not.toContain(summary.scope.financialYear);
  });

  it("renders a running run without falsely calling it a last run", () => {
    const markup = renderToStaticMarkup(
      <LastRunDiagnostics summary={{ ...summary, status: "running" }} />,
    );

    expect(markup).toContain("Run diagnostics");
    expect(markup).toContain("running");
    expect(markup).not.toContain("Last run");
  });

  it("does not render an absent run", () => {
    expect(renderToStaticMarkup(<LastRunDiagnostics summary={null} />)).toBe("");
  });
});
