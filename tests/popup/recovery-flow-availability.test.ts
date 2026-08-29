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
