import { describe, expect, it } from "vitest";
import {
  completeFullFiscalYearLedger,
  createFullFiscalYearLedger,
} from "../../src/background/filed-returns-full-fiscal-year-ledger";
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
