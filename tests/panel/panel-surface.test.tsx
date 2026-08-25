import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import {
  PACK_EXTENSION_PERMISSIONS,
  PACK_GST_HOST_PERMISSIONS,
} from "../../src/extension/manifest-policy";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { completedPanelSummary, panelController } from "./panel-controller.test-helpers";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf-8");

const controller = panelController;
const completedSummary = completedPanelSummary;

function activePanelSummary(status: "running" | "partial" | "blocked"): FiledReturnsFlowSummary {
  return {
    ...completedSummary(),
    status,
    completedPeriods: status === "partial" ? ["April"] : [],
    currentPeriod: "May",
    flowStep: {
      connectorId: "gst",
      scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
      state: status === "running" ? "user-action-required" : "blocked",
      safeSignals: status === "running" ? ["filed-returns-run-active"] : [],
      safeMessage: `Synthetic ${status} state.`,
    },
  };
}

describe("panel surface", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the reviewed permission set exactly, with sidePanel and nothing more", () => {
    /**
     * This guard previously asserted that `sidePanel` was ABSENT, so that the
     * permission decision stayed separable from shipping the surface. That
     * decision has been taken and the permission is approved, so the guard is
     * rewritten rather than deleted: it is worth more now than it was before,
     * because a permission set that has just grown is the one most likely to
     * grow again unnoticed.
     *
     * An exact-equality assertion, deliberately. A `toContain` check would let a
     * sixth permission through, and the whole point is that the set is closed.
     */
    expect([...PACK_EXTENSION_PERMISSIONS]).toEqual([
      "downloads",
      "offscreen",
      "scripting",
      "sidePanel",
      "storage",
    ]);
    expect(PACK_GST_HOST_PERMISSIONS).toHaveLength(4);
  });

  it("opens the panel from the action instead of a popup", () => {
    // A `default_popup` takes precedence over the action's click event, so the
    // popup entrypoint's absence is what makes the click reach the side panel.
    // Asserting the manifest declaration alone would pass with a popup still
    // registered, and the click would silently keep opening the old surface.
    const config = read("wxt.config.ts");
    expect(config).toContain("side_panel");
    expect(config).toContain("default_path");
    expect(config).not.toContain("default_popup");
    expect(existsSync(path.join(root, "src/entrypoints/popup/index.html"))).toBe(false);
    expect(read("src/entrypoints/background.ts")).toContain("openPanelOnActionClick");
  });

  it("reuses the popup controller instead of reimplementing the flow", () => {
    const main = read("src/entrypoints/panel/main.tsx");
    expect(main).toContain("usePackPopupController");
    expect(read("src/entrypoints/panel/panel-surface.tsx")).not.toContain(
      "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW",
    );
  });

  it("is what the toolbar action opens, with no popup left to reach it from", () => {
    // Inverted when the popup folded into this surface. It used to assert that
    // the popup offered a way here; the panel is now the surface itself, so the
    // reachability that matters is the manifest's.
    expect(read("wxt.config.ts")).toContain('default_path: "panel.html"');
    expect(existsSync(path.join(root, "src/entrypoints/popup/main.tsx"))).toBe(false);
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

  it.each([
    [
      "downloading",
      activePanelSummary("running"),
      "Packing your files",
      "Keep the GST Portal tab open while Pack prepares the files.",
    ],
    [
      "partial",
      activePanelSummary("partial"),
      "Download partly complete",
      "Synthetic partial state.",
    ],
    [
      "blocked",
      activePanelSummary("blocked"),
      "May needs a quick check",
      "Synthetic blocked state.",
    ],
  ])("renders the %s run family with an honest visible status", (_name, summary, title, body) => {
    const markup = renderToStaticMarkup(
      <PanelSurface pack={controller({ scopedFlowSummary: summary })} />,
    );

    expect(markup).toContain(title);
    expect(markup).toContain(body);
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

  it("renders a checking state while portal context is still empty", () => {
    const markup = renderToStaticMarkup(<PanelSurface pack={controller({ context: null })} />);

    expect(markup).toContain("Checking this tab");
    expect(markup).toContain("Checking for a supported GST Portal page in this browser.");
    expect(markup).not.toContain("Which return?");
  });

  it("renders the guided single-scope chooser from the catalogue", () => {
    const markup = renderToStaticMarkup(<PanelSurface pack={controller()} />);
    expect(markup).toContain("Step 1 of 4");
    expect(markup).toContain("One active scope");
    expect(markup).toContain("2025-26");
    expect(markup).toContain("Full fiscal year");
    expect(markup).toContain("Catalogue &amp; limits");

    const returnSelect = markup.match(/<select[^>]*>(.*?)<\/select>/)?.[1] ?? "";
    expect(returnSelect).toContain("GSTR-3B");
    expect(returnSelect).toContain("GSTR-1");
    expect(returnSelect).toContain("GSTR-2B");
    expect(returnSelect).not.toContain("GSTR-9");
    expect(returnSelect).not.toContain("Ledgers");
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

  it("renders access denial without guessing whether sign-in or authorization caused it", () => {
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={controller({
          context: {
            connectorId: "gst",
            pageKind: "gst-access-denied",
            supported: false,
          },
        })}
      />,
    );

    expect(markup).toContain("GST Portal access blocked");
    expect(markup).toContain("Return to a GST Portal page you can access");
    expect(markup).toContain(">Open GST Portal</button>");
    expect(markup).not.toContain("Sign in on GST Portal");
    expect(markup).not.toContain("signed-in");
    expect(markup).not.toContain("navigate to filed returns");
  });

  it("keeps a cancelled-run confirmation visible above the fresh chooser", () => {
    const cancelledSummary = completedSummary({
      status: "cancelled",
      completedPeriods: [],
      currentPeriod: "May",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: ["filed-returns-target-cancelled"],
        safeMessage: "The saved target was cancelled.",
      },
    });
    const markup = renderToStaticMarkup(
      <PanelSurface pack={controller({ scopedFlowSummary: cancelledSummary })} />,
    );

    expect(markup).toContain("Ready for a new download");
    expect(markup).toContain("The previous recovery state was cleared");
    expect(markup).toContain("Which return?");
  });
});
