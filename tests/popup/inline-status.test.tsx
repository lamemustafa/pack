import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import {
  getInlinePrimaryAction,
  InlineStatus,
  hasInlinePrimaryAction,
  inlinePrimaryActionIsPortalGated,
} from "../../src/entrypoints/popup/inline-status";
import type { PopupPresentationState } from "../../src/entrypoints/popup/presentation-state";
import { RecoveryActions } from "../../src/entrypoints/popup/recovery-actions";

const blockedPresentation: PopupPresentationState = {
  badge: "Needs review",
  body: "Retry after checking the GST Portal page.",
  icon: "!",
  kind: "blocked",
  title: "May needs attention",
  tone: "warning",
};

const blockedSummary: FiledReturnsFlowSummary = {
  scope: { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" },
  status: "blocked",
  completedPeriods: [],
  totalPeriods: 1,
  currentPeriod: "May",
  updatedAt: "2026-07-10T00:00:00.000Z",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "user-action-required",
    safeSignals: ["filed-return-filter-candidate-not-found"],
    safeMessage: "Select the filed return filters in the GST portal, then start Pack again.",
  },
};

// `currentPeriod` is optional; under `exactOptionalPropertyTypes` a fixture that means
// "no current period" must omit the key entirely rather than set it to `undefined`.
function withoutCurrentPeriod(summary: FiledReturnsFlowSummary): FiledReturnsFlowSummary {
  const clone: FiledReturnsFlowSummary = { ...summary };
  delete clone.currentPeriod;
  return clone;
}

const completePresentation: PopupPresentationState = {
  badge: "Complete",
  body: "The selected files were saved by your browser.",
  icon: "\u2713",
  kind: "complete",
  title: "Your download is ready",
  tone: "success",
};

function fullYearSummary(safeSignals: string[]): FiledReturnsFlowSummary {
  return {
    scope: { financialYear: "2025-26", period: FULL_FISCAL_YEAR_PERIOD, returnType: "GSTR-3B" },
    status: "complete",
    completedPeriods: Array.from({ length: 12 }, (_, index) => `p${index}`),
    totalPeriods: 12,
    updatedAt: "2026-08-21T00:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals,
      safeMessage: "Full-year run finished.",
    },
  };
}

function singlePeriodSummary(safeSignals: string[]): FiledReturnsFlowSummary {
  return {
    scope: { financialYear: "2025-26", period: "May", returnType: "GSTR-3B", artifactType: "PDF" },
    status: "complete",
    completedPeriods: ["May"],
    totalPeriods: 1,
    updatedAt: "2026-08-21T00:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals,
      safeMessage: "Single-period run finished.",
    },
  };
}

describe("full-year completion claim", () => {
  it("does not claim the ZIP was saved when no download was correlated", () => {
    // A full-year run completes when every PERIOD is positive. That state cannot
    // observe the final ZIP, so announcing it saved was a completion claim with
    // no download evidence behind it -- while the delivery line on the same
    // screen said the opposite.
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={completePresentation}
        summary={fullYearSummary([])}
      />,
    );

    expect(markup).not.toContain("saved as one ZIP");
    expect(markup).toContain("ZIP unconfirmed");
    expect(markup).toContain("12 periods processed");
  });

  it("does not send the user to Downloads when no ZIP was ever meant to exist", () => {
    // Every period positively not-filed produces no ZIP by design. Telling the
    // user to check Downloads for it is the same contradiction, reversed.
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={completePresentation}
        summary={fullYearSummary(["full-fiscal-year-no-zip-artifacts"])}
      />,
    );

    expect(markup).not.toContain("ZIP unconfirmed");
    expect(markup).not.toContain("check browser Downloads");
    // ...and it must not fall through to the success body either, which would
    // claim a ZIP that was deliberately never created.
    expect(markup).not.toContain("saved as one ZIP");
    expect(markup).toContain("No ZIP created");
  });

  it("claims the ZIP only once a download is correlated", () => {
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={completePresentation}
        summary={fullYearSummary(["full-fiscal-year-zip-downloaded"])}
      />,
    );

    expect(markup).toContain("12 periods saved as one ZIP");
    expect(markup).not.toContain("ZIP unconfirmed");
  });
});

describe("single-period completion claim", () => {
  it("does not claim a selected file was saved without positive browser evidence", () => {
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Download unconfirmed",
          body: "Pack finished this run, but has not confirmed your browser saved the selected file. Check Browser Downloads.",
          icon: "!",
          kind: "complete",
          title: "Browser download not confirmed",
          tone: "warning",
        }}
        summary={singlePeriodSummary([])}
      />,
    );

    expect(markup).toContain("Browser download not confirmed");
    expect(markup).toContain("has not confirmed your browser saved the selected file");
    expect(markup).not.toContain("The selected file was saved by your browser.");
  });

  it("claims a selected file was saved after positive browser evidence", () => {
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={completePresentation}
        summary={singlePeriodSummary(["browser-download-completed", "browser-download-non-empty"])}
      />,
    );

    expect(markup).toContain("The selected file was saved by your browser.");
  });
});

describe("inline filed-return recovery status", () => {
  it("renders the cancelled-run reset confirmation instead of dropping it", () => {
    const cancelledSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      status: "cancelled",
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["filed-returns-target-cancelled"],
        safeMessage: "The saved target was cancelled.",
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Reset",
          body: "The previous recovery state was cleared. Start a fresh download when ready.",
          icon: "✓",
          kind: "ready",
          title: "Ready for a new download",
          tone: "ready",
        }}
        summary={cancelledSummary}
      />,
    );

    expect(markup).toContain("Ready for a new download");
    expect(markup).toContain("The previous recovery state was cleared");
  });

  it("still explains the portal-gated secondary action when the inline action is local", () => {
    const reconcileSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "filed-returns-target-review-required",
          "artifact-acquisition-download-unreconciled",
        ],
      },
    };

    // The inline action is local, so nothing would be duplicated and the panel
    // must keep its own reason: "Discard saved state and start selected
    // download" does reach the portal and stays disabled.
    expect(inlinePrimaryActionIsPortalGated(blockedPresentation, reconcileSummary)).toBe(false);

    const markup = renderToStaticMarkup(
      <RecoveryActions
        busy={null}
        portalReady={false}
        summary={reconcileSummary}
        onAcknowledgeInterruptedRun={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        onResolveFullFiscalYearTarget={vi.fn()}
        onResolveTarget={vi.fn()}
        onStartFresh={vi.fn()}
        showPortalRetryReason={
          !inlinePrimaryActionIsPortalGated(blockedPresentation, reconcileSummary)
        }
      />,
    );

    expect(markup).toContain("Discard saved state and start selected download");
    expect(markup).toMatch(/Open a signed-in GST Portal tab before [^<]+\./);
  });

  it("renders every portal-gated primary action disabled with a visible reason", () => {
    const fullYearSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      fullFiscalYearRecovery: {
        expectedRevision: 1,
        ledgerId: "full-fiscal-year-12345678",
        targetId: "GSTR-3B:2026-27:May",
        targetStatus: "blocked",
      },
    };

    for (const summary of [blockedSummary, fullYearSummary]) {
      const markup = renderToStaticMarkup(
        <InlineStatus
          busy={null}
          portalReady={false}
          onOpenPortal={vi.fn()}
          onRestartTarget={vi.fn()}
          onRetryFullFiscalYearTarget={vi.fn()}
          onRetryTarget={vi.fn()}
          presentation={blockedPresentation}
          summary={summary}
        />,
      );
      // No `continue` guard: a fixture that stops rendering its action must fail
      // here rather than silently skip its assertions.
      expect(markup).toContain("inline-status-primary");
      expect(markup).toContain("disabled");
      expect(markup).toContain('aria-describedby="inline-status-portal-disabled-reason"');
      expect(markup).toContain('id="inline-status-portal-disabled-reason"');
      expect(markup).toMatch(/Open a signed-in GST Portal tab before [^<]+\./);
    }
  });

  it("keeps local-only target-review retries enabled without a portal tab, on both surfaces", () => {
    const cleanupSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "filed-returns-target-review-required",
          "filed-returns-target-local-cleanup-required",
        ],
      },
    };
    const reconcileSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "filed-returns-target-review-required",
          "artifact-acquisition-download-unreconciled",
        ],
      },
    };

    for (const [summary, label] of [
      [cleanupSummary, "Retry local cleanup"],
      [reconcileSummary, "Reconcile browser download"],
    ] as const) {
      const inlineMarkup = renderToStaticMarkup(
        <InlineStatus
          busy={null}
          portalReady={false}
          onOpenPortal={vi.fn()}
          onRestartTarget={vi.fn()}
          onRetryFullFiscalYearTarget={vi.fn()}
          onRetryTarget={vi.fn()}
          presentation={blockedPresentation}
          summary={summary}
        />,
      );
      // No `continue` guard: assert the control is present before asserting its state.
      expect(inlineMarkup).toContain("inline-status-primary");
      expect(inlineMarkup).toContain(label);
      expect(inlineMarkup).not.toContain("disabled");
      expect(inlineMarkup).not.toContain("Open a signed-in GST Portal tab");

      const recoveryMarkup = renderToStaticMarkup(
        <RecoveryActions
          busy={null}
          portalReady={false}
          summary={summary}
          onAcknowledgeInterruptedRun={vi.fn()}
          onRetryFullFiscalYearTarget={vi.fn()}
          onRetryTarget={vi.fn()}
          onResolveFullFiscalYearTarget={vi.fn()}
          onResolveTarget={vi.fn()}
          onStartFresh={vi.fn()}
        />,
      );
      expect(recoveryMarkup).toContain(label);
      expect(recoveryMarkup).toContain(`<button type="button">${label}</button>`);
    }
  });

  it("renders Open GST Portal enabled and unexplained while the portal is unavailable", () => {
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady={false}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{ ...blockedPresentation, kind: "error" }}
        summary={blockedSummary}
      />,
    );

    expect(markup).toContain("Open GST Portal");
    expect(markup).not.toContain("disabled");
    expect(markup).not.toContain("Open a signed-in GST Portal tab before");
  });

  it("disables a retry while the GST Portal is unavailable and explains why", () => {
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady={false}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={blockedSummary}
      />,
    );

    expect(markup).toContain("Retry May");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Open a signed-in GST Portal tab before retrying May.");
  });

  it("keeps Open GST Portal enabled while the GST Portal is unavailable", () => {
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady={false}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Portal unavailable",
          body: "Open the GST Portal to continue.",
          icon: "!",
          kind: "error",
          title: "GST Portal unavailable",
          tone: "warning",
        }}
        summary={null}
      />,
    );

    expect(markup).toContain("Open GST Portal");
    expect(markup).not.toContain("disabled");
  });

  it("uses the same resume-saved-run decision on both full-year recovery surfaces", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      fullFiscalYearRecovery: {
        expectedRevision: 1,
        ledgerId: "full-fiscal-year-12345678",
        targetId: "GSTR-3B:2026-27:May",
        targetStatus: "pending",
      },
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["full-fiscal-year-resume-confirmation-required"],
      },
    };
    const inlineMarkup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady={false}
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );
    const recoveryMarkup = renderToStaticMarkup(
      <RecoveryActions
        busy={null}
        portalReady={false}
        summary={summary}
        onAcknowledgeInterruptedRun={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        onResolveFullFiscalYearTarget={vi.fn()}
        onResolveTarget={vi.fn()}
        onStartFresh={vi.fn()}
      />,
    );

    expect(inlineMarkup).toContain("Resume saved run");
    expect(recoveryMarkup).toContain("Resume saved run");
    expect(inlineMarkup).not.toContain("Retry May");
    expect(recoveryMarkup).not.toContain("Retry May");
    expect(inlineMarkup.match(/Open a signed-in GST Portal tab/g) ?? []).toHaveLength(1);
    expect(recoveryMarkup.match(/Open a signed-in GST Portal tab/g) ?? []).toHaveLength(1);
    expect(inlineMarkup).toContain(
      "Open a signed-in GST Portal tab before resuming the saved run.",
    );
    expect(recoveryMarkup).toContain(
      "Open a signed-in GST Portal tab before resuming the saved run or starting again.",
    );
  });

  it("uses the same resume-saved-period decision on both full-year recovery surfaces", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      fullFiscalYearRecovery: {
        expectedRevision: 1,
        ledgerId: "full-fiscal-year-12345678",
        targetId: "GSTR-3B:2026-27:May",
        targetStatus: "pending",
      },
    };
    const inlineMarkup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );
    const recoveryMarkup = renderToStaticMarkup(
      <RecoveryActions
        busy={null}
        portalReady
        summary={summary}
        onAcknowledgeInterruptedRun={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        onResolveFullFiscalYearTarget={vi.fn()}
        onResolveTarget={vi.fn()}
        onStartFresh={vi.fn()}
      />,
    );

    expect(inlineMarkup).toContain("Resume saved period");
    expect(recoveryMarkup).toContain("Resume saved period");
  });

  it("names the blocked full-year period on both recovery surfaces", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      fullFiscalYearRecovery: {
        expectedRevision: 1,
        ledgerId: "full-fiscal-year-12345678",
        targetId: "GSTR-3B:2026-27:May",
        targetStatus: "blocked",
      },
    };
    const inlineMarkup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );
    const recoveryMarkup = renderToStaticMarkup(
      <RecoveryActions
        busy={null}
        portalReady
        summary={summary}
        onAcknowledgeInterruptedRun={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        onResolveFullFiscalYearTarget={vi.fn()}
        onResolveTarget={vi.fn()}
        onStartFresh={vi.fn()}
      />,
    );

    expect(inlineMarkup).toContain("Retry May");
    expect(recoveryMarkup).toContain("Retry May");
  });

  it("renders every safe missing artifact reason for a partial ZIP", () => {
    const summary: FiledReturnsFlowSummary = {
      ...withoutCurrentPeriod(blockedSummary),
      status: "partial",
      flowStep: {
        ...blockedSummary.flowStep,
        state: "partial",
        safeSignals: ["filed-return-artifact-unavailable:EXCEL", "artifact-generation-timeout"],
        safeMessage: "Pack prepared a partial ZIP; missing EXCEL (artifact-generation-timeout).",
      },
    };
    const presentation: PopupPresentationState = {
      badge: "Partly complete",
      body: summary.flowStep.safeMessage,
      icon: "!",
      kind: "partial",
      title: "Download partly complete",
      tone: "warning",
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={presentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("EXCEL (artifact-generation-timeout)");
  });

  it("renders the cross-origin blocked start message", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["wrong-origin-open-returns-dashboard"],
        safeMessage: "Open Returns Dashboard in the GST Portal, then press Start again.",
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("Open Returns Dashboard in the GST Portal");
  });

  it("describes a completed full fiscal year as one ZIP", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      status: "complete",
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "downloaded",
        safeSignals: ["full-fiscal-year-complete", "full-fiscal-year-zip-downloaded"],
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Complete",
          body: "Complete.",
          icon: "✓",
          kind: "complete",
          title: "Download complete",
          tone: "success",
        }}
        summary={summary}
      />,
    );

    expect(markup).toContain("2 periods saved as one ZIP.");
    expect(markup).not.toContain("The selected file was saved by your browser.");
  });

  it("renders a completed filename override message", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      status: "complete",
      completedPeriods: ["May"],
      flowStep: {
        ...blockedSummary.flowStep,
        state: "downloaded",
        safeSignals: ["download-filename-overridden"],
        safeMessage:
          "Another extension changed where this file was saved. Check browser Downloads before using it.",
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Complete",
          body: "Complete.",
          icon: "✓",
          kind: "complete",
          title: "Download complete",
          tone: "success",
        }}
        summary={summary}
      />,
    );

    expect(markup).toContain("Another extension changed where this file was saved");
    expect(markup).not.toContain("download.pdf");
  });

  it("renders the filename-free ZIP override message ahead of the full-year success summary", () => {
    const summary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      status: "complete",
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "downloaded",
        safeSignals: ["full-fiscal-year-zip-downloaded", "zip-download-filename-overridden"],
        safeMessage:
          "Pack completed the ZIP download, but the browser saved it under a different name. Check browser Downloads before using the file.",
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={{
          badge: "Complete",
          body: "Complete.",
          icon: "✓",
          kind: "complete",
          title: "Download complete",
          tone: "success",
        }}
        summary={summary}
      />,
    );

    expect(markup).toContain("browser saved it under a different name");
    expect(markup).not.toContain("2 periods saved as one ZIP.");
  });

  it("shows the final-ZIP check warning without requiring a current period", () => {
    const summary: FiledReturnsFlowSummary = {
      ...withoutCurrentPeriod(blockedSummary),
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-final-zip-retry",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-zip-phase:download-started",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage:
          "Pack started the final fiscal-year ZIP download before the previous run stopped. Check browser Downloads before retrying it.",
      },
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("Check Browser Downloads");
    expect(markup).toContain("Check browser Downloads before retrying it");
  });

  it("offers exact-ID status reconciliation without another ZIP download", () => {
    const summary: FiledReturnsFlowSummary = {
      ...withoutCurrentPeriod(blockedSummary),
      scope: { ...blockedSummary.scope, period: FULL_FISCAL_YEAR_PERIOD },
      completedPeriods: ["April", "May"],
      totalPeriods: 2,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "full-fiscal-year-final-zip-manual-review",
          "full-fiscal-year-zip-download-unconfirmed",
          "full-fiscal-year-zip-phase:download-observing",
          "full-fiscal-year-opfs-retained",
        ],
        safeMessage:
          "Pack saved the browser download ID and must reconcile that exact download before another ZIP can start.",
      },
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={summary}
      />,
    );

    expect(markup).toContain("Check final ZIP status");
    expect(markup).toContain("reconcile that exact download");
  });

  it("offers an explicit retry for a blocked period", () => {
    expect(hasInlinePrimaryAction(blockedPresentation, blockedSummary)).toBe(true);
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const action = getInlinePrimaryAction(blockedPresentation, blockedSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget,
    });
    action?.onClick();

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={blockedSummary}
      />,
    );

    expect(markup).toContain("Retry May");
    expect(markup).toContain(
      "Select the filed return filters in the GST portal, then start Pack again.",
    );
    expect(onRestartTarget).toHaveBeenCalledOnce();
    expect(onRetryTarget).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous no-ID review fail-closed behind explicit run controls", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-target-review-required"],
      },
    };
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const action = getInlinePrimaryAction(blockedPresentation, targetReviewSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget,
    });
    expect(action).toBeNull();
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={targetReviewSummary}
      />,
    );

    expect(markup).toContain("May needs review");
    expect(markup).toContain("Resolve May before choosing another period");
    expect(markup).toContain("More run controls");
    expect(markup).toContain("Check Browser Downloads");
    expect(markup).not.toContain("Retry May");
    expect(onRetryTarget).not.toHaveBeenCalled();
    expect(onRestartTarget).not.toHaveBeenCalled();
  });

  it.each([
    "filed-returns-download-reconciliation-required",
    "artifact-acquisition-download-completed-unpersisted",
    "artifact-acquisition-download-unreconciled",
  ])("labels %s as reconciliation", (signal) => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-target-review-required", signal],
      },
    };
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const action = getInlinePrimaryAction(blockedPresentation, targetReviewSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget,
    });
    action?.onClick();

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={targetReviewSummary}
      />,
    );

    expect(action?.label).toBe("Reconcile browser download");
    expect(markup).toContain("Reconcile browser download");
    expect(markup).not.toContain("Retry May");
    expect(onRetryTarget).toHaveBeenCalledOnce();
    expect(onRestartTarget).not.toHaveBeenCalled();
  });

  it("does not offer reconciliation after an extension reload expires session-only proof", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      currentPeriod: "May",
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: [
          "filed-returns-target-review-required",
          "artifact-acquisition-download-unreconciled",
          "artifact-acquisition-session-proof-expired",
        ],
      },
    };

    const action = getInlinePrimaryAction(blockedPresentation, targetReviewSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget: vi.fn(),
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget: vi.fn(),
    });

    expect(action).toBeNull();
  });

  it("offers reconciliation for an observing selected-file ZIP", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, artifactType: "PDF_AND_EXCEL" },
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "filed-returns-target-review-required",
          "filed-returns-download-reconciliation-required",
        ],
      },
    };
    const action = getInlinePrimaryAction(blockedPresentation, targetReviewSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget: vi.fn(),
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget: vi.fn(),
    });

    expect(action?.label).toBe("Reconcile browser download");
  });

  it.each([
    ["intent-only", "artifact-acquisition-start-unreconciled"],
    ["malformed", "artifact-acquisition-checkpoint-malformed"],
  ] as const)("does not offer reconciliation for %s artifact recovery", (_kind, recoverySignal) => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: [
          "filed-returns-target-review-required",
          recoverySignal,
          "artifact-acquisition-download-unreconciled",
        ],
      },
    };
    const onRetryTarget = vi.fn();
    const action = getInlinePrimaryAction(blockedPresentation, targetReviewSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget: vi.fn(),
      onRetryFullFiscalYearTarget: vi.fn(),
      onRetryTarget,
    });

    expect(action).toBeNull();
    expect(hasInlinePrimaryAction(blockedPresentation, targetReviewSummary)).toBe(false);
    expect(onRetryTarget).not.toHaveBeenCalled();
  });

  it("does not advertise manual completion for an incomplete selected-file ZIP", () => {
    const targetReviewSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      flowStep: {
        ...blockedSummary.flowStep,
        state: "download-unconfirmed",
        safeSignals: ["filed-returns-target-review-required", "single-period-zip-incomplete"],
      },
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={() => undefined}
        onRestartTarget={() => undefined}
        onRetryFullFiscalYearTarget={() => undefined}
        onRetryTarget={() => undefined}
        presentation={blockedPresentation}
        summary={targetReviewSummary}
      />,
    );

    expect(markup).toContain("discard the saved state and start the selected files again");
    expect(markup).toContain("cancel and reset");
    expect(markup).not.toContain("mark it reviewed");
  });

  it("routes a blocked full-year period to the revision-checked full-year retry", () => {
    const onRetryFullFiscalYearTarget = vi.fn();
    const onRestartTarget = vi.fn();
    const onRetryTarget = vi.fn();
    const fullYearSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: "ALL" },
      fullFiscalYearRecovery: {
        ledgerId: "ledger-safe",
        targetId: "target-safe",
        expectedRevision: 2,
        targetStatus: "blocked",
      },
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["detail-summary-modal-close-control-not-found"],
      },
    };
    const action = getInlinePrimaryAction(blockedPresentation, fullYearSummary, {
      onOpenPortal: vi.fn(),
      onRestartTarget,
      onRetryFullFiscalYearTarget,
      onRetryTarget,
    });

    action?.onClick();

    expect(action?.label).toBe("Retry May");
    expect(onRetryFullFiscalYearTarget).toHaveBeenCalledOnce();
    expect(onRetryTarget).not.toHaveBeenCalled();

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={onRestartTarget}
        onRetryFullFiscalYearTarget={onRetryFullFiscalYearTarget}
        onRetryTarget={onRetryTarget}
        presentation={blockedPresentation}
        summary={fullYearSummary}
      />,
    );
    expect(markup).toContain("Full-year run paused at May");
    expect(markup).toContain("summary overlay opened before Pack found a recognized Close control");
  });

  it("renders the remedy the flow computed instead of only the reason", () => {
    // The wrong-origin block a GSTR-3B run hits after a GSTR-2B run: Pack knows
    // the page is wrong and knows which portal control fixes it. Before this,
    // the panel showed a generic "resolve the GST Portal page" and dropped the
    // instruction, leaving the reader with nothing to act on.
    const fullYearSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: "ALL" },
      currentPeriod: "April",
      fullFiscalYearRecovery: {
        ledgerId: "full-fiscal-year-00000001",
        targetId: "GSTR-3B:2026-27:April",
        expectedRevision: 2,
        targetStatus: "blocked",
      },
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["wrong-origin-open-returns-dashboard", "returns-dashboard-anchor-not-found"],
        safeMessage:
          "Pack needs the GST Portal Returns Dashboard before it can acquire filed GSTR-3B.",
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message:
            "Open Services > Returns > Returns Dashboard in the GST Portal, then press Start again.",
          canResume: true,
        },
      },
    };

    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={fullYearSummary}
      />,
    );

    expect(markup).toContain("Returns Dashboard in the GST Portal, then press Start again");
  });

  it("explains when the portal keeps its overlay open after the recognized Close click", () => {
    const fullYearSummary: FiledReturnsFlowSummary = {
      ...blockedSummary,
      scope: { ...blockedSummary.scope, period: "ALL" },
      fullFiscalYearRecovery: {
        ledgerId: "ledger-safe",
        targetId: "target-safe",
        expectedRevision: 2,
        targetStatus: "blocked",
      },
      flowStep: {
        ...blockedSummary.flowStep,
        safeSignals: ["detail-summary-modal-close-blocked"],
      },
    };
    const markup = renderToStaticMarkup(
      <InlineStatus
        busy={null}
        portalReady
        onOpenPortal={vi.fn()}
        onRestartTarget={vi.fn()}
        onRetryFullFiscalYearTarget={vi.fn()}
        onRetryTarget={vi.fn()}
        presentation={blockedPresentation}
        summary={fullYearSummary}
      />,
    );

    expect(markup).toContain("kept its summary overlay open after Pack clicked");
  });
});
