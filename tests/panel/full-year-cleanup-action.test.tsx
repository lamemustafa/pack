import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
} from "../../src/connectors/gst/filed-returns-contracts";
import { getScopeMatchedFiledReturnsSummary } from "../../src/entrypoints/popup/flow-summary";
import {
  CLEANUP_ACTION_CASES,
  makeCleanupActionSummary,
  makeContradictoryCleanupSummary,
  makeZipActionSummary,
} from "../popup/full-year-cleanup-fixtures.test-helpers";
import { panelController } from "./panel-controller.test-helpers";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));
import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";

const CHECKING_BODY = "Pack is checking the saved run before retrying local cleanup.";
let dom: JSDOM;
let container: Element;
let root: Root | null = null;

function Harness({
  initial,
  onStart,
  onRecovery,
}: {
  initial: FiledReturnsFlowSummary;
  onStart: (scope: FiledReturnsDownloadScope) => Promise<FiledReturnsFlowSummary>;
  onRecovery: () => Promise<void>;
}) {
  const [summary, setSummary] = React.useState(initial);
  const [scope, setScope] = React.useState(initial.scope);
  const [busy, setBusy] = React.useState<string | null>(null);
  return (
    <PanelSurface
      pack={panelController({
        context: null,
        scope,
        setScope,
        scopedFlowSummary: getScopeMatchedFiledReturnsSummary(scope, summary),
        lastRunSummary: summary,
        effectiveBusy: busy,
        startFiledReturnsFlow: async () => {
          setBusy("start-filed-returns-flow");
          const response = await onStart(scope);
          setSummary(response);
          setBusy(null);
        },
        retryFullFiscalYearTarget: onRecovery,
        retryFiledReturnsTarget: onRecovery,
        startFreshFiledReturnsFlow: onRecovery,
        acknowledgeInterruptedRun: onRecovery,
        resolveFullFiscalYearTarget: onRecovery,
        resolveUnconfirmedDownload: onRecovery,
      })}
    />
  );
}

async function click(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `missing button: ${label}`).toBeDefined();
  if (!button) throw new Error(`Missing expected button: ${label}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

function renderSummary(
  summary: FiledReturnsFlowSummary | null,
  busy: string | null,
  supported = false,
) {
  return renderToStaticMarkup(
    <PanelSurface
      pack={panelController({
        context: {
          connectorId: "gst",
          pageKind: supported ? "gst-filed-returns" : "unsupported",
          supported,
        },
        ...(summary ? { scope: summary.scope } : {}),
        scopedFlowSummary: summary,
        lastRunSummary: summary,
        effectiveBusy: busy,
      })}
    />,
  );
}

describe("whole-panel cleanup action", () => {
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
    dom.window.close();
  });

  it.each(CLEANUP_ACTION_CASES)(
    "routes $name through the existing Start callback once",
    async (testCase) => {
      const summary = makeCleanupActionSummary(testCase);
      let finish!: (response: FiledReturnsFlowSummary) => void;
      const response = new Promise<FiledReturnsFlowSummary>((resolve) => {
        finish = resolve;
      });
      const onStart = vi.fn(() => response);
      const onRecovery = vi.fn(async () => undefined);
      root = createRoot(container);
      await act(async () => {
        root?.render(<Harness initial={summary} onStart={onStart} onRecovery={onRecovery} />);
      });
      for (let step = 0; step < 3; step += 1) await click("Continue");
      const action = container.querySelector<HTMLButtonElement>(".primary-action");
      expect(action?.textContent).toBe("Retry local cleanup");
      expect(action?.disabled).toBe(false);
      expect(container.querySelector(".run-action-copy")?.textContent).toBe(
        "Retry cleanup for this saved run.",
      );
      expect(container.querySelector(".panel-source")?.textContent).toBe(
        "Saved run · local cleanup",
      );
      expect(onStart).not.toHaveBeenCalled();
      expect(onRecovery).not.toHaveBeenCalled();
      const evidence = container.querySelector(".evidence")?.innerHTML ?? null;

      await click("Retry local cleanup");

      expect(onStart).toHaveBeenCalledExactlyOnceWith(summary.scope);
      expect(container.querySelector(".inline-status")?.getAttribute("aria-label")).toBe(
        "Checking saved run",
      );
      expect(container.querySelector(".inline-status p")?.textContent).toBe(CHECKING_BODY);
      expect(container.querySelector(".run-progress")).toBeNull();
      expect(dom.window.document.activeElement).toBe(container.querySelector(".inline-status"));
      expect(container.querySelector(".panel-guide")).toBeNull();
      expect(container.querySelector(".pack-summary-meta")?.textContent).toBe(testCase.delivery);
      expect(container.querySelector(".evidence")?.innerHTML ?? null).toBe(evidence);
      expect(onRecovery).not.toHaveBeenCalled();

      // Model a blocked response; this test does not claim cleanup has succeeded.
      await act(async () => {
        finish(summary);
        await response;
      });
      expect(container.querySelector(".inline-status")?.getAttribute("aria-label")).toBe(
        "Saved run needs attention",
      );
      expect(container.querySelector(".panel-guide")).not.toBeNull();
      expect(container.querySelector(".pack-summary-meta")?.textContent).toBe(testCase.delivery);
      expect(onStart).toHaveBeenCalledExactlyOnceWith(summary.scope);
      expect(onRecovery).not.toHaveBeenCalled();
    },
  );

  it.each(CLEANUP_ACTION_CASES)(
    "renders pending $name without invented cleanup progress",
    (testCase) => {
      const markup = renderSummary(makeCleanupActionSummary(testCase), "start-filed-returns-flow");
      expect(markup).toContain('aria-label="Checking saved run"');
      expect(markup).toContain(CHECKING_BODY);
      expect(markup).not.toContain('class="run-progress"');
      expect(markup).not.toContain('class="panel-guide"');
      expect(markup).not.toContain("Packing your files");
      expect(markup).not.toContain("Waiting for Chrome");
      expect(markup).not.toContain("Keep the GST Portal tab open");
      expect(markup).toContain(testCase.delivery);
    },
  );

  it.each([null, "start-filed-returns-flow"])(
    "does not autofocus cleanup status on initial mount (%s)",
    async (busy) => {
      const previous = dom.window.document.createElement("button");
      previous.textContent = "Existing focus";
      dom.window.document.body.append(previous);
      previous.focus();
      const summary = makeCleanupActionSummary();
      root = createRoot(container);
      await act(async () => {
        root?.render(
          <PanelSurface
            pack={panelController({
              scope: summary.scope,
              scopedFlowSummary: summary,
              lastRunSummary: summary,
              effectiveBusy: busy,
            })}
          />,
        );
      });
      expect(dom.window.document.activeElement).toBe(previous);
    },
  );

  it("keeps ordinary pending-download copy unchanged", () => {
    const markup = renderSummary(null, "start-filed-returns-flow", true);
    expect(markup).toContain('aria-label="Packing your files"');
    expect(markup).toContain("Keep the GST Portal tab open while Pack prepares the files.");
    expect(markup).not.toContain("Checking saved run");
  });

  it.each(["export-pending", "export-retry-pending"] as const)(
    "keeps %s pending progress and copy",
    (phase) => {
      const markup = renderSummary(makeZipActionSummary(phase), "start-filed-returns-flow");
      expect(markup).toContain('aria-label="Packing your files"');
      expect(markup).toContain("Keep the GST Portal tab open while Pack prepares the files.");
      expect(markup).toContain('class="run-progress"');
      expect(markup).toContain('aria-label="12 of 12 periods complete"');
      expect(markup).not.toContain("Checking saved run");
    },
  );

  it.each([
    ["download-started", "Check Browser Downloads"],
    ["download-intent-persisted", "Check Browser Downloads"],
    ["download-observing", "Check final ZIP status"],
  ] as const)("keeps %s warning precedence over an added cleanup marker", (phase, heading) => {
    const summary = makeZipActionSummary(phase);
    summary.flowStep.safeSignals.push("full-fiscal-year-local-cleanup-retry");
    expect(renderSummary(summary, null)).toContain(`aria-label="${heading}"`);
    const pending = renderSummary(summary, "start-filed-returns-flow");
    expect(pending).toContain('aria-label="Packing your files"');
    expect(pending).not.toContain(CHECKING_BODY);
    expect(pending).toContain('class="run-progress"');
  });

  it("does not announce cleanup for an unrelated busy action", () => {
    const markup = renderSummary(makeCleanupActionSummary(), "retry-filed-returns-target");
    expect(markup).toContain('aria-label="Saved run needs attention"');
    expect(markup).not.toContain("Checking saved run");
    expect(markup).not.toContain(CHECKING_BODY);
  });

  it("does not borrow busy cleanup copy from a different selected scope", () => {
    const summary = makeCleanupActionSummary();
    const scope = { ...summary.scope, financialYear: "2024-25" };
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={panelController({
          scope,
          scopedFlowSummary: getScopeMatchedFiledReturnsSummary(scope, summary),
          lastRunSummary: summary,
          effectiveBusy: "start-filed-returns-flow",
        })}
      />,
    );
    expect(markup).toContain('aria-label="Packing your files"');
    expect(markup).not.toContain("Checking saved run");
    expect(markup).not.toContain(CHECKING_BODY);
  });

  it.each(["current period", "target recovery", "both"] as const)(
    "does not turn contradictory %s props into busy cleanup",
    (contradiction) => {
      const markup = renderSummary(
        makeContradictoryCleanupSummary(contradiction),
        "start-filed-returns-flow",
      );
      expect(markup).toContain('aria-label="Packing your files"');
      expect(markup).toContain('class="run-progress"');
      expect(markup).not.toContain(CHECKING_BODY);
    },
  );
});
