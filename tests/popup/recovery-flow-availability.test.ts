import { describe, expect, it } from "vitest";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import { getRecoveryFlowAvailability } from "../../src/entrypoints/popup/recovery-flow-availability";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
} from "../background/full-year-completion-fixtures.test-helpers";

describe("full-year recovery flow availability", () => {
  it.each([false, true])(
    "keeps every action named by recovery copy available to a %s build",
    (fullYearFlowAvailable) => {
      const summary = summariseFullFiscalYearLedger(
        makeCompletedRecoveryLedger("download-unconfirmed"),
        RECOVERY_NOW,
      );
      const recovery = getRecoveryFlowAvailability(summary, fullYearFlowAvailable);

      expect(recovery.mentionedActions).not.toHaveLength(0);
      expect(
        recovery.mentionedActions.every((action) => recovery.availableActions.includes(action)),
      ).toBe(true);
      expect(recovery.canContinueFullYear).toBe(fullYearFlowAvailable);
      expect(recovery.availableActions.includes("continue-saved-full-year-run")).toBe(
        fullYearFlowAvailable,
      );
    },
  );

  it("replaces resume-confirmation guidance when a packaged build withholds the flow", () => {
    const summary = summariseFullFiscalYearLedger(
      makeCompletedRecoveryLedger("pending"),
      RECOVERY_NOW,
    );
    summary.flowStep.safeSignals.push("full-fiscal-year-resume-confirmation-required");
    const recovery = getRecoveryFlowAvailability(summary, false);

    expect(recovery.canContinueFullYear).toBe(false);
    expect(recovery.message).toBe(recovery.guidance);
    expect(
      recovery.mentionedActions.every((action) => recovery.availableActions.includes(action)),
    ).toBe(true);
  });
});

describe("withheld full-year copy", () => {
  it.each([
    ["manually-observed"],
    ["not-filed"],
    ["downloaded"],
    ["pending"],
    ["running"],
    ["cancelled"],
  ])("never names a withheld action for a %s target", (targetStatus) => {
    // The status list guarding this was not exhaustive -- `manually-observed` was missing, and its
    // durable message tells the reader to retry or cancel while retry is hidden. Assert the
    // property for every status rather than adding them one at a time as each is found.
    const recovery = getRecoveryFlowAvailability(
      {
        scope: {
          financialYear: "2025-26",
          period: "FULL_FISCAL_YEAR",
          returnType: "GSTR-3B",
          artifactType: "PDF",
        },
        status: "blocked",
        completedPeriods: [],
        updatedAt: "2026-08-30T00:00:00.000Z",
        flowStep: {
          connectorId: "gst",
          scopeId: "gst:filed-returns:GSTR-3B",
          state: "user-action-required",
          safeSignals: [],
          safeMessage: "This target needs an explicit retry or cancellation before Pack continues.",
        },
        fullFiscalYearRecovery: {
          ledgerId: "withheld",
          targetId: "GSTR-3B:2025-26:May",
          expectedRevision: 2,
          targetStatus: targetStatus as never,
        },
      } as never,
      false,
    );

    expect(recovery.canContinueFullYear).toBe(false);
    expect(recovery.availableActions).toEqual(["cancel-saved-full-year-run"]);
    expect(recovery.message).not.toContain("retry");
    expect(
      recovery.mentionedActions.every((action) => recovery.availableActions.includes(action)),
    ).toBe(true);
  });
});
