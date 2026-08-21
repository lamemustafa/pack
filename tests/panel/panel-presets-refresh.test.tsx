import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { panelController } from "./panel-controller.test-helpers";

// 10 April 2026 IST: FY 2026-27 has begun with no completed return period, so the
// presets normalise to 2025-26. By 10 May the new year has one, and every preset
// answers 2026-27. A panel left open across that boundary is the case this covers.
const BEFORE_BOUNDARY = new Date("2026-04-10T09:00:00+05:30");
const AFTER_BOUNDARY = new Date("2026-05-10T09:00:00+05:30");

let dom: JSDOM;
let root: Root | null = null;
let container: Element;

function realmEvent(win: JSDOM["window"], type: string): Event {
  // The event must come from this realm for dispatchEvent to accept it, and a
  // click needs to bubble to reach React's delegated listener.
  const { Event: RealmEvent } = win as unknown as {
    Event: new (type: string, init?: { bubbles?: boolean }) => Event;
  };
  return new RealmEvent(type, { bubbles: true });
}

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root?.render(<PanelSurface pack={panelController()} />);
    await Promise.resolve();
  });
}

async function returnToPage(dispatch: () => void) {
  await act(async () => {
    dispatch();
    await Promise.resolve();
  });
}

describe("panel preset staleness", () => {
  beforeEach(() => {
    // Only `Date` is faked: faking the timer functions as well would take React's
    // scheduler with them, and this is about what the presets compute against,
    // not about anything scheduled.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BEFORE_BOUNDARY);
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
    vi.useRealTimers();
  });

  it("re-normalises presets against the new financial year when the page regains focus", async () => {
    await mount();
    expect(container.textContent).toContain("2025-26 GSTR-3B");

    vi.setSystemTime(AFTER_BOUNDARY);
    await returnToPage(() => dom.window.dispatchEvent(realmEvent(dom.window, "focus")));

    // The label is read back off the scope the click submits, so a stale basis
    // does not look stale -- it offers the wrong year under a correct-looking
    // name. Asserting the rendered text is the only way that shows.
    expect(container.textContent).toContain("2026-27 GSTR-3B");
    expect(container.textContent).not.toContain("2025-26 GSTR-3B");
  });

  it("re-normalises presets when the panel tab becomes visible again", async () => {
    await mount();
    expect(container.textContent).toContain("2025-26 GSTR-3B");

    vi.setSystemTime(AFTER_BOUNDARY);
    await returnToPage(() =>
      dom.window.document.dispatchEvent(realmEvent(dom.window, "visibilitychange")),
    );

    expect(container.textContent).toContain("2026-27 GSTR-3B");
  });

  it("leaves presets alone when the user returns on the same day", async () => {
    await mount();
    const mounted = container.innerHTML;

    await returnToPage(() => dom.window.dispatchEvent(realmEvent(dom.window, "focus")));

    expect(container.innerHTML).toBe(mounted);
  });

  it("stops recomputing once the panel is closed", async () => {
    await mount();
    expect(container.textContent).toContain("2025-26 GSTR-3B");
    await act(async () => root?.unmount());
    root = null;

    vi.setSystemTime(AFTER_BOUNDARY);
    dom.window.dispatchEvent(realmEvent(dom.window, "focus"));

    expect(container.textContent).not.toContain("2026-27 GSTR-3B");
  });
});

describe("preset scope at click time", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BEFORE_BOUNDARY);
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
    vi.useRealTimers();
  });

  it("submits the year current at the click, not the year rendered at mount", async () => {
    // A panel left as the active tab overnight receives neither focus nor
    // visibilitychange, so it can cross the boundary with April's basis on
    // screen. The label going stale is cosmetic; the submitted scope going
    // stale downloads the wrong year.
    const started: { financialYear: string }[] = [];
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <PanelSurface
          pack={panelController({
            startFiledReturnsFlow: (async (scope?: { financialYear: string }) => {
              if (scope) started.push(scope);
            }) as never,
          })}
        />,
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain("2025-26 GSTR-3B");

    vi.setSystemTime(AFTER_BOUNDARY);
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("2025-26 GSTR-3B"),
    );
    await act(async () => {
      button?.dispatchEvent(realmEvent(dom.window, "click"));
      await Promise.resolve();
    });

    expect(started.map((scope) => scope.financialYear)).toEqual(["2026-27"]);
  });
});
