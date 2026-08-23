import { describe, expect, it } from "vitest";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  filedReturnsSummaryOutcome,
  filedReturnsSummaryStatusMessage,
  type FiledReturnsSummaryLifecycle,
} from "../../src/connectors/gst/filed-returns-summary-status";

const LIFECYCLES = ["intent", "confirmed", "unconfirmed"] as const;

describe("filed-return summary status", () => {
  // The `unavailable` outcome was added to the worker without a branch here, so
  // a run that emitted only the CSV still told the user the ZIP included "the
  // workbook and tidy CSV" -- a completion claim for a file that was never
  // written.
  it("does not claim a workbook when the run reports it unavailable", () => {
    const outcome = filedReturnsSummaryOutcome(true, {
      status: "included",
      workbookOutcome: "unavailable",
      outcomeOnly: false,
      parsedPeriodCount: 1,
      rowCount: 2,
    });

    expect(outcome.safeSignals).toContain("full-fiscal-year-workbook-unavailable");
    for (const lifecycle of LIFECYCLES) {
      const message = filedReturnsSummaryStatusMessage(outcome.safeSignals, lifecycle);
      expect(message).not.toContain("the workbook and tidy CSV");
      expect(message).toContain("could not produce the workbook");
    }
  });

  // An outcome this build does not recognise must still say the workbook is
  // absent rather than falling through to the inclusion claim.
  it("still withholds the workbook claim for an unrecognised outcome", () => {
    const message = filedReturnsSummaryStatusMessage(
      [
        "full-fiscal-year-summary-included",
        "full-fiscal-year-workbook-some-future-outcome",
        "full-fiscal-year-summary-parsed-period-count:1",
      ],
      "confirmed",
    );

    expect(message).not.toContain("the workbook and tidy CSV");
    expect(message).toContain("The workbook is not included in this ZIP.");
  });

  it("names the return-type workbook boundary while keeping the CSV included", () => {
    const outcome = filedReturnsSummaryOutcome(true, {
      status: "included",
      workbookOutcome: "not-applicable",
      outcomeOnly: false,
      parsedPeriodCount: 1,
      rowCount: 2,
    });
    const notApplicable = " A consolidated workbook is not available for this return type.";

    expect(outcome.safeSignals).toContain("full-fiscal-year-summary-included");
    expect(outcome.safeSignals).toContain("full-fiscal-year-workbook-not-applicable");
    expect(outcome.safeSignals).not.toContain("full-fiscal-year-summary-failed");
    expect(outcome).not.toHaveProperty("safeMessage");

    // A success claim is conditioned on the lifecycle exactly as the failure
    // claim is: an unconfirmed download must not be told the ZIP includes
    // anything, because there may be no ZIP.
    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals, "confirmed")).toBe(
      `The ZIP includes the tidy CSV for 1 period.${notApplicable}`,
    );
    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals, "intent")).toBe(
      `Pack prepared the artifact ZIP with the tidy CSV for 1 period.${notApplicable}`,
    );
    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals, "unconfirmed")).toBe(
      `If the ZIP download completed, it includes the tidy CSV for 1 period.${notApplicable}`,
    );
  });

  it("never claims a ZIP exists for an unconfirmed download in any success branch", () => {
    const outcomes = [
      filedReturnsSummaryOutcome(true, {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 12,
        rowCount: 40,
      }),
      filedReturnsSummaryOutcome(true, {
        status: "included",
        outcomeOnly: true,
        parsedPeriodCount: 0,
        rowCount: 12,
      }),
      filedReturnsSummaryOutcome(true, {
        status: "included",
        workbookOutcome: "not-applicable",
        outcomeOnly: false,
        parsedPeriodCount: 3,
        rowCount: 9,
      }),
    ];

    for (const outcome of outcomes) {
      const message = filedReturnsSummaryStatusMessage(outcome.safeSignals, "unconfirmed");
      expect(message).not.toBe("");
      expect(message).not.toContain("The ZIP includes");
      expect(message).toContain("If the ZIP download completed");
    }
  });

  it("renders one size-limit reason for all three explicit lifecycle states", () => {
    const outcome = filedReturnsSummaryOutcome(true, {
      status: "failed",
      reasonCategory: "too-large",
    });

    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals, "intent")).toBe(
      "Pack prepared the artifact ZIP without derived summary outputs because the derived summary output exceeded its local size limit.",
    );
    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals, "confirmed")).toBe(
      "Pack saved the artifact files without derived summary outputs because the derived summary output exceeded its local size limit.",
    );
    expect(filedReturnsSummaryStatusMessage(outcome.safeSignals, "unconfirmed")).toBe(
      "If the ZIP download completed, it does not include derived summary outputs because the derived summary output exceeded its local size limit.",
    );
  });

  it("keeps every canonical failure reason distinct and durable in every lifecycle state", () => {
    const failures = [
      {
        outcome: filedReturnsSummaryOutcome(true, undefined),
        reason: "the local result was invalid",
      },
      {
        outcome: filedReturnsSummaryOutcome(true, {
          status: "failed",
          reasonCategory: "too-large",
        }),
        reason: "the derived summary output exceeded its local size limit",
      },
      {
        outcome: filedReturnsSummaryOutcome(true, {
          status: "failed",
          reasonCategory: "workbook-generation-failed",
        }),
        reason: "workbook generation failed",
      },
      {
        outcome: filedReturnsSummaryOutcome(true, {
          status: "failed",
          reasonCategory: "generation-failed",
        }),
        reason: "summary generation failed",
      },
      {
        outcome: filedReturnsSummaryOutcome(true, {
          status: "failed",
          reasonCategory: "identity-rejected",
        }),
        reason:
          "taxpayer identity could not be validated; review the original return in the GST Portal, then retry",
      },
      {
        outcome: filedReturnsSummaryOutcome(true, {
          status: "failed",
          reasonCategory: "identity-unverified",
        }),
        reason:
          "taxpayer identity was not present at its expected place in the portal response; review the original return in the GST Portal, then retry",
      },
      {
        outcome: filedReturnsSummaryOutcome(true, {
          status: "failed",
          reasonCategory: "identity-conflict",
        }),
        reason:
          "filed-return sources disagreed about the taxpayer identity; re-download the affected periods from the GST Portal, then retry",
      },
      {
        outcome: filedReturnsSummaryOutcome(true, {
          status: "failed",
          reasonCategory: "privacy-rejected",
        }),
        reason:
          "privacy boundary rejected the source data; review the original return in the GST Portal, then retry",
      },
    ];

    for (const { outcome } of failures) {
      expect(parseDurableFiledReturnsSignals(outcome.safeSignals)).toEqual(outcome.safeSignals);
    }
    for (const lifecycle of LIFECYCLES) {
      const messages = failures.map(({ outcome, reason }) => {
        const message = filedReturnsSummaryStatusMessage(outcome.safeSignals, lifecycle);
        expect(message).toContain(reason);
        return message;
      });
      expect(new Set(messages).size).toBe(failures.length);
    }
  });

  it("keeps included, outcome-only, and failed summaries distinguishable in every lifecycle", () => {
    const outcomes = [
      filedReturnsSummaryOutcome(true, {
        status: "included",
        outcomeOnly: false,
        parsedPeriodCount: 1,
        rowCount: 2,
      }),
      filedReturnsSummaryOutcome(true, {
        status: "included",
        outcomeOnly: true,
        parsedPeriodCount: 0,
        rowCount: 1,
      }),
      filedReturnsSummaryOutcome(true, {
        status: "failed",
        reasonCategory: "generation-failed",
      }),
    ];

    for (const lifecycle of LIFECYCLES) {
      const messages = outcomes.map((outcome) =>
        filedReturnsSummaryStatusMessage(outcome.safeSignals, lifecycle),
      );
      expect(new Set(messages).size).toBe(outcomes.length);
    }
  });

  it("does not claim a CSV from an unbound workbook-not-applicable marker", () => {
    for (const lifecycle of LIFECYCLES satisfies readonly FiledReturnsSummaryLifecycle[]) {
      expect(
        filedReturnsSummaryStatusMessage(["full-fiscal-year-workbook-not-applicable"], lifecycle),
      ).toBe("");
    }
  });
});
