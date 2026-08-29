import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../src/connectors/gst/filed-returns-contracts";
import { supportedFiledReturnsCatalogueEntries } from "../../src/connectors/gst/filed-returns-catalogue";
import { getFiledReturnsFullFiscalYearPeriods } from "../../src/connectors/gst/filed-returns-scope";

vi.mock("wxt/browser", () => ({
  browser: { tabs: { create: vi.fn() } },
}));

import { PanelSurface, type PackPanelController } from "../../src/entrypoints/panel/panel-surface";
import { PanelGuidedScope } from "../../src/entrypoints/panel/panel-guided-scope";
import { panelFullFiscalYearPresets } from "../../src/entrypoints/panel/panel-guided-scope-model";
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
        startFiledReturnsFlow: async (requestedScope) => onStart(requestedScope ?? scope),
        ...overrides,
      })}
    />
  );
}

function GuidedScopeHarness({
  onStart = () => undefined,
  portalSignedIn,
  savedRun,
  scopeLockedForReview = false,
}: {
  onStart?: (scope: FiledReturnsDownloadScope) => void;
  portalSignedIn: boolean;
  savedRun: FiledReturnsFlowSummary | null;
  scopeLockedForReview?: boolean;
}) {
  const [scope, setScope] = React.useState<FiledReturnsDownloadScope>(PANEL_TEST_SCOPE);
  return (
    <PanelGuidedScope
      busy={null}
      context={{ connectorId: "gst", pageKind: "gst-auth-landing", supported: true }}
      externalBlock={null}
      flowSummary={savedRun}
      portalSignedIn={portalSignedIn}
      savedRun={savedRun}
      scope={scope}
      scopeLockedForReview={scopeLockedForReview}
      onScopeChange={setScope}
      onStart={onStart}
    />
  );
}

function LiveRunHarness({ onMount }: { onMount: () => void }) {
  const [summary, setSummary] = React.useState<FiledReturnsFlowSummary>(() =>
    completedPanelSummary({
      status: "running",
      completedPeriods: [],
      totalPeriods: 2,
      targetEvidence: [
        { period: "April", outcome: "running" },
        { period: "May", outcome: "pending" },
      ],
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "clicked",
        safeSignals: ["full-fiscal-year-run-active"],
        safeMessage: "Pack is processing the planned periods.",
      },
    }),
  );
  React.useEffect(() => {
    onMount();
  }, [onMount]);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setSummary((current) => ({
            ...current,
            completedPeriods: ["April"],
            targetEvidence: [
              { period: "April", outcome: "saved" },
              { period: "May", outcome: "running" },
            ],
          }))
        }
      >
        Advance synthetic run
      </button>
      <PanelSurface pack={panelController({ scope: summary.scope, scopedFlowSummary: summary })} />
    </>
  );
}

async function mount(
  props: React.ComponentProps<typeof Harness> = {},
  strict = false,
  openGuide = true,
) {
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
  if (openGuide) await clickButtonContaining("Choose return, year and period");
}

async function mountGuidedScope(props: React.ComponentProps<typeof GuidedScopeHarness>) {
  root = createRoot(container);
  await act(async () => {
    root?.render(<GuidedScopeHarness {...props} />);
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

async function clickButtonContaining(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  expect(button, `no button containing ${text}`).toBeDefined();
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
    vi.stubEnv("MODE", "alpha");
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
    vi.unstubAllEnvs();
  });

  it("does not offer an unavailable full-year resume in a packaged build", async () => {
    vi.stubEnv("MODE", "production");
    await mountGuidedScope({
      portalSignedIn: true,
      savedRun: completedPanelSummary({
        status: "blocked",
        currentPeriod: "April",
        flowStep: {
          connectorId: "gst",
          scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
          state: "blocked",
          safeSignals: [],
          safeMessage: "Synthetic saved full-year run.",
        },
      }),
      scopeLockedForReview: true,
    });
    await clickButtonContaining("Choose return, year and period");

    expect(container.textContent).toContain("Cancel it before starting another scope.");
    expect(container.textContent).not.toContain("Resume or discard it");
  });

  it.each([false, true])("preserves existing focus on mount (StrictMode: %s)", async (strict) => {
    const previousControl = dom.window.document.createElement("button");
    previousControl.textContent = "Existing focus";
    dom.window.document.body.append(previousControl);
    previousControl.focus();

    await mount({}, strict, false);

    expect(dom.window.document.activeElement).toBe(previousControl);
    await clickButtonContaining("Choose return, year and period");
    expect(dom.window.document.activeElement).toBe(container.querySelector(".panel-guide select"));
    await clickButton("Continue");
    expect(dom.window.document.activeElement).toBe(container.querySelector(".panel-guide select"));
    await clickButton("Back");
    expect(dom.window.document.activeElement).toBe(container.querySelector(".panel-guide select"));
  });

  it("never exceeds four controls while advancing and focuses the active field", async () => {
    await mount();
    expect(guideControlCount()).toBe(4);

    for (let step = 2; step <= 4; step += 1) {
      await clickButton("Continue");
      expect(container.textContent).toContain(`Step ${step} of 4`);
      expect(guideControlCount()).toBe(4);
      expect(dom.window.document.activeElement).toBe(
        container.querySelector(".panel-guide select"),
      );
    }
  });

  it("renders catalogue-derived presets and the custom-scope door before the guided flow", async () => {
    await mount({}, false, false);

    expect(container.textContent).toContain("This year's GSTR-3B");
    expect(container.textContent).toContain("This year's GSTR-2B");
    expect(container.textContent).toContain("This year's GSTR-1");
    expect(container.textContent).toContain("Choose return, year and period");
    expect(container.textContent).not.toContain("Catalogue & limits");
    expect(container.textContent).not.toContain("Step 1 of 4");

    await clickButtonContaining("Choose return, year and period");
    expect(container.innerHTML).toContain("data-pack-alpha-surface");
  });

  it("gives every disabled preset a resolvable reason", async () => {
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
    await mount({ overrides: { lastRunSummary: retained, scopedFlowSummary: null } }, false, false);

    const presets = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".panel-preset-list button"),
    );
    expect(presets.length).toBeGreaterThan(0);
    for (const preset of presets) {
      expect(preset.disabled).toBe(true);
      const reasonId = preset.getAttribute("aria-describedby");
      expect(reasonId).not.toBeNull();
      const reason = reasonId ? dom.window.document.getElementById(reasonId) : null;
      expect(reason).not.toBeNull();
      expect(reason?.textContent?.trim()).not.toBe("");
    }
  });

  it("renders the sign-in recovery state instead of preset controls on the authentication landing page", async () => {
    await mount(
      {
        overrides: {
          context: { connectorId: "gst", pageKind: "gst-auth-landing", supported: true },
        },
      },
      false,
      false,
    );

    expect(container.querySelectorAll(".panel-preset-list button")).toHaveLength(0);
    expect(container.textContent).toContain("Sign in on GST Portal");
    expect(container.textContent).toContain("Sign in directly on the GST Portal.");
    expect(container.querySelector<HTMLButtonElement>(".context-state-action")?.textContent).toBe(
      "Open GST Portal sign-in",
    );
  });

  it("keeps the final guided action disabled until the portal is signed in", async () => {
    const onStart = vi.fn();
    await mountGuidedScope({
      onStart,
      portalSignedIn: false,
      savedRun: completedPanelSummary(),
    });

    await clickButtonContaining("Choose return, year and period");
    await clickButton("Continue");
    await clickButton("Continue");
    await clickButton("Continue");

    const action = container.querySelector<HTMLButtonElement>(".popup-action-area .primary-action");
    expect(action).not.toBeNull();
    expect(action?.disabled).toBe(true);
    expect(container.textContent).toContain("Open a signed-in GST Portal tab to continue.");
    await act(async () => action?.dispatchEvent(realmEvent("click")));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("does not enable a different preset while its saved run needs recovery", async () => {
    const onStart = vi.fn();
    const retained = completedPanelSummary({
      status: "blocked",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-run-needs-review"],
        safeMessage: "A saved run needs review.",
      },
    });
    await mount(
      { onStart, overrides: { lastRunSummary: retained, scopedFlowSummary: retained } },
      false,
      false,
    );

    const otherPreset = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".panel-preset"),
    ).find((preset) => preset.textContent?.includes("GSTR-2B"));
    expect(otherPreset).toBeDefined();
    expect(otherPreset?.disabled).toBe(true);
    await act(async () => otherPreset?.dispatchEvent(realmEvent("click")));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("advertises the same planned period count that a preset starts", async () => {
    const started: FiledReturnsDownloadScope[] = [];
    await mount({ onStart: (scope) => started.push(scope) }, false, false);
    const preset = Array.from(container.querySelectorAll(".panel-preset")).find((candidate) =>
      candidate.textContent?.includes("This year's GSTR-3B"),
    );
    const advertised = Number(
      /\d+/.exec(preset?.querySelector(".panel-preset-count")?.textContent ?? "")?.[0],
    );
    await act(async () => {
      preset?.dispatchEvent(realmEvent("click"));
      await Promise.resolve();
    });

    expect(started).toHaveLength(1);
    expect(getFiledReturnsFullFiscalYearPeriods(started[0]!.financialYear).length).toBe(advertised);
  });

  it("refreshes a preset instead of starting a plan whose eligibility changed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    const onStart = vi.fn();
    await mount({ onStart }, false, false);
    const preset = Array.from(container.querySelectorAll<HTMLButtonElement>(".panel-preset")).find(
      (candidate) => candidate.textContent?.includes("This year's GSTR-3B"),
    );
    expect(preset).toBeDefined();

    vi.setSystemTime(new Date("2027-02-26T00:00:00.000Z"));
    await act(async () => preset?.dispatchEvent(realmEvent("click")));

    expect(onStart).not.toHaveBeenCalled();
  });

  it("refreshes a stale preset instead of starting the prior fiscal year after rollover", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-31T18:29:00.000Z"));
    const onStart = vi.fn();
    await mount({ onStart }, false, false);
    const preset = Array.from(container.querySelectorAll<HTMLButtonElement>(".panel-preset")).find(
      (candidate) => candidate.textContent?.includes("This year's GSTR-3B"),
    );
    expect(preset).toBeDefined();

    vi.setSystemTime(new Date("2027-03-31T18:31:00.000Z"));
    await act(async () => preset?.dispatchEvent(realmEvent("click")));

    expect(onStart).not.toHaveBeenCalled();
  });

  it("refreshes empty presets when a long-lived panel gains its first eligible period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T06:00:00.000Z"));
    await mountGuidedScope({ portalSignedIn: true, savedRun: null });
    expect(container.querySelectorAll(".panel-preset-list button")).toHaveLength(0);

    vi.setSystemTime(new Date("2026-05-31T06:00:00.000Z"));
    await act(async () => {
      root?.render(<GuidedScopeHarness portalSignedIn savedRun={null} />);
      await Promise.resolve();
    });

    expect(container.querySelectorAll(".panel-preset-list button").length).toBeGreaterThan(0);
  });

  it("derives preset period counts from the fiscal-year planner as time changes", () => {
    const financialYear = "2026-27";
    const beforeMorePeriodsAreEligible = new Date("2026-08-26T00:00:00.000Z");
    const afterMorePeriodsAreEligible = new Date("2027-02-26T00:00:00.000Z");
    const before = panelFullFiscalYearPresets(financialYear, beforeMorePeriodsAreEligible);
    const after = panelFullFiscalYearPresets(financialYear, afterMorePeriodsAreEligible);

    expect(before.map((preset) => preset.periodCount)).toEqual(
      before.map(
        (preset) =>
          getFiledReturnsFullFiscalYearPeriods(
            preset.scope.financialYear,
            beforeMorePeriodsAreEligible,
          ).length,
      ),
    );
    expect(after.map((preset) => preset.periodCount)).toEqual(
      after.map(
        (preset) =>
          getFiledReturnsFullFiscalYearPeriods(
            preset.scope.financialYear,
            afterMorePeriodsAreEligible,
          ).length,
      ),
    );
    expect(after.map((preset) => preset.periodCount)).not.toEqual(
      before.map((preset) => preset.periodCount),
    );
  });

  it("adds a preset when catalogue data gains a supported full-year row", () => {
    const catalogue = supportedFiledReturnsCatalogueEntries();
    const addedRow = catalogue[0]!;
    const label = `${addedRow.capability.label} catalogue addition`;
    const presets = panelFullFiscalYearPresets("2026-27", new Date("2026-08-26T00:00:00.000Z"), [
      ...catalogue,
      { ...addedRow, capability: { ...addedRow.capability, label } },
    ]);

    expect(presets.some((preset) => preset.label === `This year's ${label}`)).toBe(true);
  });

  it("re-renders period rows and plan progress when the run state advances", async () => {
    let mounts = 0;
    root = createRoot(container);
    await act(async () => {
      root?.render(<LiveRunHarness onMount={() => (mounts += 1)} />);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("0 of 2 saved");
    expect(container.textContent).toContain("AprilIn progress");

    await clickButton("Advance synthetic run");

    expect(mounts).toBe(1);
    expect(container.textContent).toContain("1 of 2 saved");
    expect(container.textContent).toContain("AprilSaved");
    expect(container.textContent).toContain("MayIn progress");
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

  it("returns focus to the custom-scope door when leaving the guided flow", async () => {
    await mount();
    expect(dom.window.document.activeElement).toBe(container.querySelector(".panel-guide select"));

    await clickButton("Back to presets");

    const customScopeDoor = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Choose return, year and period"));
    expect(dom.window.document.activeElement).toBe(customScopeDoor);
  });

  it("places named recovery controls before blocked scope selection", async () => {
    const interrupted = completedPanelSummary({
      status: "blocked",
      flowStep: {
        connectorId: "gst",
        scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
        state: "user-action-required",
        safeSignals: ["filed-returns-run-needs-review"],
        safeMessage: "A previous run was interrupted. Reset it before starting another.",
      },
    });
    await mount(
      { overrides: { lastRunSummary: interrupted, scopedFlowSummary: interrupted } },
      false,
      false,
    );

    const recovery = container.querySelector(".recovery-details");
    const presets = container.querySelector(".panel-presets");
    expect(recovery?.querySelector("summary")?.textContent).toBe("Recovery options");
    expect(recovery).not.toBeNull();
    expect(presets).not.toBeNull();
    if (!recovery || !presets) throw new Error("Expected recovery and presets to render.");
    const following = (dom.window as unknown as { Node: { DOCUMENT_POSITION_FOLLOWING: number } })
      .Node.DOCUMENT_POSITION_FOLLOWING;
    expect(recovery.compareDocumentPosition(presets) & following).toBe(following);
  });

  it("binds every field to the announced step label and hint", async () => {
    const expectedSteps = [
      ["Return", "Choose one supported return for this run."],
      ["Financial year", "Pack keeps each run within one financial year."],
      [
        "Filed period",
        "Choose one of: Full fiscal year, April, May, June, July, August, September, October, November, December, January, February, March.",
      ],
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
      expect(dom.window.document.activeElement).toBe(field);

      if (index < expectedSteps.length - 1) await clickButton("Continue");
    }
  });

  it("returns to the preceding field without creating another scope", async () => {
    await mount();
    await clickButton("Continue");
    await clickButton("Back");

    expect(container.textContent).toContain("Step 1 of 4");
    expect(container.querySelectorAll(".panel-guide-scope")).toHaveLength(1);
    expect(guideControlCount()).toBe(4);
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
    ).toEqual(["Available 3", "Not available in Pack 5"]);
    expect(
      Array.from(
        container.querySelectorAll(".panel-catalogue ul"),
        (list) => list.querySelectorAll(":scope > li").length,
      ),
    ).toEqual([3, 5]);
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
    expect(finalAction?.getAttribute("aria-describedby")).toBe("scope-action-reason");
    const reason = dom.window.document.getElementById("scope-action-reason");
    expect(reason).not.toBeNull();
    expect(reason?.textContent?.trim()).not.toBe("");
    await act(async () => finalAction?.dispatchEvent(realmEvent("click")));
    expect(onStart).not.toHaveBeenCalled();
  });
});
