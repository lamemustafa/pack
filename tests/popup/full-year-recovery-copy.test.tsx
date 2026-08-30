import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import {
  markFullFiscalYearZipDownloadIntent,
  markFullFiscalYearZipDownloadObserving,
  markFullFiscalYearZipPhase,
} from "../../src/background/filed-returns-full-fiscal-year-staging";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { getInlinePrimaryAction, InlineStatus } from "../../src/entrypoints/popup/inline-status";
import { getPopupPresentationState } from "../../src/entrypoints/popup/presentation-state";
import { getRecoveryFlowAvailability } from "../../src/entrypoints/popup/recovery-flow-availability";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
} from "../background/full-year-completion-fixtures.test-helpers";

function actions() {
  return {
    onOpenPortal: vi.fn(),
    onRestartTarget: vi.fn(),
    onRetryFullFiscalYearTarget: vi.fn(),
    onRetryTarget: vi.fn(),
  };
}

vi.mock("wxt/browser", () => ({ browser: {} }));

describe("full-year warning without a usable period", () => {
  it.each([false, true])(
    "shows the reason without granting a target retry (portal: %s)",
    (portalReady) => {
      const produced = summariseFullFiscalYearLedger(
        makeCompletedRecoveryLedger("blocked"),
        RECOVERY_NOW,
      );
      expect(parseDurableFiledReturnsFlowSummary(produced)).not.toBeNull();
      // Deliberately malformed direct props: the canonical parser rejects this pairing.
      const summary = { ...produced };
      delete summary.currentPeriod;
      expect(summary.fullFiscalYearRecovery).toBeDefined();
      expect(parseDurableFiledReturnsFlowSummary(summary)).toBeNull();
      const presentation = {
        ...getPopupPresentationState(null, produced, null),
        title: "Saved run needs attention",
      };
      const callbacks = actions();
      expect(getInlinePrimaryAction(presentation, summary, callbacks)).toBeNull();

      const markup = renderToStaticMarkup(
        <InlineStatus
          {...callbacks}
          busy={null}
          portalReady={portalReady}
          presentation={presentation}
          summary={summary}
        />,
      );
      expect(markup).toContain('aria-label="Saved run needs attention"');
      expect(markup).toContain(renderToStaticMarkup(<p>{summary.flowStep.safeMessage}</p>));
      expect(markup).not.toContain("<button");
      for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
    },
  );

  it.each(["blocked", "download-unconfirmed"] as const)(
    "keeps canonical %s target recovery routed to the existing callback",
    (status) => {
      const summary = summariseFullFiscalYearLedger(
        makeCompletedRecoveryLedger(status),
        RECOVERY_NOW,
      );
      expect(parseDurableFiledReturnsFlowSummary(summary)).not.toBeNull();
      const presentation = getPopupPresentationState(null, summary, null);
      const callbacks = actions();
      const action = getInlinePrimaryAction(presentation, summary, callbacks);
      expect(action).not.toBeNull();
      expect(action?.portalDisabledReason).toContain("signed-in GST Portal");
      action?.onClick();
      expect(callbacks.onRetryFullFiscalYearTarget).toHaveBeenCalledOnce();
      expect(callbacks.onRestartTarget).not.toHaveBeenCalled();
      expect(callbacks.onRetryTarget).not.toHaveBeenCalled();
      expect(callbacks.onOpenPortal).not.toHaveBeenCalled();
    },
  );

  it("replaces saved full-year retry guidance when the enclosing build cannot run it", () => {
    const summary = summariseFullFiscalYearLedger(
      makeCompletedRecoveryLedger("blocked"),
      RECOVERY_NOW,
    );
    const presentation = getPopupPresentationState(null, summary, null);
    const callbacks = actions();

    expect(
      getInlinePrimaryAction(presentation, summary, {
        ...callbacks,
        fullYearFlowAvailable: false,
      }),
    ).toBeNull();

    const markup = renderToStaticMarkup(
      <InlineStatus
        {...callbacks}
        busy={null}
        fullYearFlowAvailable={false}
        portalReady
        presentation={presentation}
        summary={summary}
      />,
    );
    expect(markup).toContain(getRecoveryFlowAvailability(summary, false).message!);
    expect(markup).not.toContain("retry this period to continue the remaining periods");
  });
});

describe.each(["direct", "parsed"] as const)("%s final-ZIP status precedence", (source) => {
  it.each([
    ["export-pending", "Saved run needs attention"],
    ["export-retry-pending", "Saved run needs attention"],
    ["download-started", "Check Browser Downloads"],
    ["download-intent-persisted", "Check Browser Downloads"],
    ["download-observing", "Check final ZIP status"],
  ] as const)("keeps %s reason and status-only warning", (phase, heading) => {
    const completed = makeCompletedRecoveryLedger("downloaded");
    const ledger =
      phase === "download-observing"
        ? markFullFiscalYearZipDownloadObserving(
            markFullFiscalYearZipDownloadIntent(completed, RECOVERY_NOW),
            RECOVERY_NOW,
            7,
          )
        : phase === "download-intent-persisted"
          ? markFullFiscalYearZipDownloadIntent(completed, RECOVERY_NOW)
          : markFullFiscalYearZipPhase(completed, RECOVERY_NOW, phase);
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const produced = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    const parsed = parseDurableFiledReturnsFlowSummary(JSON.parse(JSON.stringify(produced)));
    expect(parsed).not.toBeNull();
    const summary = source === "direct" ? produced : parsed!;
    expect(summary.currentPeriod).toBeUndefined();
    expect(summary.fullFiscalYearRecovery).toBeUndefined();
    const presentation = getPopupPresentationState(null, summary, null);
    const callbacks = actions();
    expect(getInlinePrimaryAction(presentation, summary, callbacks)).toBeNull();
    const markup = renderToStaticMarkup(
      <InlineStatus
        {...callbacks}
        busy={null}
        portalReady={false}
        presentation={presentation}
        summary={summary}
      />,
    );
    expect(markup).toContain(`aria-label="${heading}"`);
    expect(markup).toContain(renderToStaticMarkup(<p>{summary.flowStep.safeMessage}</p>));
    expect(markup).not.toContain("<button");
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });
});
