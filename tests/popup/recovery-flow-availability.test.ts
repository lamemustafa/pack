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

describe("an interrupted run in a build that withholds the flow", () => {
  it("keeps the download check and drops only the unavailable remedy", () => {
    // Whole-message replacement discarded "Check Downloads before starting again", which let the
    // reader dismiss the evidence and begin a second run without the check. The remedy is
    // unavailable; the safety instruction is not.
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
          safeSignals: ["full-fiscal-year-run-interrupted"],
          safeMessage:
            "Pack stopped before it could confirm the FY 2025-26 run. Check Downloads before starting again.",
        },
        fullFiscalYearRecovery: {
          ledgerId: "interrupted",
          targetId: "GSTR-3B:2025-26:May",
          expectedRevision: 2,
          targetStatus: "running",
        },
      } as never,
      false,
    );

    // The download check survives whole. "Starting again" is a safety instruction, not an offer of
    // a withheld control: a packaged build still allows single-period downloads, and only
    // continuing this saved full-year run is withheld.
    expect(recovery.message).toContain("Check Downloads before starting again");
    expect(recovery.message).not.toMatch(/\bretry\b|\bresume\b/i);
    expect(
      recovery.mentionedActions.every((action) => recovery.availableActions.includes(action)),
    ).toBe(true);
  });
});

describe("an active run in a build that withholds the flow", () => {
  it("promises no action, because the surface offers none", () => {
    // RecoveryActions takes its runActive path here: a disabled "Run in progress" and no
    // cancellation. Saying "Cancel the saved run below" would name a control that is not rendered.
    const recovery = getRecoveryFlowAvailability(
      {
        scope: {
          financialYear: "2025-26",
          period: "FULL_FISCAL_YEAR",
          returnType: "GSTR-3B",
          artifactType: "PDF",
        },
        status: "running",
        completedPeriods: [],
        updatedAt: "2026-08-30T00:00:00.000Z",
        flowStep: {
          connectorId: "gst",
          scopeId: "gst:filed-returns:GSTR-3B",
          state: "user-action-required",
          safeSignals: ["full-fiscal-year-run-active"],
          safeMessage: "A full fiscal year run for FY 2025-26 is already active.",
        },
        fullFiscalYearRecovery: {
          ledgerId: "active",
          targetId: "GSTR-3B:2025-26:May",
          expectedRevision: 2,
          targetStatus: "running",
        },
      } as never,
      false,
    );

    expect(recovery.availableActions).toEqual([]);
    expect(recovery.mentionedActions).toEqual([]);
    expect(recovery.message).not.toMatch(/cancel/i);
    expect(recovery.message).not.toMatch(/retry/i);
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
