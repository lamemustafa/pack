import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import {
  completeFullFiscalYearLedger,
  isFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { markFullFiscalYearCleanupPending } from "../../src/background/filed-returns-full-fiscal-year-staging";
import {
  completeFullFiscalYearStep,
  summariseFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-summary";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
} from "./full-year-completion-fixtures.test-helpers";
import { panelController } from "../panel/panel-controller.test-helpers";

vi.mock("wxt/browser", () => ({ browser: { tabs: { create: vi.fn() } } }));
import { PanelSurface } from "../../src/entrypoints/panel/panel-surface";

const NO_EXPORT_SIGNAL = "full-fiscal-year-no-zip-artifacts";
const SOURCES = ["direct ledger summary", "durable parser round-trip"] as const;

it("does not infer no export from an empty target list", () => {
  const ledger = completeCleanup("not-filed", "no-artifacts-cleanup-pending");
  ledger.targets = [];
  expect(isFullFiscalYearLedger(ledger)).toBe(false);
  expect(completeFullFiscalYearStep(ledger).safeSignals).not.toContain(NO_EXPORT_SIGNAL);
});

function completeCleanup(
  targetStatus: "downloaded" | "not-filed",
  pendingPhase:
    "downloaded-cleanup-pending" | "no-artifacts-cleanup-pending" | "legacy-cleanup-pending" | null,
) {
  const initial = makeCompletedRecoveryLedger(targetStatus);
  expect(isFullFiscalYearLedger(initial)).toBe(true);
  const pending = pendingPhase
    ? markFullFiscalYearCleanupPending(initial, RECOVERY_NOW, pendingPhase)
    : initial;
  expect(isFullFiscalYearLedger(pending)).toBe(true);
  const completed = completeFullFiscalYearLedger(pending, RECOVERY_NOW);
  const reopened = JSON.parse(JSON.stringify(completed)) as typeof completed;
  expect(isFullFiscalYearLedger(reopened)).toBe(true);
  expect(reopened.status).toBe("complete");
  expect(reopened.currentTargetId).toBeUndefined();
  expect(reopened.targets).toHaveLength(12);
  return reopened;
}

function renderReopened(produced: FiledReturnsFlowSummary, source: (typeof SOURCES)[number]) {
  const summary =
    source === "direct ledger summary"
      ? produced
      : parseDurableFiledReturnsFlowSummary(JSON.parse(JSON.stringify(produced)));
  expect(summary).not.toBeNull();
  if (!summary) throw new Error("Completed canonical summary must survive durable parsing.");
  expect(summary.status).toBe("complete");
  expect(summary.completedPeriods).toHaveLength(12);
  expect(summary.totalPeriods).toBe(12);
  expect(summary.completedAt).toBe(RECOVERY_NOW.toISOString());
  expect(summary.currentPeriod).toBeUndefined();
  expect(summary.fullFiscalYearRecovery).toBeUndefined();
  const onStart = vi.fn(async () => undefined);
  const markup = renderToStaticMarkup(
    <PanelSurface
      pack={panelController({
        context: null,
        scope: summary.scope,
        scopedFlowSummary: summary,
        lastRunSummary: summary,
        startFiledReturnsFlow: onStart,
      })}
    />,
  );
  expect(onStart).not.toHaveBeenCalled();
  if (source === "durable parser round-trip") {
    // Display evidence is intentionally not copied into durable summary storage.
    expect(summary.targetEvidence).toBeUndefined();
    expect(markup).not.toContain('aria-label="Per-period result"');
    expect(markup).not.toMatch(/\b\d+ of 12 saved\b/);
  }
  return { summary, markup };
}

describe.each(SOURCES)("completed no-export reopen: %s", (source) => {
  it("preserves the no-ZIP outcome after the ledger completion transition and re-summary", () => {
    const ledger = completeCleanup("not-filed", "no-artifacts-cleanup-pending");
    expect(ledger.zipPhase).toBe("cleaned-without-export");
    expect(ledger.targets.every((target) => target.status === "not-filed")).toBe(true);
    const before = structuredClone(ledger);
    const produced = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
    expect(ledger).toEqual(before);
    expect(produced.targetEvidence).toHaveLength(12);
    expect(produced.targetEvidence?.every((target) => target.outcome === "not-filed")).toBe(true);

    const { summary, markup } = renderReopened(produced, source);
    if (source === "direct ledger summary") {
      expect(markup).toContain('aria-label="Per-period result"');
      expect(markup).toContain("0 of 12 saved");
      expect(markup.match(/>Not filed</g)).toHaveLength(12);
    }
    expect(markup).toContain('aria-label="No ZIP created"');
    expect(markup).toContain("No ZIP created · no eligible files");
    expect(markup).toContain(
      "12 periods processed. No ZIP was created because no eligible files were found.",
    );
    expect(markup).not.toContain("browser download not confirmed");
    expect(markup).not.toContain("ZIP unconfirmed");
    expect(markup).not.toContain("saved by your browser");
    expect(markup).not.toContain("Download complete");
    expect(summary.flowStep.safeSignals).toContain(NO_EXPORT_SIGNAL);
    expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-zip-downloaded");
  });

  it.each([
    { phase: "cleaned", pending: null, targetStatus: "not-filed", delivered: false },
    {
      phase: "cleaned-legacy",
      pending: "legacy-cleanup-pending",
      targetStatus: "not-filed",
      delivered: false,
    },
    {
      phase: "cleaned-after-download",
      pending: "downloaded-cleanup-pending",
      targetStatus: "downloaded",
      delivered: true,
    },
  ] as const)("does not infer absence of a ZIP from $phase", (testCase) => {
    const ledger = completeCleanup(testCase.targetStatus, testCase.pending);
    expect(ledger.zipPhase).toBe(testCase.phase);
    const { summary, markup } = renderReopened(
      summariseFullFiscalYearLedger(ledger, RECOVERY_NOW),
      source,
    );
    expect(summary.flowStep.safeSignals).not.toContain(NO_EXPORT_SIGNAL);
    expect(markup).not.toContain("No ZIP created");
    expect(markup).not.toContain("no eligible files");
    expect(markup).toContain(
      testCase.delivered
        ? "One ZIP · saved by your browser"
        : "One ZIP · browser download not confirmed",
    );
    if (testCase.delivered) {
      expect(markup).toContain('aria-label="Download complete"');
      expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-zip-downloaded");
    } else {
      expect(markup).toContain('aria-label="Periods processed, ZIP unconfirmed"');
      expect(summary.flowStep.safeSignals).not.toContain("full-fiscal-year-zip-downloaded");
    }
  });

  it("does not turn a contradictory downloaded target into a no-artifacts claim", () => {
    // This structural combination is accepted today; do not rely on rejection.
    const ledger = completeCleanup("downloaded", "no-artifacts-cleanup-pending");
    expect(ledger.zipPhase).toBe("cleaned-without-export");
    expect(ledger.targets.filter((target) => target.status === "downloaded")).toHaveLength(1);
    expect(ledger.targets.filter((target) => target.status === "not-filed")).toHaveLength(11);
    const { summary, markup } = renderReopened(
      summariseFullFiscalYearLedger(ledger, RECOVERY_NOW),
      source,
    );
    expect(summary.flowStep.safeSignals).not.toContain(NO_EXPORT_SIGNAL);
    expect(markup).not.toContain("No ZIP created");
    expect(markup).not.toContain("no eligible files");
    expect(markup).not.toContain("saved by your browser");
    expect(markup).toContain("One ZIP · browser download not confirmed");
    expect(markup).toContain('aria-label="Periods processed, ZIP unconfirmed"');
    if (source === "direct ledger summary") {
      expect(markup).toContain("0 of 12 saved");
      expect(markup).toContain("1 captured, ZIP not confirmed");
      expect(markup.match(/>Not filed</g)).toHaveLength(11);
    }
  });
});
