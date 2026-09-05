import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
  type FiledReturnsFlowSummary,
  type FiledReturnsFullFiscalYearTargetStatus,
  type PortalFlowStepResult,
} from "../../src/connectors/gst/filed-returns-contracts";
import {
  createAllSupportedFullFiscalYearLedger,
  markAllSupportedFullFiscalYearTargetRunning,
  markAllSupportedFullFiscalYearTargetTerminal,
} from "../../src/background/filed-returns-all-supported-full-fiscal-year-ledger";
import { toAllSupportedFullFiscalYearSummary } from "../../src/background/filed-returns-all-supported-full-fiscal-year-summary";
import { expandAllSupportedFullFiscalYearTargetPlan } from "../../src/connectors/gst/filed-returns-all-supported-full-fiscal-year";
import { concreteFiledReturnsArtifactTypesForSelection } from "../../src/connectors/gst/filed-returns-artifacts";
import { FILED_RETURNS_MONTHS } from "../../src/connectors/gst/filed-returns-scope";
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

const ALL_SUPPORTED_NOW = new Date("2026-09-06T00:00:00.000Z");

function projectedAllSupportedSummary(status: FiledReturnsFullFiscalYearTargetStatus) {
  const expansion = expandAllSupportedFullFiscalYearTargetPlan();
  if (!expansion.ok) throw new Error("expected an all-supported target plan");
  const created = createAllSupportedFullFiscalYearLedger(
    {
      kind: FILED_RETURNS_ALL_SUPPORTED_FULL_FISCAL_YEAR_KIND,
      financialYear: "2026-27",
    },
    expansion.targets,
    FILED_RETURNS_MONTHS.slice(0, 2),
    ALL_SUPPORTED_NOW,
  );
  const target = created.targets[0]!;
  const running = markAllSupportedFullFiscalYearTargetRunning(
    created,
    target.targetId,
    ALL_SUPPORTED_NOW,
  );
  const terminal = markAllSupportedFullFiscalYearTargetTerminal(
    running,
    target.targetId,
    status,
    flowStepFor(target.returnType, target.artifactType, status),
    ALL_SUPPORTED_NOW,
  );

  return {
    // A prior release persisted this resolved pointer. Keep the diagnostic
    // regression test on the real ledger projector rather than hand-making a
    // summary production cannot emit.
    summary: toAllSupportedFullFiscalYearSummary({ ...terminal, currentTargetId: target.targetId }),
    terminal,
  };
}

function flowStepFor(
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B",
  artifactType: "PDF" | "EXCEL" | "JSON" | "PDF_AND_EXCEL",
  status: FiledReturnsFullFiscalYearTargetStatus,
): PortalFlowStepResult {
  if (status === "not-filed") {
    return {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "candidate-not-found",
      safeSignals: ["filed-return-positively-not-filed"],
      safeMessage: "Synthetic settled no-record result.",
    };
  }
  if (status === "downloaded") {
    return {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "downloaded",
      safeSignals: concreteFiledReturnsArtifactTypesForSelection(returnType, artifactType).map(
        (concreteArtifactType) => `filed-return-artifact-downloaded:${concreteArtifactType}`,
      ),
      safeMessage: "Synthetic download evidence.",
    };
  }
  if (status === "running") {
    return {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
      state: "ready",
      safeSignals: ["full-fiscal-year-target-running"],
      safeMessage: "Synthetic running target.",
    };
  }
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr1-pdf-private-v0",
    state: "blocked",
    safeSignals: ["synthetic-target-review"],
    safeMessage: "Synthetic target review.",
  };
}

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

  it("uses an atomic full-year run's current period when one target needs attention", () => {
    const markup = renderToStaticMarkup(
      <LastRunDiagnostics
        summary={{
          ...summary,
          currentPeriod: "May",
          scope: { ...summary.scope, period: "FULL_FISCAL_YEAR" },
        }}
      />,
    );

    expect(markup).toContain("<dd>May</dd>");
    expect(markup).not.toContain("Full fiscal year");
  });

  it.each(["downloaded", "not-filed"] as const)(
    "does not name a resolved %s target from a legacy current-target pointer",
    (status) => {
      const { summary: allSupportedSummary, terminal } = projectedAllSupportedSummary(status);
      const markup = renderToStaticMarkup(<LastRunDiagnostics summary={allSupportedSummary} />);

      expect(terminal.currentTargetId).toBeUndefined();
      expect(markup).not.toContain("Affected return type");
      expect(markup).not.toContain("Affected period");
    },
  );

  it.each(["running", "blocked"] as const)(
    "names an all-supported target that is actually %s",
    (status) => {
      const { summary: allSupportedSummary } = projectedAllSupportedSummary(status);
      const markup = renderToStaticMarkup(<LastRunDiagnostics summary={allSupportedSummary} />);

      expect(markup).toContain("Affected return type");
      expect(markup).toContain("Affected period");
      expect(markup).toContain("April");
    },
  );

  it("does not render an absent run", () => {
    expect(renderToStaticMarkup(<LastRunDiagnostics summary={null} />)).toBe("");
  });
});
