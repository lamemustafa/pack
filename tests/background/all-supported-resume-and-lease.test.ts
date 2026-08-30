import { describe, expect, it } from "vitest";
import { toAllSupportedFullFiscalYearSummary } from "../../src/background/filed-returns-all-supported-full-fiscal-year-summary";
import type { FiledReturnsAllSupportedFullFiscalYearLedger } from "../../src/background/filed-returns-all-supported-full-fiscal-year-validation";

/**
 * Two properties the panel depends on and that age alone cannot establish.
 *
 * A root ledger records no heartbeat while an atomic child is running, and a child may legitimately
 * outlast the root's staleness window -- the content-message timeout alone is sixty seconds. Judging
 * by age tells the reader the worker stopped while it is mid-target. The run's lease renews every
 * ten seconds and is the evidence that separates a stopped worker from a busy one.
 *
 * Separately, the runner saves `export-retry-pending` and the cleanup-pending phases so that exact
 * phase is retried when the same start is invoked again. A surface that blocks every non-terminal
 * run hides the only route to those branches.
 */

const STALE_AT = "2026-08-30T05:00:00.000Z";
const LONG_AFTER = new Date("2026-08-30T05:05:00.000Z");

function runningLedger(
  zipPhase?: FiledReturnsAllSupportedFullFiscalYearLedger["zipPhase"],
): FiledReturnsAllSupportedFullFiscalYearLedger {
  return {
    schemaVersion: "1.0",
    ledgerId: "lease-probe",
    status: "running",
    planRoot: { kind: "all-supported-returns-full-fiscal-year", financialYear: "2025-26" },
    createdAt: STALE_AT,
    updatedAt: STALE_AT,
    ...(zipPhase ? { zipPhase } : {}),
    targets: [
      {
        targetId: "GSTR-3B:2025-26:April",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-3B",
        artifactType: "PDF",
        status: "running",
        attempts: 1,
        safeSignals: [],
        safeMessage: "",
        updatedAt: STALE_AT,
      },
    ],
  } as unknown as FiledReturnsAllSupportedFullFiscalYearLedger;
}

describe("an all-supported root whose child is still working", () => {
  it("is not called interrupted while its lease is live", () => {
    expect(toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, true).status).toBe(
      "running",
    );
  });

  it("is called interrupted once the lease is not", () => {
    expect(toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, false).status).toBe(
      "blocked",
    );
  });
});

describe("a saved all-supported plan the runner can retry", () => {
  it.each([
    ["export-retry-pending"],
    ["downloaded-cleanup-pending"],
    ["no-artifacts-cleanup-pending"],
  ])("reports %s as resumable", (phase) => {
    const summary = toAllSupportedFullFiscalYearSummary(
      runningLedger(phase as never),
      LONG_AFTER,
      true,
    );
    expect(summary.resumeAvailable).toBe(true);
  });

  it("reports a plan with no saved phase as not resumable", () => {
    expect(
      toAllSupportedFullFiscalYearSummary(runningLedger(), LONG_AFTER, true).resumeAvailable,
    ).toBe(false);
  });
});
