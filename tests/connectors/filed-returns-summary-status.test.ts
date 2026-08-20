import { describe, expect, it } from "vitest";
import { parseDurableFiledReturnsSignals } from "../../src/connectors/gst/filed-returns-durable-signals";
import {
  filedReturnsSummaryOutcome,
  filedReturnsSummaryStatusMessage,
  type FiledReturnsSummaryLifecycle,
} from "../../src/connectors/gst/filed-returns-summary-status";

const LIFECYCLES = ["intent", "confirmed", "unconfirmed"] as const;

describe("filed-return summary status", () => {
  it("names the return-type workbook boundary while keeping the CSV included", () => {
    const outcome = filedReturnsSummaryOutcome(true, {
      status: "included",
      workbookOutcome: "not-applicable",
      outcomeOnly: false,
      parsedPeriodCount: 1,
      rowCount: 2,
    });
    const expected =
      "The ZIP includes the tidy CSV for 1 period. A consolidated workbook is not available for this return type.";

    expect(outcome.safeSignals).toContain("full-fiscal-year-summary-included");
    expect(outcome.safeSignals).toContain("full-fiscal-year-workbook-not-applicable");
    expect(outcome.safeSignals).not.toContain("full-fiscal-year-summary-failed");
    expect(outcome).not.toHaveProperty("safeMessage");
    for (const lifecycle of LIFECYCLES) {
      expect(filedReturnsSummaryStatusMessage(outcome.safeSignals, lifecycle)).toBe(expected);
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
