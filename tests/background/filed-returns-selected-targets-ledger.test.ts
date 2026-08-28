import { describe, expect, it } from "vitest";
import {
  canCompleteFullFiscalYearLedger,
  createSelectedTargetsLedger,
  hasTrustworthyTargetPlan,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { createSelectedFiledReturnsTargetsRequest } from "../../src/connectors/gst/filed-returns-selected-target-plan";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/connectors/gst/filed-returns-contracts";

/**
 * A run over months a person picked. The full-year guard refused these because it compares a
 * plan against the canonical periods for the year, so anything that skipped a month -- or
 * started after the first one -- could be planned but never completed.
 */

const NOW = new Date("2026-08-28T00:00:00.000Z");

function request(periods: string[]) {
  const built = createSelectedFiledReturnsTargetsRequest(
    "2025-26",
    periods.map((period) => ({
      returnType: "GSTR-1" as const,
      period: period as never,
      artifactType: "PDF" as const,
    })),
  );
  if (!built) throw new Error("the request should be valid");
  return built;
}

function settled(ledger: FiledReturnsFullFiscalYearLedger): FiledReturnsFullFiscalYearLedger {
  return {
    ...ledger,
    targets: ledger.targets.map((target) => ({ ...target, status: "downloaded" as const })),
  };
}

describe("a run over picked periods", () => {
  it("plans exactly the picked months, in canonical order", () => {
    const ledger = createSelectedTargetsLedger(request(["July", "May"]), NOW);

    expect(ledger.targets.map((target) => target.period)).toEqual(["May", "July"]);
    expect(ledger.targetPlan?.map((target) => target.period)).toEqual(["May", "July"]);
  });

  it("is trusted as completion authority though it skips a month", () => {
    // The whole point: May and July is not a canonical prefix, so the full-year guard rejects
    // it. Authority here is the plan recorded when the run was created.
    const ledger = createSelectedTargetsLedger(request(["May", "July"]), NOW);

    expect(hasTrustworthyTargetPlan(ledger)).toBe(true);
    expect(canCompleteFullFiscalYearLedger(settled(ledger))).toBe(true);
  });

  it("is trusted when it starts after the first month of the year", () => {
    const ledger = createSelectedTargetsLedger(request(["June", "July", "August"]), NOW);

    expect(hasTrustworthyTargetPlan(ledger)).toBe(true);
    expect(canCompleteFullFiscalYearLedger(settled(ledger))).toBe(true);
  });

  it("refuses a plan whose targets no longer match what was recorded", () => {
    // Completion authority is the recorded plan, so a target set that drifted from it must not
    // be completable -- otherwise "saved" would describe a run nobody authorised.
    const ledger = createSelectedTargetsLedger(request(["May", "July"]), NOW);
    const drifted: FiledReturnsFullFiscalYearLedger = {
      ...ledger,
      targets: ledger.targets.slice(0, 1),
    };

    expect(hasTrustworthyTargetPlan(drifted)).toBe(false);
    expect(canCompleteFullFiscalYearLedger(settled(drifted))).toBe(false);
  });

  it("refuses a plan whose recorded months are out of order or repeated", () => {
    const ledger = createSelectedTargetsLedger(request(["May", "July"]), NOW);
    const reversed: FiledReturnsFullFiscalYearLedger = {
      ...ledger,
      targetPlan: [ledger.targetPlan![1]!, ledger.targetPlan![0]!],
    };
    const repeated: FiledReturnsFullFiscalYearLedger = {
      ...ledger,
      targetPlan: [ledger.targetPlan![0]!, ledger.targetPlan![0]!],
    };

    expect(hasTrustworthyTargetPlan(reversed)).toBe(false);
    expect(hasTrustworthyTargetPlan(repeated)).toBe(false);
  });

  it("does not claim an extent it does not have", () => {
    // `eligibleThrough` means "the year, up to here". A picked set is not contiguous, so a
    // reader taking its last month as an extent would count months nobody selected.
    const ledger = createSelectedTargetsLedger(request(["May", "July"]), NOW);
    expect(ledger.eligibleThrough).toBeUndefined();
  });

  it("refuses a selection spanning more than one return type", () => {
    const mixed = createSelectedFiledReturnsTargetsRequest("2025-26", [
      { returnType: "GSTR-1", period: "May", artifactType: "PDF" },
      { returnType: "GSTR-3B", period: "May", artifactType: "PDF" },
    ]);
    if (!mixed) throw new Error("the request should be valid");

    expect(() => createSelectedTargetsLedger(mixed, NOW)).toThrow(/exactly one return type/);
  });
});
