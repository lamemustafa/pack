import { describe, expect, it } from "vitest";
import {
  filedReturnsSummaryOutcome,
  filedReturnsSummaryStatusMessage,
} from "../../src/connectors/gst/filed-returns-summary-status";

describe("filed-return summary status", () => {
  it("names the return-type workbook boundary while keeping the CSV included", () => {
    const outcome = filedReturnsSummaryOutcome(true, {
      status: "included",
      workbookOutcome: "not-applicable",
      outcomeOnly: false,
      parsedPeriodCount: 1,
      rowCount: 2,
    });

    expect(outcome.safeSignals).toContain("full-fiscal-year-summary-included");
    expect(outcome.safeSignals).toContain("full-fiscal-year-workbook-not-applicable");
    expect(outcome.safeSignals).not.toContain("full-fiscal-year-summary-failed");
    expect(outcome.safeMessage).toBe(
      "The ZIP includes the tidy CSV for 1 period. A consolidated workbook is not available for this return type.",
    );
    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals)).toBe(
      " The ZIP includes the tidy CSV for 1 period. A consolidated workbook is not available for this return type.",
    );
  });

  it("keeps size-limit failures accurate when no workbook was applicable", () => {
    const outcome = filedReturnsSummaryOutcome(true, {
      status: "failed",
      reasonCategory: "too-large",
    });

    expect(outcome.safeMessage).toBe(
      "Pack saved the artifact files without derived summary outputs because the derived summary output exceeded its local size limit.",
    );
    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals)).toBe(
      " Pack saved the artifact files without derived summary outputs because the derived summary output exceeded its local size limit.",
    );
    expect(outcome.safeMessage).not.toContain("workbook and CSV");
  });

  it("does not claim a CSV from an unbound workbook-not-applicable marker", () => {
    expect(filedReturnsSummaryStatusMessage(["full-fiscal-year-workbook-not-applicable"])).toBe("");
  });
});
