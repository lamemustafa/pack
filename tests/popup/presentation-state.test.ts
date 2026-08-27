import { describe, expect, it } from "vitest";
import type { PortalContext } from "../../src/core/contracts";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/connectors/gst/filed-returns-scope";
import { getPopupPresentationState } from "../../src/entrypoints/popup/presentation-state";

describe("popup presentation state", () => {
  it.each([
    ["unsupported", unsupportedContext(), null, null],
    ["session-expired", authContext(), null, null],
    ["access-denied", accessDeniedContext(), null, null],
    ["ready", supportedContext(), null, null],
    ["downloading", supportedContext(), runningSummary(), "start-filed-returns-flow"],
    ["partial", supportedContext(), partialSummary(), null],
    ["complete", supportedContext(), completeSummary(), null],
    ["unavailable", supportedContext(), unavailableSummary(), null],
    ["blocked", supportedContext(), blockedSummary(), null],
    ["ready", supportedContext(), cancelledSummary(), null],
  ] as const)("maps %s to one actionable state", (kind, context, summary, busy) => {
    expect(getPopupPresentationState(context, summary, busy).kind).toBe(kind);
  });

  it("keeps an unsupported tab out of the download builder", () => {
    const state = getPopupPresentationState(unsupportedContext(), null, null);

    expect(state.title).toBe("Ready when you are");
    expect(state.body).toContain("filed returns");
  });

  it("renders a blocked run message on an unsupported active tab", () => {
    const state = getPopupPresentationState(unsupportedContext(), blockedSummary(), null);

    expect(state.kind).toBe("blocked");
    expect(state.body).toBeTruthy();
  });

  it.each([
    completeSummary(),
    unavailableSummary(),
    partialSummary(),
    blockedSummary(),
    cancelledSummary(),
  ])("renders a non-empty message for terminal %s state on an unsupported tab", (summary) => {
    const state = getPopupPresentationState(unsupportedContext(), summary, null);

    expect(state.body.trim()).not.toBe("");
    expect(state.title.trim()).not.toBe("");
  });

  it("renders the cross-origin blocked step's user-facing message", () => {
    const state = getPopupPresentationState(
      unsupportedContext(),
      {
        ...blockedSummary(),
        flowStep: {
          ...blockedSummary().flowStep,
          safeSignals: ["wrong-origin-open-returns-dashboard"],
          safeMessage: "Open Returns Dashboard in the GST Portal, then press Start again.",
        },
      },
      null,
    );

    expect(state.kind).toBe("blocked");
    expect(state.body).toContain("May");
  });

  it("keeps retained final-ZIP recovery actionable on an unsupported tab", () => {
    const retainedZipSummary: FiledReturnsFlowSummary = {
      ...COMPLETE_FULL_YEAR_SUMMARY,
      status: "blocked",
      flowStep: {
        ...COMPLETE_FULL_YEAR_SUMMARY.flowStep,
        state: "blocked",
        safeSignals: ["full-fiscal-year-final-zip-retry", "full-fiscal-year-opfs-retained"],
        safeMessage: "Retry local cleanup.",
      },
    };

    expect(getPopupPresentationState(unsupportedContext(), retainedZipSummary, null)).toMatchObject(
      {
        kind: "blocked",
        title: "Saved run needs attention",
      },
    );
  });

  it("does not describe a partial completion as a failure", () => {
    const state = getPopupPresentationState(supportedContext(), partialSummary(), null);

    expect(state.tone).toBe("warning");
    expect(state.title).toBe("Download partly complete");
    expect(state.tone).not.toBe("danger");
  });

  it("returns a cancelled target review to a fresh runnable state", () => {
    const state = getPopupPresentationState(supportedContext(), cancelledSummary(), null);

    expect(state).toMatchObject({
      kind: "ready",
      title: "Ready for a new download",
      tone: "ready",
    });
  });

  it("renders a caught background failure instead of leaving the prior presentation visible", () => {
    expect(
      getPopupPresentationState(
        supportedContext(),
        null,
        null,
        "Pack stopped while handling this action. Try again.",
      ),
    ).toMatchObject({
      body: "Pack stopped while handling this action. Try again.",
      kind: "error",
      title: "Pack could not finish that action",
    });
  });

  it("does not claim an unconfirmed single-period completion was saved", () => {
    const state = getPopupPresentationState(supportedContext(), completeSummary(), null);

    expect(state).toMatchObject({
      badge: "Download unconfirmed",
      body: "Pack finished this run, but has not confirmed your browser saved the selected file. Check Browser Downloads.",
      title: "Browser download not confirmed",
      tone: "warning",
    });
  });

  it("keeps the completion claim after positive single-period download evidence", () => {
    const state = getPopupPresentationState(
      supportedContext(),
      summary("complete", ["browser-download-completed", "browser-download-non-empty"]),
      null,
    );

    expect(state).toMatchObject({
      badge: "Complete",
      body: "The selected files were saved by your browser.",
      tone: "success",
    });
  });
});

function supportedContext(): PortalContext {
  return { connectorId: "gst", pageKind: "gst-filed-returns", supported: true };
}

function unsupportedContext(): PortalContext {
  return { connectorId: "gst", pageKind: "unsupported", supported: false };
}

function authContext(): PortalContext {
  return {
    connectorId: "gst",
    pageKind: "gst-auth-landing",
    requiredAction: { type: "LOGIN", message: "Sign in", canResume: true },
    supported: false,
  };
}

function accessDeniedContext(): PortalContext {
  return {
    connectorId: "gst",
    pageKind: "gst-access-denied",
    supported: false,
  };
}

function summary(
  status: FiledReturnsFlowSummary["status"],
  safeSignals: string[],
): FiledReturnsFlowSummary {
  const base: Omit<FiledReturnsFlowSummary, "currentPeriod"> = {
    scope: {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-3B",
      artifactType: "PDF",
    },
    status,
    completedPeriods: status === "complete" ? ["May"] : [],
    totalPeriods: 1,
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state:
        status === "running"
          ? "user-action-required"
          : status === "complete"
            ? "downloaded"
            : "blocked",
      safeSignals,
      safeMessage: "Pack state.",
    },
  };
  return status === "blocked" ? { ...base, currentPeriod: "May" } : base;
}

function runningSummary() {
  return summary("running", ["filed-returns-run-active"]);
}

function partialSummary() {
  return summary("partial", ["filed-return-artifact-downloaded:PDF"]);
}

function completeSummary() {
  return summary("complete", []);
}

function unavailableSummary() {
  return summary("complete", ["filed-return-artifact-unavailable:EXCEL"]);
}

function blockedSummary() {
  return summary("blocked", ["filed-returns-target-review-required"]);
}

function cancelledSummary(): FiledReturnsFlowSummary {
  return {
    ...summary("cancelled", ["filed-returns-target-cancelled"]),
    currentPeriod: "May",
  };
}

const COMPLETE_FULL_YEAR_SUMMARY: FiledReturnsFlowSummary = {
  scope: {
    artifactType: "PDF",
    financialYear: "2025-26",
    period: FULL_FISCAL_YEAR_PERIOD,
    returnType: "GSTR-3B",
  },
  status: "complete",
  completedPeriods: ["April", "May"],
  totalPeriods: 2,
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "downloaded",
    safeSignals: ["full-fiscal-year-complete"],
    safeMessage: "Complete.",
  },
};
