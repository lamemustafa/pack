import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { canonicalDurableTargetStatus } from "../../src/connectors/gst/filed-returns-durable-status";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
  RECOVERY_TARGET_STATUSES,
} from "../background/full-year-completion-fixtures.test-helpers";
import { panelController } from "./panel-controller.test-helpers";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));
import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";

describe("whole-panel unresolved completion recovery", () => {
  beforeEach(() => {
    vi.stubEnv("MODE", "alpha");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(RECOVERY_TARGET_STATUSES)(
    "renders %s as recovery, without a completion announcement",
    (status) => {
      const ledger = makeCompletedRecoveryLedger(status, {
        positiveFirst: true,
        currentPositive: true,
      });
      expect(isFullFiscalYearLedger(ledger)).toBe(true);
      const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
      const retry = vi.fn();
      const markup = renderToStaticMarkup(
        <PanelSurface
          pack={panelController({
            context: null,
            scope: summary.scope,
            scopedFlowSummary: summary,
            recoverySummary: summary,
            lastRunSummary: summary,
            scopeLockedForReview: true,
            retryFullFiscalYearTarget: retry,
          })}
        />,
      );

      expect(markup).toContain('aria-label="Full-year run paused at May"');
      expect(markup).toContain("Recovery options");
      expect(markup).not.toContain("Download complete");
      expect(markup).not.toContain("Periods processed, ZIP unconfirmed");
      expect(markup).not.toContain("saved as one ZIP");
      expect(markup).toContain(status === "pending" ? "Resume saved run" : "Retry May");
      if (status === "pending") expect(markup).toContain("same GST account");
      if (status === "running") expect(markup).toContain("1 needs review");
      expect(retry).not.toHaveBeenCalled();
    },
  );

  it("keeps one paused-run primary action while destructive recovery stays collapsed", () => {
    const ledger = makeCompletedRecoveryLedger("blocked", {
      positiveFirst: true,
      currentPositive: true,
    });
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={panelController({
          scope: summary.scope,
          scopedFlowSummary: summary,
          recoverySummary: summary,
          lastRunSummary: summary,
          scopeLockedForReview: true,
        })}
      />,
    );

    expect(markup.match(/class="inline-status-primary"/g)).toHaveLength(1);
    expect(markup).toContain("Recovery options");
    expect(markup).not.toContain("Discard saved run");
    expect(markup).not.toContain("Cancel and reset");
  });

  it("does not let filename caution promote unresolved recovery to Download complete", () => {
    const ledger = makeCompletedRecoveryLedger("blocked");
    const target = ledger.targets[0]!;
    Object.assign(
      target,
      canonicalDurableTargetStatus(target, "blocked", ["download-filename-overridden"]),
    );
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={panelController({
          scope: summary.scope,
          scopedFlowSummary: summary,
          recoverySummary: summary,
          lastRunSummary: summary,
          scopeLockedForReview: true,
        })}
      />,
    );
    expect(markup).not.toContain("Download complete");
    expect(markup).toContain('aria-label="Full-year run paused at April"');
    expect(markup).toContain(summary.flowStep.safeMessage);
  });

  it("binds the mixed-target warning and action to the unconfirmed target", () => {
    const ledger = makeCompletedRecoveryLedger("download-unconfirmed");
    const other = ledger.targets[1]!;
    Object.assign(
      other,
      { status: "pending", attempts: 0 },
      canonicalDurableTargetStatus(other, "pending", []),
    );
    ledger.currentTargetId = other.targetId;
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const summary = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    const markup = renderToStaticMarkup(
      <PanelSurface
        pack={panelController({
          scopedFlowSummary: summary,
          recoverySummary: summary,
          lastRunSummary: summary,
          scopeLockedForReview: true,
        })}
      />,
    );
    expect(markup).toContain('aria-label="Full-year run paused at April"');
    expect(markup).toContain("Retry April");
    expect(markup).not.toContain("Resume saved period");
    expect(markup).toContain(summary.flowStep.safeMessage);
  });
});
