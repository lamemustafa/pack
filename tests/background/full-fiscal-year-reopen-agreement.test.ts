import { describe, expect, it } from "vitest";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { createFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
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

// Five things ask whether the ZIP reached the browser, and every one of them
// asks it of the summary step's signals: the panel banner, the pack summary
// line, two durable status derivations, and the per-period evidence.
//
// Teaching only the evidence to read the durable phase made it disagree with
// the other four. A live run showed twelve periods "Saved" underneath a banner
// saying Pack could not confirm the browser had the ZIP -- one screen
// contradicting itself, with the overclaiming half being the new one.
//
// Nothing pinned that they agree, which is why a green suite said nothing about
// it. This is that pin: the reopened summary must answer the question the same
// way for every reader, because they all read one signal.
describe("full-fiscal-year summary agreement after reopen", () => {
  it("reports delivery to the banner and the evidence together", () => {
    const summary = summariseFullFiscalYearLedger(cleaned("cleaned-after-download"));

    // What the banner and the pack summary line read.
    expect(summary.flowStep.safeSignals).toContain("full-fiscal-year-zip-downloaded");
    // What the per-period column reads.
    expect(new Set(summary.targetEvidence?.map((entry) => entry.outcome))).toEqual(
      new Set(["saved"]),
    );
  });

  // The other direction, and the one that must never drift: a run that never
  // exported must read unconfirmed in both places.
  it("withholds delivery from both when cleanup was not a download", () => {
    for (const zipPhase of ["cleaned-without-export", "cleaned-legacy", "cleaned"] as const) {
      const summary = summariseFullFiscalYearLedger(cleaned(zipPhase));

      expect(summary.flowStep.safeSignals, zipPhase).not.toContain(
        "full-fiscal-year-zip-downloaded",
      );
      expect(new Set(summary.targetEvidence?.map((entry) => entry.outcome)), zipPhase).toEqual(
        new Set(["captured"]),
      );
    }
  });
});

function cleaned(
  zipPhase: NonNullable<FiledReturnsFullFiscalYearLedger["zipPhase"]>,
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
    status: "complete",
    zipPhase,
    targets: ledger.targets.map((target) => ({ ...target, status: "downloaded" as const })),
  };
}
