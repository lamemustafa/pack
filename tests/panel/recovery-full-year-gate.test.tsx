import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { RecoveryActions } from "../../src/entrypoints/popup/recovery-actions";

/**
 * A packaged build withholds the full-year surface everywhere it is offered -- but a ledger
 * persisted by an earlier release still reaches recovery, and those controls resume or restart
 * the very flow that was withheld. Gating cannot hide the block outright: that would leave a
 * reader looking at a saved run they cannot dismiss. So the two controls that re-enter the flow
 * are withheld and the local ones stay.
 */

const SAVED_FULL_YEAR: FiledReturnsFlowSummary = {
  scope: {
    financialYear: "2025-26",
    period: "FULL_FISCAL_YEAR",
    returnType: "GSTR-3B",
    artifactType: "PDF",
  },
  status: "blocked",
  completedPeriods: [],
  updatedAt: "2026-08-29T00:00:00.000Z",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst:filed-returns:GSTR-3B",
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-interrupted"],
    safeMessage: "Pack stopped before it could confirm the FY 2025-26 run.",
  },
  fullFiscalYearRecovery: {
    ledgerId: "saved",
    targetId: "GSTR-3B:2025-26:May",
    expectedRevision: 2,
    targetStatus: "running",
  },
};

let dom: JSDOM;
let root: Root | null = null;
let container: Element;

async function mount(
  fullYearFlowAvailable: boolean,
  portalReady = true,
  summary: FiledReturnsFlowSummary = SAVED_FULL_YEAR,
) {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <RecoveryActions
        busy={null}
        portalReady={portalReady}
        summary={summary}
        fullYearFlowAvailable={fullYearFlowAvailable}
        onAcknowledgeInterruptedRun={() => undefined}
        onRetryFullFiscalYearTarget={() => undefined}
        onRetryTarget={() => undefined}
        onResolveFullFiscalYearTarget={() => undefined}
        onResolveTarget={() => undefined}
        onStartFresh={() => undefined}
      />,
    );
    await Promise.resolve();
  });
}

function buttonLabels(): string[] {
  return [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
}

describe("saved full-year recovery in a build that withholds the flow", () => {
  beforeEach(() => {
    dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "https://x.test" });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.getElementById("root") as Element;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
  });

  it("offers no way to resume or restart the run", async () => {
    await mount(false);

    const labels = buttonLabels();
    expect(labels.some((label) => label.includes("Discard saved run and start"))).toBe(false);
    expect(labels.some((label) => label.includes("Resume"))).toBe(false);
    expect(labels.some((label) => label.includes("Retry"))).toBe(false);
  });

  it("still lets the reader clear the saved run", async () => {
    // Withholding everything would strand someone with a run they can see and cannot dismiss.
    await mount(false);

    const labels = buttonLabels();
    expect(labels.some((label) => /Cancel|Discard saved run$/.test(label))).toBe(true);
    expect(container.textContent).toContain("This build cannot continue a full-year run");
  });

  it("does not promise a hidden retry when the portal is unavailable", async () => {
    await mount(false, false);

    expect(container.textContent).not.toContain("Open a signed-in GST Portal tab before");
  });

  it("withholds fresh starts from a full-year target review", async () => {
    const targetReview = {
      ...SAVED_FULL_YEAR,
      flowStep: {
        ...SAVED_FULL_YEAR.flowStep,
        safeSignals: ["filed-returns-target-review-required"],
      },
    };
    delete targetReview.fullFiscalYearRecovery;
    await mount(false, true, targetReview);

    expect(container.textContent).not.toContain("Discard saved state and start selected download");
    expect(container.textContent).toContain("This build cannot start a full-year run");
    expect(container.textContent).toContain("Cancel and reset");
  });

  it("keeps both controls in a build that may run it", async () => {
    await mount(true);

    const labels = buttonLabels();
    expect(labels.some((label) => label.includes("Discard saved run and start"))).toBe(true);
    expect(container.textContent).not.toContain("This build cannot continue a full-year run");
  });
});
