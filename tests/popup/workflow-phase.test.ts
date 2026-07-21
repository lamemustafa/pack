import { describe, expect, it } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/core/contracts";
import { getPopupWorkflowPhase } from "../../src/entrypoints/popup/workflow-phase";
import type { PopupPresentationState } from "../../src/entrypoints/popup/presentation-state";

const ready: PopupPresentationState = {
  badge: "Portal detected",
  body: "Ready.",
  icon: "✓",
  kind: "ready",
  title: "Ready",
  tone: "ready",
};

const summary: FiledReturnsFlowSummary = {
  scope: { financialYear: "2026-27", period: "May", returnType: "GSTR-3B" },
  status: "complete",
  completedPeriods: ["May"],
  totalPeriods: 1,
  updatedAt: "2026-07-21T00:00:00.000Z",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "downloaded",
    safeSignals: [],
    safeMessage: "Saved.",
  },
};

describe("popup archive workflow phase", () => {
  it("keeps the form in plan before a run exists", () => {
    expect(getPopupWorkflowPhase(ready, null)).toBe("plan");
  });

  it("shows an active run as the run phase", () => {
    expect(
      getPopupWorkflowPhase(
        { ...ready, kind: "downloading", badge: "Downloading", tone: "neutral" },
        { ...summary, status: "running" },
      ),
    ).toBe("run");
  });

  it("moves a terminal summary to results", () => {
    expect(getPopupWorkflowPhase(ready, summary)).toBe("results");
  });
});
