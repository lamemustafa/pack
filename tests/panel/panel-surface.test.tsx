import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PACK_EXTENSION_PERMISSIONS,
  PACK_GST_HOST_PERMISSIONS,
} from "../../src/extension/manifest-policy";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { panelPresets, type PanelPreset } from "../../src/entrypoints/panel/panel-presets";
import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import {
  FIRST_PANEL_PRESET,
  completedPanelSummary,
  panelController,
} from "./panel-controller.test-helpers";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf-8");

const firstPreset = FIRST_PANEL_PRESET;
const controller = panelController;
const completedSummary = completedPanelSummary;

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
  if (button === undefined) throw new Error(`no preset button rendered for ${label}`);
  const [opening = ""] = button.split("</button>");
  return opening;
}

describe("panel surface", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("prices a preset by the format its own scope requests, not every format on offer", () => {
    // The GSTR-1 capability summary reads "Summary PDF + E-invoice details (Excel)". Every
    // preset scope is PDF-only, so a control that borrowed the summary promised a workbook
    // the click never asks the portal for.
    const gstr1 = panelPresets().find((preset) => preset.scope.returnType === "GSTR-1");
    expect(gstr1, "no GSTR-1 preset was produced").toBeDefined();
    const markup = renderToStaticMarkup(<PanelSurface pack={controller()} />);
    const button = presetButton(markup, (gstr1 as PanelPreset).label);

    expect(button).toContain("Summary (PDF)");
    expect(button).not.toContain("Excel");
  });

  it("names the financial year the click will actually download, in April", () => {
    // 10 April 2026 IST: FY 2026-27 has begun and has no completed return period, so
    // `normaliseFiledReturnsScope` answers with 2025-26. A label written from the requested
    // year would still say "this year".
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T09:00:00+05:30"));

    const markup = renderToStaticMarkup(<PanelSurface pack={controller()} />);
    const button = presetButton(markup, "2025-26 GSTR-3B");

    expect(button).toContain("2025-26 GSTR-3B");
    expect(markup).not.toContain("2026-27");
    expect(markup).not.toContain("This year");
  });

  it("does not claim a signed-in portal on the authentication landing page", () => {
    // A fresh auth-landing context is `supported: true` — that is how Pack offers to act on
    // it — so a header reading `supported` alone claimed "signed in" over a body asking the
    // user to sign in.
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={controller({
          context: { connectorId: "gst", pageKind: "gst-auth-landing", supported: true },
        })}
      />,
    );

    expect(markup).toContain("Open a signed-in GST Portal tab");
    expect(markup).not.toContain("GST portal · signed in");
    expect(markup).toContain("Sign in on GST Portal");
  });

  it("disables every preset while a different scope's saved run needs recovery", () => {
    // The saved run is the GSTR-3B full-year scope. `startFiledReturnsDownloadFlow` returns
    // the outstanding review before it reads the requested scope, so the GSTR-1 preset could
    // not start either — it just looked as though it could.
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
    const otherScope = panelPresets().find((preset) => preset.scope.returnType !== "GSTR-3B");
    expect(otherScope, "no preset for a return type other than GSTR-3B").toBeDefined();

    const markup = renderToStaticMarkup(
      <PanelSurface pack={controller({ lastRunSummary: interrupted })} />,
    );
    const button = presetButton(markup, (otherScope as PanelPreset).label);

    expect(button).toContain("disabled");
    expect(button).toContain("Reset interrupted run");
  });
});
