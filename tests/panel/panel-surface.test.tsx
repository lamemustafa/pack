import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import {
  PACK_EXTENSION_PERMISSIONS,
  PACK_GST_HOST_PERMISSIONS,
} from "../../src/extension/manifest-policy";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { panelPresets } from "../../src/entrypoints/panel/panel-presets";
import { PanelSurface, type PackPanelController } from "../../src/entrypoints/panel/panel-surface";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf-8");

const firstPreset = panelPresets()[0];

function controller(overrides: Partial<PackPanelController> = {}): PackPanelController {
  return {
    acknowledgeInterruptedRun: async () => undefined,
    actionError: null,
    completionStatus: null,
    context: { connectorId: "gst", pageKind: "gst-filed-returns", supported: true },
    effectiveBusy: null,
    filedReturnsObservation: null,
    lastRunSummary: null,
    recoverySummary: null,
    resolveFullFiscalYearTarget: async () => undefined,
    resolveUnconfirmedDownload: async () => undefined,
    retryFiledReturnsTarget: async () => undefined,
    retryFullFiscalYearTarget: async () => undefined,
    scope: firstPreset.scope,
    scopeLockedForReview: false,
    scopedFlowSummary: null,
    setScope: () => undefined,
    startFiledReturnsFlow: async () => undefined,
    startFreshFiledReturnsFlow: async () => undefined,
    status: "GST context detected.",
    summaryHeading: null,
    ...overrides,
  };
}

function completedSummary(
  overrides: Partial<FiledReturnsFlowSummary> = {},
): FiledReturnsFlowSummary {
  return {
    scope: firstPreset.scope,
    status: "complete",
    completedPeriods: ["April", "May"],
    totalPeriods: 2,
    updatedAt: "2026-08-21T00:00:00.000Z",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: "downloaded",
      safeSignals: ["full-fiscal-year-zip-downloaded"],
      safeMessage: "Pack saved the fiscal-year ZIP through your browser.",
    },
    ...overrides,
  };
}

/** The rendered markup of the one preset button carrying `label`. */
function presetButton(markup: string, label: string): string {
  const escaped = label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
  const button = markup
    .split("<button")
    .map((fragment) => `<button${fragment}`)
    .find((fragment) => fragment.includes(escaped));
  expect(button, `no preset button rendered for ${label}`).toBeDefined();
  return (button as string).split("</button>")[0];
}

describe("panel surface", () => {
  it("costs no new permission and no new host", () => {
    // Phase A is an ordinary extension page. If this test fails, the panel has stopped
    // being free and the sidePanel decision is no longer separable from shipping it.
    expect([...PACK_EXTENSION_PERMISSIONS]).toEqual([
      "downloads",
      "offscreen",
      "scripting",
      "storage",
    ]);
    expect(PACK_GST_HOST_PERMISSIONS).toHaveLength(4);
    expect(read("wxt.config.ts")).not.toContain("sidePanel");
  });

  it("reuses the popup controller instead of reimplementing the flow", () => {
    const main = read("src/entrypoints/panel/main.tsx");
    expect(main).toContain("usePackPopupController");
    expect(read("src/entrypoints/panel/panel-surface.tsx")).not.toContain(
      "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
    );
  });

  it("is reachable from the popup", () => {
    expect(read("src/entrypoints/popup/main.tsx")).toContain("/panel.html");
  });

  it("keeps the local-only boundary and the non-affiliation disclaimer visible", () => {
    const markup = renderToStaticMarkup(<PanelSurface pack={controller()} />);

    expect(markup).toContain("stay on this device");
    expect(markup).toContain(
      "Not affiliated with, endorsed by, or operated by GSTN, CBIC, or the Government of India.",
    );
  });

  it("renders a completed run instead of dropping silently back to the chooser", () => {
    const markup = renderToStaticMarkup(
      <PanelSurface pack={controller({ scopedFlowSummary: completedSummary() })} />,
    );

    expect(markup).toContain("Download complete");
    expect(markup).toContain("2 periods saved as one ZIP.");
  });

  it("renders the partly-available outcome of a run that finished with a missing artifact", () => {
    const summary = completedSummary({
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "downloaded",
        safeSignals: ["artifact-unavailable:EXCEL"],
        safeMessage: "One selected file was not offered by the portal for this period.",
      },
    });
    const markup = renderToStaticMarkup(
      <PanelSurface pack={controller({ scopedFlowSummary: summary })} />,
    );

    expect(markup).toContain("No filed return found");
    expect(markup).toContain("The GST Portal did not report a filed return for this selection.");
  });

  it("renders a visible message when a panel action fails", () => {
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={controller({
          actionError: "Pack could not reach the background service. Try the action again.",
        })}
      />,
    );

    expect(markup).toContain("Pack could not confirm the download");
    expect(markup).toContain("Pack could not reach the background service. Try the action again.");
  });

  it("renders the portal context state rather than a chooser with no portal", () => {
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={controller({
          context: { connectorId: "gst", pageKind: "unsupported", supported: false },
        })}
      />,
    );

    expect(markup).toContain("Ready when you are");
    expect(markup).toContain("Open GST Portal");
  });

  it("disables a preset the start-action guard blocks, and says which guard", () => {
    // The saved run is for this preset's own scope, but the panel's current scope is not
    // matched to it, so nothing scope-matched can report the guard. Only the raw last run
    // can, which is why the guard reads that and not the scoped summary.
    const interrupted = completedSummary({
      status: "blocked",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-run-needs-review"],
        safeMessage: "A previous run was interrupted. Reset it before starting another.",
      },
    });
    const markup = renderToStaticMarkup(
      <PanelSurface pack={controller({ lastRunSummary: interrupted })} />,
    );

    const button = presetButton(markup, firstPreset.label);
    expect(button).toContain("disabled");
    expect(button).toContain("Reset interrupted run");
  });

  it("keeps an unblocked preset enabled and priced in periods", () => {
    const markup = renderToStaticMarkup(<PanelSurface pack={controller()} />);
    const button = presetButton(markup, firstPreset.label);

    expect(button).not.toContain("disabled");
    expect(button).toContain("periods · one ZIP");
  });
});
