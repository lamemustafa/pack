import { describe, expect, it } from "vitest";
import type { FiledReturnsFlowSummary, PortalContext } from "../../src/core/contracts";
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
  ] as const)("maps %s to one actionable state", (kind, context, summary, busy) => {
    expect(getPopupPresentationState(context, summary, busy).kind).toBe(kind);
  });

  it("keeps an unsupported tab out of the download builder", () => {
    const state = getPopupPresentationState(unsupportedContext(), null, null);

    expect(state.title).toBe("Ready when you are");
    expect(state.body).toContain("filed returns");
  });

  it("does not describe a partial completion as a failure", () => {
    const state = getPopupPresentationState(supportedContext(), partialSummary(), null);

    expect(state.tone).toBe("warning");
    expect(state.title).toBe("Download partly complete");
    expect(state.tone).not.toBe("danger");
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
