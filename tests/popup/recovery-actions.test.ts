import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FiledReturnsFlowSummary, PortalContext } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import { ScopeForm } from "../../src/entrypoints/popup/components";
import {
  canManuallyObserveFullFiscalYearTarget,
  RecoveryActions,
} from "../../src/entrypoints/popup/recovery-actions";
import { RunEvidencePanel } from "../../src/entrypoints/popup/run-evidence-panel";

describe("popup full-year recovery actions", () => {
  it("offers manual observation only for final-click recovery states", () => {
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("download-unconfirmed"))).toBe(true);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("blocked"))).toBe(false);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("failed"))).toBe(false);
    expect(canManuallyObserveFullFiscalYearTarget(summaryFor("running"))).toBe(false);
  });

  it("renders resume and discard immediately for a pending saved full-year run", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: summaryFor("pending", "full-fiscal-year-resume-confirmation-required"),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Resume saved run");
    expect(markup).toContain("Discard saved run");
  });

  it("shows the same-account warning only for resume confirmation", () => {
    const resumeMarkup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: summaryFor("pending", "full-fiscal-year-resume-confirmation-required"),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );
    expect(resumeMarkup).toContain(
      "This saved run is not bound to a GST account. Continue only if the same GST account is currently open.",
    );

    for (const targetStatus of ["blocked", "failed", "cancelled"] as const) {
      const markup = renderToStaticMarkup(
        createElement(RecoveryActions, {
          busy: null,
          portalReady: true,
          summary: summaryFor(targetStatus),
          onAcknowledgeInterruptedRun: () => undefined,
          onRetryFullFiscalYearTarget: () => undefined,
          onRetryTarget: () => undefined,
          onResolveFullFiscalYearTarget: () => undefined,
          onResolveTarget: () => undefined,
        }),
      );

      expect(markup).not.toContain(
        "This saved run is not bound to a GST account. Continue only if the same GST account is currently open.",
      );
    }
  });

  it("offers reset for non-complete recovery targets", () => {
    for (const targetStatus of ["blocked", "failed", "cancelled"] as const) {
      const markup = renderToStaticMarkup(
        createElement(RecoveryActions, {
          busy: null,
          portalReady: true,
          summary: summaryFor(targetStatus),
          onAcknowledgeInterruptedRun: () => undefined,
          onRetryFullFiscalYearTarget: () => undefined,
          onRetryTarget: () => undefined,
          onResolveFullFiscalYearTarget: () => undefined,
          onResolveTarget: () => undefined,
        }),
      );

      expect(markup).toContain("Cancel and reset");
    }
  });

  it("labels target cancellation as reset so users know Start download returns", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: targetReviewSummary(),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Retry this period");
    expect(markup).toContain("Cancel and reset");
    expect(markup).not.toContain("Cancel target");
  });

  it("uses retry-first copy for a blocked full-year period", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: summaryFor("blocked"),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Retry this period");
    expect(markup).toContain("Cancel and reset");
    expect(markup).not.toContain("Retry full-year period");
  });

  it("shows an active-run control state without pretending pause is available", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: activeRunSummary(),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Run in progress");
    expect(markup).toContain(
      "Retry controls appear automatically if the run stops making progress.",
    );
    expect(markup).not.toContain("Pause");
  });

  it("replaces the start button while an active run is in progress", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: activeRunSummary().scope,
        flowSummary: activeRunSummary(),
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Run in progress");
    expect(markup).not.toContain("Start download");
  });

  it("keeps the normal start button hidden until a blocked target is resolved", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: targetReviewSummary().scope,
        flowSummary: targetReviewSummary(),
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Resolve current period first");
    expect(markup).not.toContain("Start download");
  });

  it("shows GSTR-1 as a radio filing option with artifact and full-year controls", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: "March",
          returnType: "GSTR-1",
        },
        flowSummary: null,
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain('type="radio"');
    expect(markup).toContain('class="scope-option scope-option-selected"');
    expect(markup).toContain('checked="" value="GSTR-1"');
    expect(markup).toContain('value="GSTR-3B"');
    expect(markup).toContain('value="PDF"');
    expect(markup).toContain("Summary PDF");
    expect(markup).toContain('value="EXCEL"');
    expect(markup).toContain("E-invoice details Excel");
    expect(markup).toContain('checked="" value="PDF_AND_EXCEL"');
    expect(markup).toContain("Summary PDF + e-invoice details Excel");
    expect(markup).toContain("Full fiscal year");
    expect(markup).not.toContain("monthly GSTR-3B filers only");
  });

  it("shows GSTR-2B May as exclusive radio selections with GSTR-2B artifacts", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-2B",
        },
        flowSummary: null,
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain('checked="" value="GSTR-2B"');
    expect(markup).toContain('value="GSTR-3B"');
    expect(markup).toContain('value="May" selected=""');
    expect(markup).toContain('value="June"');
    expect(markup).toContain('checked="" value="PDF_AND_EXCEL"');
    expect(markup).toContain("Summary PDF + details Excel");
    expect(markup).not.toContain("E-invoice details Excel");
  });

  it("explains GSTR-2B full-year Excel as portal-generated capture", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
        },
        flowSummary: null,
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Collect eligible periods into one local ZIP.");
    expect(markup).toContain("Hands off one ZIP");
    expect(markup).not.toContain("selected GSTR-1 e-invoice details file");
  });

  it("keeps the primary zip action in the workbench flow", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
        },
        flowSummary: null,
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup.indexOf("Start full-year ZIP")).toBeGreaterThan(-1);
    expect(markup.indexOf("Start full-year ZIP")).toBeGreaterThan(
      markup.indexOf("Summary PDF + details Excel"),
    );
  });

  it("explains single-period runs as active-tab downloads", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: {
          artifactType: "PDF",
          financialYear: "2026-27",
          period: "May",
          returnType: "GSTR-3B",
        },
        flowSummary: null,
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Collect one period from the active GST tab.");
    expect(markup).toContain("Target-bound click");
    expect(markup).toContain("Download selected period");
  });

  it("presents interrupted runs as resettable stuck work", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: interruptedRunSummary(),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Reset stuck run");
    expect(markup).not.toContain("Acknowledge interrupted run");
  });

  it("keeps the normal start button hidden until an interrupted run is reset", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: supportedPortalContext(),
        scope: interruptedRunSummary().scope,
        flowSummary: interruptedRunSummary(),
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Reset stuck run first");
    expect(markup).not.toContain("Start download");
  });

  it("keeps reset available but disables retry when the portal tab is missing", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: false,
        summary: summaryFor("blocked"),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Open a signed-in GST Portal tab before retrying this period.");
    expect(markup).toContain('<button type="button" disabled="">Retry this period</button>');
    expect(markup).toContain("Cancel and reset");
  });

  it("disables start when no actionable GST Portal tab is available", () => {
    const markup = renderToStaticMarkup(
      createElement(ScopeForm, {
        busy: null,
        context: null,
        scope: {
          artifactType: "PDF_AND_EXCEL",
          financialYear: "2025-26",
          period: FULL_FISCAL_YEAR_PERIOD,
          returnType: "GSTR-2B",
        },
        flowSummary: null,
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Open GST Portal tab first");
    expect(markup).toContain("Pack will not open login pages or reuse stale portal state.");
    expect(markup).not.toContain(">Start local full-year run<");
  });

  it("normalizes older login-opened evidence copy in the run panel", () => {
    const summary = summaryFor("blocked");
    summary.flowStep.safeSignals = ["gst-login-tab-opened"];
    summary.flowStep.safeMessage =
      "Pack opened the GST Portal login page. Sign in, then click Start download.";

    const markup = renderToStaticMarkup(
      createElement(RunEvidencePanel, {
        portalReady: false,
        filedReturnsObservation: null,
        scopedFlowSummary: summary,
        summaryHeading: "Last filed-returns run: blocked",
      }),
    );

    expect(markup).toContain(
      "Open a signed-in GST Portal tab, then retry this period or cancel and reset.",
    );
    expect(markup).not.toContain("Pack opened the GST Portal login page.");
  });

  it("explains final zip retry instead of showing stale unconfirmed copy", () => {
    const summary = summaryFor("download-unconfirmed");
    summary.status = "blocked";
    summary.flowStep.state = "download-unconfirmed";
    summary.flowStep.safeSignals = ["full-fiscal-year-zip-download-unconfirmed"];
    summary.flowStep.safeMessage =
      "Pack prepared the fiscal-year zip, but the final browser download did not complete.";

    const markup = renderToStaticMarkup(
      createElement(RunEvidencePanel, {
        portalReady: true,
        filedReturnsObservation: null,
        scopedFlowSummary: summary,
        summaryHeading: "Last filed-returns run: blocked",
      }),
    );

    expect(markup).toContain("Retry the final ZIP handoff before starting another full-year run.");
    expect(markup).not.toContain("the final browser download did not complete");
  });
});

function supportedPortalContext(): PortalContext {
  return {
    connectorId: "gst",
    pageKind: "gst-filed-returns",
    supported: true,
  };
}

function summaryFor(
  targetStatus: NonNullable<FiledReturnsFlowSummary["fullFiscalYearRecovery"]>["targetStatus"],
  signal = "full-fiscal-year-run-needs-action",
): FiledReturnsFlowSummary {
  return {
    scope: {
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    status: "blocked",
    completedPeriods: [],
    totalPeriods: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    fullFiscalYearRecovery: {
      ledgerId: "ledger-existing",
      targetId: "GSTR-3B:2026-27:April",
      expectedRevision: 2,
      targetStatus,
    },
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "user-action-required",
      safeSignals: [signal],
      safeMessage: "Needs action.",
    },
  };
}

function targetReviewSummary(): FiledReturnsFlowSummary {
  return {
    scope: {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    },
    status: "blocked",
    completedPeriods: [],
    totalPeriods: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "download-unconfirmed",
      safeSignals: ["filed-returns-target-review-required"],
      safeMessage: "Pack could not confirm the browser download for May.",
    },
  };
}

function activeRunSummary(): FiledReturnsFlowSummary {
  return {
    scope: {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    },
    status: "running",
    completedPeriods: [],
    totalPeriods: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "user-action-required",
      safeSignals: ["filed-returns-run-active"],
      safeMessage: "A filed-returns download run is already active in this browser profile.",
    },
  };
}

function interruptedRunSummary(): FiledReturnsFlowSummary {
  return {
    scope: {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    },
    status: "blocked",
    completedPeriods: [],
    totalPeriods: 1,
    updatedAt: "2026-06-24T00:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "user-action-required",
      safeSignals: ["filed-returns-run-needs-review"],
      safeMessage: "Pack found an interrupted filed-returns run.",
    },
  };
}
