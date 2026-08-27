import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PortalContext } from "../../src/core/contracts";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { ScopeForm } from "../../src/entrypoints/popup/components";
import { RecoveryActions } from "../../src/entrypoints/popup/recovery-actions";
import { canReconcileFiledReturnsTarget } from "../../src/entrypoints/popup/run-summary";

describe("popup full-year recovery actions", () => {
  it("offers manual observation only for final-click recovery states", () => {
    expect(renderFullYearRecovery(summaryFor("download-unconfirmed"))).toContain(
      "Mark as manually observed",
    );
    for (const targetStatus of ["blocked", "failed", "running"] as const) {
      expect(renderFullYearRecovery(summaryFor(targetStatus))).not.toContain(
        "Mark as manually observed",
      );
    }
  });

  it("renders resume and discard immediately for a pending saved full-year run", () => {
    const pendingSummary = summaryFor("pending", "full-fiscal-year-resume-confirmation-required");
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: { ...pendingSummary, status: "running" },
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onStartFresh: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Resume saved run");
    expect(markup).toContain("Discard saved run");
    expect(markup).toContain("Discard saved run and start selected download");
    expect(markup).toContain("Saved run options");
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Filed return recovery actions"');
  });

  it("shows the same-account warning only for resume confirmation", () => {
    const resumeMarkup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary: summaryFor("pending", "full-fiscal-year-resume-confirmation-required"),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onStartFresh: () => undefined,
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
          onStartFresh: () => undefined,
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
          onStartFresh: () => undefined,
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
        onStartFresh: () => undefined,
        summary: targetReviewSummary(),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).not.toContain("Retry this period");
    expect(markup).not.toContain("Reconcile browser download");
    expect(markup).toContain("Discard saved state and start selected download");
    expect(markup).toContain("Cancel and reset");
    expect(markup).not.toContain("Cancel target");
    expect(markup).toContain(
      "Why Pack paused: Pack could not confirm the browser download for May.",
    );
  });

  it("shows only allowlisted download diagnostics for a target that needs review", () => {
    const summary = targetReviewSummary();
    summary.flowStep.safeSignals.push(
      "filed-gstr3b-main-world-capture-armed",
      "filed-gstr3b-target-bound-native-blob-click-delegated",
      "browser-download-not-observed",
      "unrelated-opaque-value",
    );

    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
        onStartFresh: () => undefined,
      }),
    );

    expect(markup).toContain("Safe diagnostics");
    expect(markup).toContain("filed-gstr3b-main-world-capture-armed");
    expect(markup).toContain("filed-gstr3b-target-bound-native-blob-click-delegated");
    expect(markup).toContain("browser-download-not-observed");
    expect(markup).not.toContain("unrelated-opaque-value");
  });

  it("offers only explicit reset controls for an interrupted selected-file bundle", () => {
    const summary = targetReviewSummary();
    summary.scope.artifactType = "PDF_AND_EXCEL";
    summary.flowStep.safeSignals.push(
      "single-period-bundle-artifact-review-required",
      "single-period-bundle-running-ambiguous",
      "single-period-opfs-retained",
    );
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary,
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Discard saved state and start selected download");
    expect(markup).toContain("Cancel and reset");
    expect(markup).not.toContain("Retry this period");
    expect(markup).not.toContain("Reconcile browser download");
    expect(markup).not.toContain("Retry local cleanup");
  });

  it.each([
    "filed-returns-download-reconciliation-required",
    "artifact-acquisition-download-completed-unpersisted",
    "artifact-acquisition-download-unreconciled",
  ])("labels %s as reconciliation, not retry", (signal) => {
    const summary = targetReviewSummary();
    summary.flowStep.safeSignals.push(signal);
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary,
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Reconcile browser download");
    expect(markup).not.toContain("Retry this period");
  });

  it("removes reconciliation after an extension reload expires session-only proof", () => {
    const summary = targetReviewSummary();
    summary.flowStep.safeSignals.push(
      "artifact-acquisition-download-unreconciled",
      "artifact-acquisition-session-proof-expired",
    );

    expect(canReconcileFiledReturnsTarget(summary)).toBe(false);

    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
        onStartFresh: () => undefined,
      }),
    );

    expect(markup).not.toContain("Reconcile browser download");
    expect(markup).toContain("extension reload cleared Pack&#x27;s temporary exact-download proof");
    expect(markup).toContain("Discard saved state and start selected download");
    expect(markup).toContain("Cancel and reset");
  });

  it("offers reconciliation for an observing selected-file ZIP", () => {
    const summary = targetReviewSummary();
    summary.scope.artifactType = "PDF_AND_EXCEL";
    summary.flowStep.safeSignals.push("filed-returns-download-reconciliation-required");
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary,
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Reconcile browser download");
    expect(markup).not.toContain("Retry this period");
  });

  it.each([
    ["intent-only", "artifact-acquisition-start-unreconciled"],
    ["malformed", "artifact-acquisition-checkpoint-malformed"],
  ] as const)(
    "keeps %s artifact recovery cancellable without a reconciliation action",
    (_kind, recoverySignal) => {
      const summary = targetReviewSummary();
      summary.flowStep.safeSignals.push(
        recoverySignal,
        "artifact-acquisition-download-unreconciled",
      );
      const markup = renderToStaticMarkup(
        createElement(RecoveryActions, {
          busy: null,
          portalReady: true,
          summary,
          onStartFresh: () => undefined,
          onAcknowledgeInterruptedRun: () => undefined,
          onRetryFullFiscalYearTarget: () => undefined,
          onRetryTarget: () => undefined,
          onResolveFullFiscalYearTarget: () => undefined,
          onResolveTarget: () => undefined,
        }),
      );

      expect(markup).not.toContain("Reconcile browser download");
      expect(markup).toContain("Cancel and reset");
    },
  );

  it("keeps local-only cleanup available without labeling it as a portal retry", () => {
    const summary = targetReviewSummary();
    summary.flowStep.safeSignals.push("filed-returns-target-local-cleanup-required");
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: true,
        summary,
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Retry local cleanup");
    expect(markup).not.toContain("Retry this period");
  });

  it("does not offer manual completion for an incomplete selected-file ZIP", () => {
    const summary = targetReviewSummary();
    summary.scope.artifactType = "PDF_AND_EXCEL";
    summary.flowStep.safeSignals.push("single-period-zip-incomplete");
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: false,
        summary,
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Cancel and reset");
    expect(markup).not.toContain("Record manual observation");
  });

  it("keeps portal-dependent destructive restart disabled without a GST tab", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: false,
        summary: targetReviewSummary(),
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain(
      '<button type="button" class="secondary" disabled="" aria-describedby="recovery-portal-disabled-reason">Discard saved state and start selected download</button>',
    );
    expect(markup).toContain('id="recovery-portal-disabled-reason"');
    expect(markup).toContain("Record manual observation");
    expect(markup).toContain("Cancel and reset");
  });

  it("renders an action-matched target-review reason without calling it a period retry", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: false,
        summary: targetReviewSummary(),
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Open a signed-in GST Portal tab before starting again.");
    expect(markup).not.toContain("retrying this period");
  });

  it("renders one portal-disabled reason for a paused full-year run", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        portalReady: false,
        summary: summaryFor("blocked"),
        onStartFresh: () => undefined,
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup.match(/Open a signed-in GST Portal tab/g) ?? []).toHaveLength(1);
    expect(markup).toContain(
      "Open a signed-in GST Portal tab before retrying this period or starting again.",
    );
    expect(markup.match(/aria-describedby="recovery-portal-disabled-reason"/g) ?? []).toHaveLength(
      2,
    );
    expect(markup).toContain('id="recovery-portal-disabled-reason"');
  });

  it("uses retry-first copy for a blocked full-year period", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        busy: null,
        onStartFresh: () => undefined,
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

  it("shows full-year recovery controls even when the portal step carries only overlay signals", () => {
    const markup = renderToStaticMarkup(
      createElement(RecoveryActions, {
        onStartFresh: () => undefined,
        busy: null,
        portalReady: true,
        summary: summaryFor("blocked", "detail-summary-modal-close-control-not-found"),
        onAcknowledgeInterruptedRun: () => undefined,
        onRetryFullFiscalYearTarget: () => undefined,
        onRetryTarget: () => undefined,
        onResolveFullFiscalYearTarget: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain("Retry this period");
    expect(markup).toContain("Cancel and reset");
    expect(markup).toContain("Why Pack paused: Needs action.");
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
        onStartFresh: () => undefined,
        onResolveTarget: () => undefined,
      }),
    );

    expect(markup).toContain(
      '<button type="button" disabled="" aria-describedby="recovery-run-active-reason">Run in progress</button>',
    );
    expect(markup).toContain('id="recovery-run-active-reason"');
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

    expect(markup).toContain("Retry after checking GST Portal");
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
    expect(markup).toContain("E-invoice details (Excel)");
    expect(markup).toContain('checked="" value="PDF_AND_EXCEL"');
    expect(markup).toContain("All formats");
    expect(markup).toContain("Single period");
    expect(markup).toContain("Full year");
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
    expect(markup).toContain("All formats");
    expect(markup).toContain("Details workbook");
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

    expect(markup).toContain(
      "Keep GST Portal visible in the foreground while Pack creates one ZIP for all eligible periods.",
    );
    expect(markup).not.toContain("selected GSTR-1 e-invoice details file");
  });

  it("keeps the primary zip action available for full-year multi-file runs", () => {
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

    expect(markup).toContain("Download all 2025-26 GSTR-2B files");
    expect(markup).toContain("All formats");
  });

  it("labels multi-file single-period runs as one local ZIP", () => {
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

    expect(markup).toContain("Collect the selected GSTR-2B formats into one local ZIP.");
    expect(markup).toContain("Download May 2026-27 GSTR-2B all formats");
    expect(markup).not.toContain("Download each selected format from the active GST tab.");
    expect(markup).not.toContain("Download May 2026-27 GSTR-2B ZIP");
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

    expect(markup).toContain("Download one period from the active GST tab.");
    expect(markup).toContain("Download May 2026-27 GSTR-3B PDF");
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
        onStartFresh: () => undefined,
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

    expect(markup).toContain("Reset interrupted run");
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
        onStartFresh: () => undefined,
      }),
    );

    expect(markup).toContain(
      "Open a signed-in GST Portal tab before retrying this period or starting again.",
    );
    expect(markup).toContain(
      '<button type="button" disabled="" aria-describedby="recovery-portal-disabled-reason">Retry this period</button>',
    );
    expect(markup).toContain("Cancel and reset");
  });

  it("disables start with a plain portal-needed reason when popup context is inactive", () => {
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

    expect(markup).toContain("Open GST Portal to continue.");
    expect(markup).toContain('id="scope-action-reason"');
    expect(markup).toContain('aria-describedby="scope-action-reason"');
    expect(markup).toContain('<button class="primary-action" type="button" disabled=""');
    expect(markup).not.toContain("Open GST Portal tab");
  });
});

function supportedPortalContext(): PortalContext {
  return {
    connectorId: "gst",
    pageKind: "gst-filed-returns",
    supported: true,
  };
}

function renderFullYearRecovery(summary: FiledReturnsFlowSummary): string {
  return renderToStaticMarkup(
    createElement(RecoveryActions, {
      busy: null,
      portalReady: true,
      summary,
      onAcknowledgeInterruptedRun: () => undefined,
      onRetryFullFiscalYearTarget: () => undefined,
      onRetryTarget: () => undefined,
      onResolveFullFiscalYearTarget: () => undefined,
      onResolveTarget: () => undefined,
      onStartFresh: () => undefined,
    }),
  );
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
