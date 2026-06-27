import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import {
  canManuallyObserveFullFiscalYearTarget,
  RecoveryActions,
  ScopeForm,
} from "../../src/entrypoints/popup/components";

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

  it("shows the same-account warning on every full-year recovery path", () => {
    for (const targetStatus of ["blocked", "failed", "cancelled"] as const) {
      const markup = renderToStaticMarkup(
        createElement(RecoveryActions, {
          busy: null,
          summary: summaryFor(targetStatus),
          onAcknowledgeInterruptedRun: () => undefined,
          onRetryFullFiscalYearTarget: () => undefined,
          onRetryTarget: () => undefined,
          onResolveFullFiscalYearTarget: () => undefined,
          onResolveTarget: () => undefined,
        }),
      );

      expect(markup).toContain(
        "This saved run is not bound to a GST account. Continue only if the same GST account is currently open.",
      );
    }
  });

  it("offers reset for non-complete recovery targets", () => {
    for (const targetStatus of ["blocked", "failed", "cancelled"] as const) {
      const markup = renderToStaticMarkup(
        createElement(RecoveryActions, {
          busy: null,
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
        scope: targetReviewSummary().scope,
        flowSummary: targetReviewSummary(),
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Resolve current period first");
    expect(markup).not.toContain("Start download");
  });

  it("presents interrupted runs as resettable stuck work", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
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
        scope: interruptedRunSummary().scope,
        flowSummary: interruptedRunSummary(),
        onScopeChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain("Reset stuck run first");
    expect(markup).not.toContain("Start download");
  });
});

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
