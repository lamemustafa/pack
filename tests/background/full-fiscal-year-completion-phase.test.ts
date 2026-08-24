import { describe, expect, it } from "vitest";
import {
  completeFullFiscalYearLedger,
  createFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { cleanupPendingPhaseFor } from "../../src/background/filed-returns-full-fiscal-year-staging";
import {
  FULL_FISCAL_YEAR_PERIOD,
  type FiledReturnsMonth,
} from "../../src/connectors/gst/filed-returns-scope";
import type { FiledReturnsFullFiscalYearLedger } from "../../src/connectors/gst/filed-returns-contracts";

const PERIODS: readonly FiledReturnsMonth[] = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
];

// Nothing covered what completion writes, so the value could be changed without
// a single failure -- and that value is now the only durable record of whether
// the ZIP reached the browser.
describe("full-fiscal-year completion phase", () => {
  // Each pending phase has exactly one terminal form, so the route that reached
  // cleanup survives the transition that used to erase it.
  it("keeps the origin of each cleanup route", () => {
    const routes = [
      ["downloaded-cleanup-pending", "cleaned-after-download"],
      ["no-artifacts-cleanup-pending", "cleaned-without-export"],
      ["legacy-cleanup-pending", "cleaned-legacy"],
    ] as const;

    for (const [pending, terminal] of routes) {
      const completed = completeFullFiscalYearLedger(
        completable({ zipPhase: pending }),
        new Date("2026-08-23T12:00:00.000Z"),
      );

      expect(completed.zipPhase, pending).toBe(terminal);
      expect(completed.status, pending).toBe("complete");
    }
  });

  // Re-cleaning a completed ledger must not promote it. The retry path took the
  // default cleanup phase, which is the delivery route, so a run that never
  // exported anything came back through completion as a confirmed delivery --
  // the overclaim the origin split exists to prevent, reached through the
  // transition that was meant to preserve it.
  it("does not upgrade a re-cleaned ledger to the delivery route", () => {
    const routes = [
      ["cleaned-legacy", "legacy-cleanup-pending", "cleaned-legacy"],
      ["cleaned-without-export", "no-artifacts-cleanup-pending", "cleaned-without-export"],
      ["cleaned-after-download", "downloaded-cleanup-pending", "cleaned-after-download"],
      // Pre-split, no origin: takes the non-delivery route and stays captured.
      ["cleaned", "legacy-cleanup-pending", "cleaned-legacy"],
    ] as const;

    for (const [alreadyCleaned, retryPhase, terminal] of routes) {
      expect(cleanupPendingPhaseFor(alreadyCleaned), alreadyCleaned).toBe(retryPhase);

      const recompleted = completeFullFiscalYearLedger(
        completable({ zipPhase: retryPhase }),
        new Date("2026-08-23T12:00:00.000Z"),
      );

      expect(recompleted.zipPhase, alreadyCleaned).toBe(terminal);
    }
  });

  // A phase this build does not recognise, or none at all, must not be guessed
  // into a delivery. The origin-less value reads as indeterminate downstream,
  // which is what an unknown route should produce.
  it("does not invent an origin when there is no pending phase", () => {
    const completed = completeFullFiscalYearLedger(
      completable({}),
      new Date("2026-08-23T12:00:00.000Z"),
    );

    expect(completed.zipPhase).toBe("cleaned");
  });
});

function completable(
  overrides: Partial<FiledReturnsFullFiscalYearLedger>,
): FiledReturnsFullFiscalYearLedger {
  const ledger = createFullFiscalYearLedger(
    {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: FULL_FISCAL_YEAR_PERIOD,
      returnType: "GSTR-3B",
    },
    new Date("2026-08-01T00:00:00.000Z"),
    PERIODS,
  );
  return {
    ...ledger,
    targets: ledger.targets.map((target) => ({ ...target, status: "downloaded" as const })),
    ...overrides,
  };
}
