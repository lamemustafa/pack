import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeriodMatrixRunnable } from "../../src/entrypoints/panel/panel-period-matrix-model";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { PanelPeriodMatrix } from "../../src/entrypoints/panel/panel-period-matrix";

const ASOF = new Date("2026-08-28T00:00:00.000Z");

let dom: JSDOM;
let root: Root | null = null;
let container: Element;
let started: PeriodMatrixRunnable[] = [];

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <PanelPeriodMatrix
        artifactType="PDF_AND_EXCEL"
        asOf={ASOF}
        busy={null}
        disabled={false}
        financialYear="2025-26"
        financialYearOptions={["2026-27", "2025-26"]}
        onFinancialYearChange={() => undefined}
        onStart={(resolution) => started.push(resolution)}
      />,
    );
    await Promise.resolve();
  });
}

function cell(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`no cell ${label}`);
  return found as HTMLButtonElement;
}

/**
 * jsdom's window is typed as the DOM `Window`, which does not declare the event constructors
 * as properties. The events must come from this realm for dispatchEvent to accept them, so
 * they are read through one narrow accessor rather than cast at each call site.
 */
function realmMouseEvent(type: string, init: MouseEventInit): Event {
  const { MouseEvent: RealmMouseEvent } = dom.window as unknown as {
    MouseEvent: new (type: string, init: MouseEventInit) => Event;
  };
  return new RealmMouseEvent(type, init);
}

async function click(button: HTMLElement, init: MouseEventInit = {}) {
  await act(async () => {
    button.dispatchEvent(realmMouseEvent("pointerdown", { bubbles: true, ...init }));
    button.dispatchEvent(realmMouseEvent("click", { bubbles: true, ...init }));
    await Promise.resolve();
  });
}

describe("the period grid", () => {
  beforeEach(() => {
    started = [];
    dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "https://x.test" });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.getElementById("root") as Element;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
  });

  it("keeps screen-reader wording out of the visible grid", async () => {
    // A row label once carried its purpose in a `visually-hidden` span -- a class this
    // codebase does not define -- so the sentence rendered as visible text and squeezed the
    // months into a sliver. Assert on what is drawn, since that is what broke.
    await mount();

    const rowLabels = [...container.querySelectorAll(".panel-matrix-row-label")];
    expect(rowLabels.map((label) => label.textContent)).toEqual(["3B", "1", "2B"]);
    expect(container.textContent).not.toContain("select every eligible period");

    const headings = [...container.querySelectorAll("th[scope='col']")];
    for (const heading of headings) {
      expect((heading.textContent ?? "").length).toBeLessThanOrEqual(3);
    }
  });

  it("starts a single-period run from one cell", async () => {
    await mount();
    await click(cell("GSTR-1 June 2025-26"));

    expect(container.textContent).toContain("1 period selected");

    const go = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Download"),
    ) as HTMLButtonElement;
    await click(go);

    expect(started).toEqual([
      {
        runnable: true,
        kind: "scope",
        periodCount: 1,
        scope: {
          financialYear: "2025-26",
          returnType: "GSTR-1",
          artifactType: "PDF_AND_EXCEL",
          period: "June",
        },
      },
    ]);
  });

  it("starts a multi-period run from a range beginning at the first month", async () => {
    await mount();
    await click(cell("GSTR-1 April 2025-26"));
    await click(cell("GSTR-1 June 2025-26"), { shiftKey: true });

    expect(container.textContent).toContain("3 periods selected");

    const go = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("3 periods as one ZIP"),
    ) as HTMLButtonElement;
    await click(go);

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ runnable: true, kind: "selection", periodCount: 3 });
    expect(started[0]?.kind === "selection" && started[0].request.targets).toEqual([
      { returnType: "GSTR-1", period: "April", artifactType: "PDF_AND_EXCEL" },
      { returnType: "GSTR-1", period: "May", artifactType: "PDF_AND_EXCEL" },
      { returnType: "GSTR-1", period: "June", artifactType: "PDF_AND_EXCEL" },
    ]);
  });

  it("runs a range that starts after the first month of the year", async () => {
    // This was refused while completion authority was the canonical year. A selected run is
    // judged against its own recorded plan, so a mid-year range is an ordinary selection.
    await mount();
    await click(cell("GSTR-1 June 2025-26"));
    await click(cell("GSTR-1 August 2025-26"), { shiftKey: true });

    expect(container.textContent).toContain("3 periods selected");

    const go = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("as one ZIP"),
    ) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    await click(go);

    expect(
      started[0]?.kind === "selection" && started[0].request.targets.map((t) => t.period),
    ).toEqual(["June", "July", "August"]);
  });

  it("takes a whole year from the return name", async () => {
    await mount();
    const rowLabel = [...container.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.includes("every eligible period of GSTR-2B"),
    ) as HTMLButtonElement;
    await click(rowLabel);

    expect(container.textContent).toMatch(/\d+ periods selected/);

    const go = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("as one ZIP"),
    ) as HTMLButtonElement;
    await click(go);

    expect(started[0]?.kind).toBe("selection");
    expect(
      started[0]?.kind === "selection" &&
        started[0].request.targets.every((t) => t.returnType === "GSTR-2B"),
    ).toBe(true);
  });
});
