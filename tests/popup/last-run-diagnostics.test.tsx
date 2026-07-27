import React from "react";
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
  it("renders only terminal summary reason fields and safe signals", () => {
    const markup = renderToStaticMarkup(<LastRunDiagnostics summary={summary} />);

    expect(markup).toContain("blocked");
    expect(markup).toContain("candidate-not-found");
    expect(markup).toContain("portal-control-missing, artifact-acquisition-failed");
    expect(markup).not.toContain(summary.flowStep.safeMessage);
    expect(markup).not.toContain(summary.scope.financialYear);
    expect(markup).not.toContain(summary.scope.period);
  });

  it("does not render a running or absent run", () => {
    expect(
      renderToStaticMarkup(<LastRunDiagnostics summary={{ ...summary, status: "running" }} />),
    ).toBe("");
    expect(renderToStaticMarkup(<LastRunDiagnostics summary={null} />)).toBe("");
  });
});
