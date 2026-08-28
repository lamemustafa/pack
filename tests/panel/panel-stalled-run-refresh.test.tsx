import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { panelController, PANEL_TEST_SCOPE } from "./panel-controller.test-helpers";

/**
 * A stalled run writes nothing, so the storage change that would prompt the panel to
 * re-read the saved run is exactly the event a stall withholds. Returning to the page is
 * therefore the moment the panel has to ask again -- otherwise it keeps rendering
 * "Run in progress" under a promise that retry controls arrive on their own, which is what
 * a live full-year GSTR-2B run did twice with no way out short of a reset.
 */

const ACTIVE: FiledReturnsFlowSummary = {
  scope: PANEL_TEST_SCOPE,
  status: "running",
  completedPeriods: [],
  updatedAt: "2026-08-27T05:00:00.000Z",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst:filed-returns:GSTR-3B",
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-active"],
    safeMessage: "A full fiscal year run for FY 2025-26 is already active.",
  },
};

const INTERRUPTED: FiledReturnsFlowSummary = {
  scope: PANEL_TEST_SCOPE,
  status: "blocked",
  completedPeriods: [],
  updatedAt: "2026-08-27T05:05:00.000Z",
  flowStep: {
    connectorId: "gst",
    scopeId: "gst:filed-returns:GSTR-3B",
    state: "user-action-required",
    safeSignals: ["full-fiscal-year-run-interrupted"],
    safeMessage:
      "Pack stopped before it could confirm the FY 2025-26 run. Check Downloads before starting again.",
  },
  fullFiscalYearRecovery: {
    ledgerId: "stalled",
    targetId: "GSTR-3B:2025-26:May",
    expectedRevision: 3,
    targetStatus: "running",
  },
};

let dom: JSDOM;
let root: Root | null = null;
let container: Element;
let summaryReads = 0;

function realmEvent(win: JSDOM["window"], type: string): Event {
  const { Event: RealmEvent } = win as unknown as { Event: new (type: string) => Event };
  return new RealmEvent(type);
}

/** The background reports the run interrupted once asked; the panel has to ask. */
function Harness() {
  const [summary, setSummary] = React.useState<FiledReturnsFlowSummary>(ACTIVE);
  const refreshFlowSummary = React.useCallback(async () => {
    summaryReads += 1;
    setSummary(INTERRUPTED);
  }, []);
  return (
    <PanelSurface
      pack={panelController({
        scopedFlowSummary: summary,
        lastRunSummary: summary,
        refreshFlowSummary,
      })}
    />
  );
}

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness />);
    await Promise.resolve();
  });
}

describe("a panel left open on a stalled run", () => {
  beforeEach(() => {
    summaryReads = 0;
    dom = new JSDOM("<div id='root'></div>", {
      pretendToBeVisual: true,
      url: "https://extension.test",
    });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.getElementById("root") as Element;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
  });

  it("re-reads the saved run when the user comes back to the page", async () => {
    await mount();
    expect(summaryReads).toBe(0);
    expect(container.textContent).toContain("Filed-returns run in progress");

    await act(async () => {
      dom.window.dispatchEvent(realmEvent(dom.window, "focus"));
      await Promise.resolve();
    });

    expect(summaryReads).toBe(1);
    expect(container.textContent).not.toContain("Filed-returns run in progress");
    expect(container.textContent).toContain(
      "Pack stopped before it could confirm the FY 2025-26 run.",
    );
    // The escape the panel promised: a stalled run stops occupying the surface, so the
    // user can start the next one without first hunting for a reset.
    expect(container.textContent).toContain("What do you need?");
  });
});
