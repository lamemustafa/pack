import { describe, expect, it } from "vitest";
import type { FiledReturnsFlowSummary, PortalContext } from "../../src/core/contracts";
import { FULL_FISCAL_YEAR_PERIOD } from "../../src/core/filed-returns-scope";
import { getPopupPresentationState } from "../../src/entrypoints/popup/presentation-state";

describe("popup presentation state", () => {
  it.each([
    ["unsupported", unsupportedContext(), null, null],
    ["session-expired", authContext(), null, null],
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

  it("does not let a previous blocked run mask an unsupported active tab", () => {
    const state = getPopupPresentationState(unsupportedContext(), blockedSummary(), null);

    expect(state.kind).toBe("unsupported");
    expect(state.title).toBe("Ready when you are");
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
        title: "Finish the saved fiscal-year ZIP",
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
