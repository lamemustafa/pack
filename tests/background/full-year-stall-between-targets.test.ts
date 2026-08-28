import { describe, expect, it } from "vitest";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import type {
  FiledReturnsFullFiscalYearLedger,
  FiledReturnsFullFiscalYearTarget,
} from "../../src/connectors/gst/filed-returns-contracts";

/**
 * A full-year run stalls between targets as readily as during one: the window after a
 * target finishes and before the next is marked `running` has no running target at all.
 * Both staleness branches used to require one, so a runner that died in that window left
 * a ledger that reported itself active for as long as the profile kept it -- while the
 * panel offered only a disabled "Run in progress" under a promise that retry controls
 * would appear on their own. Observed twice against the live portal on a full-year
 * GSTR-2B run, both times with no way out of the panel short of a reset.
 */

const STALLED_AT = "2026-08-27T05:00:00.000Z";
const FIVE_MINUTES_LATER = new Date("2026-08-27T05:05:00.000Z");
const STILL_MOVING = new Date("2026-08-27T05:00:10.000Z");

function target(
  period: string,
  status: FiledReturnsFullFiscalYearTarget["status"],
): FiledReturnsFullFiscalYearTarget {
  return {
    targetId: `GSTR-2B:2026-27:${period}`,
    financialYear: "2026-27",
    period,
    returnType: "GSTR-2B",
    status,
    attempts: 1,
    safeSignals: [],
    safeMessage: "",
    updatedAt: STALLED_AT,
  };
}

function runningLedger(
  targets: FiledReturnsFullFiscalYearTarget[],
): FiledReturnsFullFiscalYearLedger {
  return {
    schemaVersion: "1.0",
    ledgerId: "stall-between-targets",
    status: "running",
    scope: {
      connectorId: "gst",
      returnType: "GSTR-2B",
      financialYear: "2026-27",
      period: "April",
      artifactType: "PDF_AND_EXCEL",
      fullFiscalYear: true,
    } as FiledReturnsFullFiscalYearLedger["scope"],
    createdAt: STALLED_AT,
    updatedAt: STALLED_AT,
    targets,
  };
}

describe("a full-year run that stalls between targets", () => {
  it("is reported interrupted even though no target claims to be running", () => {
    const summary = summariseFullFiscalYearLedger(
      runningLedger([target("April", "downloaded"), target("May", "downloaded")]),
      FIVE_MINUTES_LATER,
    );

    expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-run-interrupted");
    expect(summary.flowStep.safeMessage).toBe(
      "Pack stopped before it could confirm the FY 2026-27 run. Check Downloads before starting again.",
    );
  });

  it("still reports a run that is between targets and moving as active", () => {
    const summary = summariseFullFiscalYearLedger(
      runningLedger([target("April", "downloaded"), target("May", "downloaded")]),
      STILL_MOVING,
    );

    expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-run-active");
  });

  it("keeps naming the stalled period when one target is still marked running", () => {
    const summary = summariseFullFiscalYearLedger(
      runningLedger([target("April", "downloaded"), target("May", "running")]),
      FIVE_MINUTES_LATER,
    );

    expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-run-interrupted");
    expect(summary.flowStep.safeMessage).toContain("May");
  });
});
