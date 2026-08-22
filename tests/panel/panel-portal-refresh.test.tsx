import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalContext } from "../../src/core/contracts";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { panelController } from "./panel-controller.test-helpers";

const AUTH_LANDING: PortalContext = {
  connectorId: "gst",
  pageKind: "gst-auth-landing",
  supported: true,
};
const SIGNED_IN: PortalContext = {
  connectorId: "gst",
  pageKind: "gst-filed-returns",
  supported: true,
};

let dom: JSDOM;

// jsdom's window is typed as the DOM `Window`, which does not declare the event
// constructors as properties. The event must come from this realm for
// dispatchEvent to accept it, so the constructor is read through one narrow,
// precisely typed accessor rather than casting at each call site.
function realmEvent(win: JSDOM["window"], type: string): Event {
  const { Event: RealmEvent } = win as unknown as { Event: new (type: string) => Event };
  return new RealmEvent(type);
}

let root: Root | null = null;
let container: Element;
let refreshes = 0;

/**
 * Stands in for the mount: the panel is handed a controller whose context only becomes the
 * signed-in one once `refreshPortalContext` is called, so the rendered header is the proof
 * that the panel asked again rather than kept its mount-time answer.
 */
function Harness() {
  const [context, setContext] = React.useState<PortalContext>(AUTH_LANDING);
  const refreshPortalContext = React.useCallback(async () => {
    refreshes += 1;
    setContext(SIGNED_IN);
  }, []);
  return <PanelSurface pack={panelController({ context, refreshPortalContext })} />;
}

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness />);
    await Promise.resolve();
  });
}

describe("panel portal-context refresh", () => {
  beforeEach(() => {
    refreshes = 0;
    // `pretendToBeVisual` is what gives the document a real `visibilityState`; without it
    // jsdom reports "prerender", which is precisely the state the panel must not refresh in.
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

  it("re-reads the portal context when the panel document regains focus", async () => {
    await mount();
    expect(container.textContent).toContain("Open a signed-in GST Portal tab");

    await act(async () => {
      dom.window.dispatchEvent(realmEvent(dom.window, "focus"));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("GST portal · signed in");
  });

  it("re-reads the portal context when the panel tab becomes visible again", async () => {
    await mount();
    expect(container.textContent).toContain("Open a signed-in GST Portal tab");

    await act(async () => {
      dom.window.document.dispatchEvent(realmEvent(dom.window, "visibilitychange"));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("GST portal · signed in");
  });

  it("stops listening once the panel is closed", async () => {
    await mount();
    await act(async () => root?.unmount());
    root = null;
    const afterMount = refreshes;

    dom.window.dispatchEvent(realmEvent(dom.window, "focus"));
    dom.window.document.dispatchEvent(realmEvent(dom.window, "visibilitychange"));

    expect(refreshes).toBe(afterMount);
  });
});
