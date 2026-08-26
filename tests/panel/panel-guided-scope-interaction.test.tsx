import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../src/connectors/gst/filed-returns-contracts";
import { supportedFiledReturnsCatalogueEntries } from "../../src/connectors/gst/filed-returns-catalogue";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { PanelSurface, type PackPanelController } from "../../src/entrypoints/panel/panel-surface";
import {
  PANEL_TEST_SCOPE,
  completedPanelSummary,
  panelController,
} from "./panel-controller.test-helpers";

let dom: JSDOM;
let root: Root | null = null;
let container: Element;

function realmEvent(type: string): Event {
  const { Event: RealmEvent } = dom.window as unknown as {
    Event: new (eventType: string, init?: { bubbles?: boolean }) => Event;
  };
  return new RealmEvent(type, { bubbles: true });
}

function Harness({
  onStart = () => undefined,
  overrides = {},
}: {
  onStart?: (scope: FiledReturnsDownloadScope) => void;
  overrides?: Partial<PackPanelController>;
}) {
  const [scope, setScope] = React.useState<FiledReturnsDownloadScope>(PANEL_TEST_SCOPE);
  return (
    <PanelSurface
      pack={panelController({
        scope,
        setScope,
        startFiledReturnsFlow: async () => onStart(scope),
        ...overrides,
      })}
    />
  );
}

async function mount(props: React.ComponentProps<typeof Harness> = {}, strict = false) {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      strict ? (
        <React.StrictMode>
          <Harness {...props} />
        </React.StrictMode>
      ) : (
        <Harness {...props} />
      ),
    );
    await Promise.resolve();
  });
}

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `no button named ${label}`).toBeDefined();
  await act(async () => {
    button?.dispatchEvent(realmEvent("click"));
    await Promise.resolve();
  });
}

async function choose(value: string) {
  const select = container.querySelector(".panel-guide select") as HTMLSelectElement | null;
  expect(select).not.toBeNull();
  if (!select) return;
  select.value = value;
  await act(async () => {
    select.dispatchEvent(realmEvent("change"));
    await Promise.resolve();
  });
}

function guideControlCount(): number {
  const guide = container.querySelector(".panel-guide");
  return (
    (guide?.querySelectorAll("select").length ?? 0) +
    (guide?.querySelectorAll("button").length ?? 0) +
    (guide?.querySelectorAll("summary").length ?? 0)
  );
}

describe("panel guided scope interaction", () => {
  beforeEach(() => {
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

  it.each([false, true])("preserves existing focus on mount (StrictMode: %s)", async (strict) => {
    const previousControl = dom.window.document.createElement("button");
    previousControl.textContent = "Existing focus";
    dom.window.document.body.append(previousControl);
    previousControl.focus();

    await mount({}, strict);

    expect(dom.window.document.activeElement).toBe(previousControl);
    await clickButton("Continue");
    expect(dom.window.document.activeElement).toBe(container.querySelector(".panel-guide select"));
    await clickButton("Back");
    expect(dom.window.document.activeElement).toBe(container.querySelector(".panel-guide select"));
  });

  it("never exceeds four controls while advancing and focuses the active field", async () => {
    await mount();
    expect(guideControlCount()).toBe(3);

    for (let step = 2; step <= 4; step += 1) {
      await clickButton("Continue");
      expect(container.textContent).toContain(`Step ${step} of 4`);
      expect(guideControlCount()).toBe(4);
      expect(dom.window.document.activeElement).toBe(
        container.querySelector(".panel-guide select"),
      );
    }
  });

  it("moves focus to a newly mounted field when the announced step changes", async () => {
    await mount();
    const firstField = container.querySelector(".panel-guide select");
    let focusEvents = 0;
    container.addEventListener("focusin", () => {
      focusEvents += 1;
    });

    await clickButton("Continue");

    const secondField = container.querySelector(".panel-guide select");
    expect(secondField).not.toBe(firstField);
    expect(dom.window.document.activeElement).toBe(secondField);
    expect(focusEvents).toBe(1);
  });

  it("binds every field to the announced step label and hint", async () => {
    const expectedSteps = [
      ["Return", "Choose one supported return for this run."],
      ["Financial year", "Pack keeps each run within one financial year."],
      ["Filed period", "Choose one month or the full fiscal year."],
      ["File", "Choose one artifact selection offered for this return."],
    ] as const;
    await mount();

    for (const [index, [label, hint]] of expectedSteps.entries()) {
      const progress = container.querySelector(".panel-guide-progress");
      const field = container.querySelector(".panel-guide select") as HTMLSelectElement | null;
      const fieldLabel = container.querySelector(".panel-guide-select");
      const hintElement = container.querySelector("#panel-guide-hint");

      expect(progress?.getAttribute("role")).toBe("status");
      expect(progress?.getAttribute("aria-live")).toBe("polite");
      expect(progress?.getAttribute("aria-atomic")).toBe("true");
      expect(progress?.getAttribute("aria-label")).toBe(`Step ${index + 1} of 4`);
      expect(fieldLabel?.textContent).toContain(label);
      expect(fieldLabel?.getAttribute("for")).toBe(field?.id);
      expect(field?.getAttribute("aria-describedby")).toBe(hintElement?.id);
      expect(hintElement?.textContent).toBe(hint);
      expect(dom.window.document.activeElement).toBe(
        index === 0 ? dom.window.document.body : field,
      );

      if (index < expectedSteps.length - 1) await clickButton("Continue");
    }
  });

  it("returns to the preceding field without creating another scope", async () => {
    await mount();
    await clickButton("Continue");
    await clickButton("Back");

    expect(container.textContent).toContain("Step 1 of 4");
    expect(container.querySelectorAll(".panel-guide-scope")).toHaveLength(1);
    expect(guideControlCount()).toBe(3);
    expect(dom.window.document.activeElement).toBe(container.querySelector(".panel-guide select"));
  });

  it("reconciles artifact availability when the return changes", async () => {
    await mount();
    await choose("GSTR-1");

    const scope = container.querySelector(".panel-guide-scope")?.textContent ?? "";
    expect(scope).toContain("GSTR-1");
    expect(scope).toContain("Summary (PDF)");
    expect(scope).not.toContain("Portal data (JSON)");
  });

  it("starts exactly the one visible FY, period, return and artifact", async () => {
    const started: FiledReturnsDownloadScope[] = [];
    await mount({ onStart: (scope) => started.push(scope) });

    await choose("GSTR-1");
    await clickButton("Continue");
    await choose("2024-25");
    await clickButton("Continue");
    await choose("April");
    await clickButton("Continue");
    await choose("EXCEL");
    await clickButton("Download April 2024-25 E-invoice details (Excel)");

    expect(started).toEqual([
      {
        financialYear: "2024-25",
        period: "April",
        returnType: "GSTR-1",
        artifactType: "EXCEL",
      },
    ]);
  });

  it("keeps all unsupported declarations out of every interactive option", async () => {
    await mount();
    const optionValues = Array.from(container.querySelectorAll("option"), (option) => option.value);

    expect(optionValues).toEqual(
      supportedFiledReturnsCatalogueEntries().map((entry) => entry.returnType),
    );
    expect(
      Array.from(container.querySelectorAll(".panel-catalogue h3"), (heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(["Available 3", "Not available in Pack 6"]);
    expect(
      Array.from(
        container.querySelectorAll(".panel-catalogue ul"),
        (list) => list.querySelectorAll(":scope > li").length,
      ),
    ).toEqual([3, 6]);
    expect(
      container.querySelectorAll(".panel-catalogue button, .panel-catalogue select"),
    ).toHaveLength(0);
  });

  it("carries a scope-matched review refusal into the final action", async () => {
    const interrupted: FiledReturnsFlowSummary = completedPanelSummary({
      status: "blocked",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-run-needs-review"],
        safeMessage: "A previous run was interrupted. Reset it before starting another.",
      },
    });
    await mount({ overrides: { lastRunSummary: interrupted, scopedFlowSummary: interrupted } });
    await clickButton("Continue");
    await clickButton("Continue");
    await clickButton("Continue");

    const action = Array.from(container.querySelectorAll(".panel-guide button")).find((button) =>
      button.textContent?.includes("Reset interrupted run"),
    );
    expect(action).toBeDefined();
    expect((action as HTMLButtonElement | undefined)?.disabled).toBe(true);
  });

  it("refuses the guided final action while a different scope has retained recovery", async () => {
    const onStart = vi.fn();
    const retained = completedPanelSummary({
      scope: { ...PANEL_TEST_SCOPE, financialYear: "2024-25" },
      status: "blocked",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "blocked",
        safeSignals: ["full-fiscal-year-opfs-retained", "full-fiscal-year-run-needs-action"],
        safeMessage: "A different saved plan needs recovery.",
      },
    });
    await mount({ onStart, overrides: { lastRunSummary: retained, scopedFlowSummary: null } });
    await clickButton("Continue");
    await clickButton("Continue");
    await clickButton("Continue");
    const finalAction = container.querySelector<HTMLButtonElement>(".panel-guide .primary-action");
    expect(finalAction).not.toBeNull();
    expect(finalAction?.disabled).toBe(true);
    await act(async () => finalAction?.dispatchEvent(realmEvent("click")));
    expect(onStart).not.toHaveBeenCalled();
  });
});
