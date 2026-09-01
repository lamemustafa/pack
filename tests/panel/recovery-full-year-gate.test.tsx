import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { searchStepLimitReachedMessage } from "../../src/background/filed-returns-step-limit";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { canonicalDurableSummaryMessage } from "../../src/connectors/gst/filed-returns-durable-status";
import { makeCompletedRecoveryLedger } from "../background/full-year-completion-fixtures.test-helpers";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));

import { RecoveryActions } from "../../src/entrypoints/popup/recovery-actions";
import { InlineStatus } from "../../src/entrypoints/popup/inline-status";
import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";
import { getPopupPresentationState } from "../../src/entrypoints/popup/presentation-state";
import { getRecoveryFlowAvailability } from "../../src/entrypoints/popup/recovery-flow-availability";
import { renderToStaticMarkup } from "react-dom/server";
import { panelController } from "./panel-controller.test-helpers";

/**
 * A packaged build withholds the full-year surface everywhere it is offered -- but a ledger
 * persisted by an earlier release still reaches recovery, and those controls resume or restart
 * the very flow that was withheld. Gating cannot hide the block outright: that would leave a
 * reader looking at a saved run they cannot dismiss. So the two controls that re-enter the flow
 * are withheld and the local ones stay.
 */

const INTERRUPTED_RUNNING_LEDGER = {
  ...makeCompletedRecoveryLedger("running"),
  status: "running" as const,
};
const SAVED_FULL_YEAR = summariseFullFiscalYearLedger(
  INTERRUPTED_RUNNING_LEDGER,
  new Date("2026-08-29T00:00:00Z"),
);

const PINNED_TAB_SAVED_FULL_YEAR: FiledReturnsFlowSummary = {
  ...SAVED_FULL_YEAR,
  flowStep: {
    ...SAVED_FULL_YEAR.flowStep,
    state: "blocked",
    safeSignals: ["full-fiscal-year-pinned-gst-tab-unavailable"],
    safeMessage: canonicalDurableSummaryMessage(SAVED_FULL_YEAR.scope, "blocked", [
      "full-fiscal-year-pinned-gst-tab-unavailable",
    ]),
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Discard this saved plan before using a different GST Portal tab.",
      canResume: false,
    },
  },
  fullFiscalYearRecovery: {
    ...SAVED_FULL_YEAR.fullFiscalYearRecovery!,
    targetStatus: "blocked",
  },
};

let dom: JSDOM;
let root: Root | null = null;
let container: Element;

async function mount(
  fullYearFlowAvailable: boolean,
  portalReady = true,
  summary: FiledReturnsFlowSummary = SAVED_FULL_YEAR,
) {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <RecoveryActions
        busy={null}
        portalReady={portalReady}
        summary={summary}
        fullYearFlowAvailable={fullYearFlowAvailable}
        onAcknowledgeInterruptedRun={() => undefined}
        onRetryFullFiscalYearTarget={() => undefined}
        onRetryTarget={() => undefined}
        onResolveFullFiscalYearTarget={() => undefined}
        onResolveTarget={() => undefined}
        onStartFresh={() => undefined}
      />,
    );
    await Promise.resolve();
  });
}

function recoveryReaderText(root: ParentNode): string {
  const accessibleNames = [
    ...root.querySelectorAll(
      "[aria-label], [aria-description], [title], [alt], [placeholder], input, option, select, textarea",
    ),
  ]
    .flatMap((element) => [
      element.getAttribute("aria-label"),
      element.getAttribute("aria-description"),
      element.getAttribute("title"),
      element.getAttribute("alt"),
      element.getAttribute("placeholder"),
      (element as HTMLInputElement).value,
    ])
    .filter((value): value is string => Boolean(value));
  return [root.textContent ?? "", ...accessibleNames].join(" ");
}

async function panelRecoveryText(
  summary: FiledReturnsFlowSummary,
  overrides: Partial<ReturnType<typeof panelController>> = {},
): Promise<{ afterExpansion: string; beforeExpansionWarning: string }> {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <PanelSurface
        pack={panelController({
          lastRunSummary: summary,
          recoverySummary: summary,
          scope: summary.scope,
          scopeLockedForReview: true,
          scopedFlowSummary: summary,
          ...overrides,
        })}
      />,
    );
    await Promise.resolve();
  });
  const recovery = container.querySelector("details.recovery-details") as HTMLDetailsElement;
  expect(recovery).not.toBeNull();
  const beforeExpansionWarning =
    container.querySelector(".panel-recovery-reason")?.textContent ?? "";
  await act(async () => {
    recovery.open = true;
    recovery.dispatchEvent(
      new (dom.window as unknown as { Event: typeof Event }).Event("toggle", { bubbles: true }),
    );
    await Promise.resolve();
  });
  return { afterExpansion: recoveryReaderText(container), beforeExpansionWarning };
}

function buttonLabels(): string[] {
  return [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
}

/**
 * This must remain independent of recovery-flow-availability's classifier: it
 * protects against a surface adding a new synonym that the model fails to
 * classify, such as "restart". The one normal wording with "continue" is
 * deliberately a negated capability statement ("cannot continue").
 */
function hasWithheldRecoveryWording(text: string): boolean {
  return (
    /\b(?:retry|retrying|resume|resuming|restart|restarting|try again)\b|\brun(?: this (?:saved )?(?:plan|year))? again\b/i.test(
      text,
    ) ||
    /\bstart (?:another|fresh|selected) download\b|\bstart (?:this year|pack) again\b/i.test(
      text,
    ) ||
    /(?<!cannot )\bcontinue\b/i.test(text)
  );
}

describe("saved full-year recovery in a build that withholds the flow", () => {
  beforeEach(() => {
    dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "https://x.test" });
    Object.assign(globalThis, { document: dom.window.document, window: dom.window });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.getElementById("root") as Element;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    vi.unstubAllEnvs();
  });

  it("offers no way to resume or restart the run", async () => {
    await mount(false);

    const labels = buttonLabels();
    expect(labels.some((label) => label.includes("Discard saved run and start"))).toBe(false);
    expect(labels.some((label) => label.includes("Resume"))).toBe(false);
    expect(labels.some((label) => label.includes("Retry"))).toBe(false);
  });

  it("still lets the reader clear the saved run", async () => {
    // Withholding everything would strand someone with a run they can see and cannot dismiss.
    await mount(false);

    const labels = buttonLabels();
    expect(labels.some((label) => /Cancel|Discard saved run$/.test(label))).toBe(true);
    expect(container.textContent).toContain(
      getRecoveryFlowAvailability(SAVED_FULL_YEAR, false).message!,
    );
  });

  it("does not promise a hidden retry when the portal is unavailable", async () => {
    await mount(false, false);

    expect(container.textContent).not.toContain("Open a signed-in GST Portal tab before");
  });

  it("keeps the active-run status without promising withheld retry controls", async () => {
    const activeSummary = {
      ...SAVED_FULL_YEAR,
      status: "running" as const,
      flowStep: {
        ...SAVED_FULL_YEAR.flowStep,
        safeSignals: ["full-fiscal-year-run-active"],
      },
    };
    await mount(false, true, activeSummary);

    // Positive control: this is the active-run branch, not a generic withheld recovery state.
    expect(buttonLabels()).toContain("Run in progress");
    expect(container.textContent).toContain(
      getRecoveryFlowAvailability(activeSummary, false).guidance,
    );
    expect(container.textContent).not.toContain(
      "Retry controls appear automatically if the run stops making progress.",
    );
  });

  it.each(["blocked", "failed"] as const)(
    "replaces hidden %s retry guidance in the packaged recovery block",
    async (targetStatus) => {
      const summary = {
        ...SAVED_FULL_YEAR,
        flowStep: {
          ...SAVED_FULL_YEAR.flowStep,
          safeMessage: "Resolve the GST Portal page, then retry this period.",
        },
        fullFiscalYearRecovery: {
          ...SAVED_FULL_YEAR.fullFiscalYearRecovery!,
          targetStatus,
        },
      };
      await mount(false, true, summary);

      const recovery = getRecoveryFlowAvailability(summary, false);
      expect(container.textContent).toContain(recovery.message!);
      expect(container.textContent).not.toContain(summary.flowStep.safeMessage);
      expect(
        recovery.mentionedActions.every((action) => recovery.availableActions.includes(action)),
      ).toBe(true);
    },
  );

  it("withholds fresh starts from a full-year target review", async () => {
    const targetReview = {
      ...SAVED_FULL_YEAR,
      flowStep: {
        ...SAVED_FULL_YEAR.flowStep,
        safeSignals: ["filed-returns-target-review-required"],
      },
    };
    delete targetReview.fullFiscalYearRecovery;
    await mount(false, true, targetReview);

    expect(container.textContent).not.toContain("Discard saved state and start selected download");
    const recovery = getRecoveryFlowAvailability(targetReview, false);
    expect(container.textContent).toContain(recovery.message!);
    expect(
      recovery.mentionedActions.every((action) => recovery.availableActions.includes(action)),
    ).toBe(true);
    expect(container.textContent).toContain("Cancel and reset");
  });

  it("keeps both controls in a build that may run it", async () => {
    await mount(true);

    const labels = buttonLabels();
    expect(labels.some((label) => label.includes("Discard saved run and start"))).toBe(true);
    expect(container.textContent).not.toContain("This build cannot continue a full-year run");
  });

  it("keeps every rendered withheld-recovery action within the packaged availability", async () => {
    vi.stubEnv("MODE", "production");
    const recovery = getRecoveryFlowAvailability(SAVED_FULL_YEAR, false);
    expect(SAVED_FULL_YEAR.targetEvidence.some((target) => target.outcome === "needs-review")).toBe(
      true,
    );
    const activeSummary: FiledReturnsFlowSummary = {
      ...SAVED_FULL_YEAR,
      status: "running",
      flowStep: {
        ...SAVED_FULL_YEAR.flowStep,
        safeSignals: ["full-fiscal-year-run-active"],
      },
    };
    const activeRecovery = getRecoveryFlowAvailability(activeSummary, false);
    const targetReview: FiledReturnsFlowSummary = {
      ...SAVED_FULL_YEAR,
      flowStep: {
        ...SAVED_FULL_YEAR.flowStep,
        safeSignals: ["filed-returns-target-review-required"],
      },
    };
    delete targetReview.fullFiscalYearRecovery;
    const targetReviewRecovery = getRecoveryFlowAvailability(targetReview, false);
    expect(recovery.isWithheldFullYearRecovery).toBe(true);
    expect(recovery.availableActions).toEqual(["cancel-saved-full-year-run"]);
    // Positive control: this goes through RecoveryActions' distinct active-run branch.
    expect(activeRecovery.isWithheldFullYearRecovery).toBe(true);
    // This reaches its own target-review branch, not either full-year recovery branch above.
    expect(targetReviewRecovery.message).toBeTruthy();

    const callbacks = {
      onAcknowledgeInterruptedRun: () => undefined,
      onOpenPortal: () => undefined,
      onRestartTarget: () => undefined,
      onResolveFullFiscalYearTarget: () => undefined,
      onResolveTarget: () => undefined,
      onRetryFullFiscalYearTarget: () => undefined,
      onRetryTarget: () => undefined,
      onStartFresh: () => undefined,
    };
    const surfaces: [string, string, string][] = [
      [
        "popup status",
        renderToStaticMarkup(
          <InlineStatus
            {...callbacks}
            busy={null}
            fullYearFlowAvailable={false}
            portalReady
            presentation={getPopupPresentationState(null, SAVED_FULL_YEAR, null)}
            summary={SAVED_FULL_YEAR}
          />,
        ),
        "Saved full-year run needs attention",
      ],
      [
        "popup recovery",
        renderToStaticMarkup(
          <RecoveryActions
            {...callbacks}
            busy={null}
            fullYearFlowAvailable={false}
            portalReady
            summary={SAVED_FULL_YEAR}
          />,
        ),
        "Cancel and reset",
      ],
      [
        "popup active recovery",
        renderToStaticMarkup(
          <RecoveryActions
            {...callbacks}
            busy={null}
            fullYearFlowAvailable={false}
            portalReady
            summary={activeSummary}
          />,
        ),
        "Run in progress",
      ],
      [
        "popup target-review recovery",
        renderToStaticMarkup(
          <RecoveryActions
            {...callbacks}
            busy={null}
            fullYearFlowAvailable={false}
            portalReady
            summary={targetReview}
          />,
        ),
        "Why Pack paused",
      ],
    ];

    const panel = await panelRecoveryText(SAVED_FULL_YEAR);
    expect(panel.beforeExpansionWarning).toContain("Check Downloads before starting again.");
    surfaces.push(["panel recovery disclosure", panel.afterExpansion, "Cancel and reset"]);
    const activePanel = await panelRecoveryText(activeSummary);
    surfaces.push([
      "panel active recovery disclosure",
      activePanel.afterExpansion,
      "Run in progress",
    ]);
    const targetReviewPanel = await panelRecoveryText(targetReview);
    surfaces.push([
      "panel target-review recovery disclosure",
      targetReviewPanel.afterExpansion,
      "Why Pack paused",
    ]);

    for (const [surface, markup, positiveControl] of surfaces) {
      const text = recoveryReaderText(new JSDOM(markup).window.document.body);
      // Each real presentation rendered its recovery branch before the semantic property below.
      expect(text, surface).toContain(positiveControl);
      expect(hasWithheldRecoveryWording(text), surface).toBe(false);
    }
    expect(surfaces.find(([surface]) => surface === "popup recovery")?.[1]).toContain(
      "Check Downloads before starting again.",
    );
    expect(surfaces.find(([surface]) => surface === "panel recovery disclosure")?.[1]).toContain(
      "Check Downloads before starting again.",
    );
  });

  it("replaces the canonical pinned-tab full-year restart instruction", async () => {
    // Positive control for the independent matcher: this exact durable wording would restart the
    // unavailable full-year plan if it reached a packaged surface.
    expect(hasWithheldRecoveryWording(PINNED_TAB_SAVED_FULL_YEAR.flowStep.safeMessage)).toBe(true);
    const stepLimitMessage = searchStepLimitReachedMessage(SAVED_FULL_YEAR.scope);
    expect(stepLimitMessage).toContain("start Pack again");
    expect(hasWithheldRecoveryWording("Start Pack again.")).toBe(true);
    expect(hasWithheldRecoveryWording("Run this plan again.")).toBe(true);
    await mount(false, true, PINNED_TAB_SAVED_FULL_YEAR);

    const recovery = getRecoveryFlowAvailability(PINNED_TAB_SAVED_FULL_YEAR, false);
    expect(recovery.message).not.toContain("start this year again");
    expect(buttonLabels()).toContain("Cancel and reset");
    expect(hasWithheldRecoveryWording(container.textContent ?? "")).toBe(false);
    const panel = await panelRecoveryText(PINNED_TAB_SAVED_FULL_YEAR);
    expect(panel.afterExpansion).toContain("Cancel and reset");
    expect(panel.afterExpansion).not.toContain("start this year again");
    expect(hasWithheldRecoveryWording(panel.afterExpansion)).toBe(false);
  });

  it("keeps the packaged panel's cancellation action wired", async () => {
    const cancel = vi.fn(async () => undefined);
    const retry = vi.fn(async () => undefined);
    const startFresh = vi.fn(async () => undefined);
    await panelRecoveryText(SAVED_FULL_YEAR, {
      resolveFullFiscalYearTarget: cancel,
      retryFullFiscalYearTarget: retry,
      startFreshFiledReturnsFlow: startFresh,
    });

    const cancelButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel and reset",
    );
    expect(cancelButton).toBeDefined();
    await act(async () => {
      cancelButton?.click();
      await Promise.resolve();
    });
    expect(cancel).toHaveBeenCalledWith("cancelled");
    expect(retry).not.toHaveBeenCalled();
    expect(startFresh).not.toHaveBeenCalled();
  });
});
