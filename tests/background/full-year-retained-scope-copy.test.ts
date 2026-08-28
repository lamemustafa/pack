import { describe, expect, it, vi } from "vitest";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import { responseForExistingLedger } from "../../src/background/filed-returns-full-fiscal-year-run-state";
import { markFullFiscalYearCleanupPending } from "../../src/background/filed-returns-full-fiscal-year-staging";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
} from "./full-year-completion-fixtures.test-helpers";

vi.mock("wxt/browser", () => ({ browser: {} }));

describe("retained full-year scope conflict copy", () => {
  it.each([
    "downloaded-cleanup-pending",
    "no-artifacts-cleanup-pending",
    "legacy-cleanup-pending",
  ] as const)("does not promise another ZIP or discard action for %s", (phase) => {
    const ledger = markFullFiscalYearCleanupPending(
      makeCompletedRecoveryLedger(
        phase === "no-artifacts-cleanup-pending" ? "not-filed" : "downloaded",
      ),
      RECOVERY_NOW,
      phase,
    );
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const original = structuredClone(ledger);
    const response = responseForExistingLedger(ledger, RECOVERY_NOW, {
      blockRetainedStaging: true,
    });
    expect(response?.ok).toBe(true);
    if (!response?.ok || !("flowStep" in response) || !("flowSummary" in response)) {
      throw new Error("Expected a retained-scope response.");
    }
    expect(response.flowStep).toMatchObject({
      state: "blocked",
      safeSignals: [
        "full-fiscal-year-retained-staging-scope-conflict",
        "full-fiscal-year-opfs-retained",
        "full-fiscal-year-final-zip-retry",
      ],
      safeMessage:
        "Pack retained the FY 2025-26 run. Return to that saved selection and resolve it before starting another full-year selection.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Return to the saved full-year selection and resolve it first.",
        canResume: true,
      },
    });
    expect(response.flowSummary?.flowStep).toEqual(response.flowStep);
    expect(response.flowSummary?.scope).toEqual(ledger.scope);
    expect(response.flowSummary?.status).toBe("blocked");
    expect(response.flowSummary?.currentPeriod).toBeUndefined();
    expect(response.flowSummary?.fullFiscalYearRecovery).toBeUndefined();
    expect(ledger).toEqual(original);
  });

  it("keeps an unfinished retained run blocked with its target identity", () => {
    const ledger = {
      ...makeCompletedRecoveryLedger("blocked", { stagedPositive: true }),
      status: "blocked" as const,
    };
    expect(isFullFiscalYearLedger(ledger)).toBe(true);
    const original = structuredClone(ledger);
    const response = responseForExistingLedger(ledger, RECOVERY_NOW, {
      blockRetainedStaging: true,
    });
    expect(response?.ok).toBe(true);
    if (!response?.ok || !("flowStep" in response) || !("flowSummary" in response)) {
      throw new Error("Expected a retained-scope response.");
    }
    expect(response.flowStep?.safeMessage).toBe(
      "Pack retained the FY 2025-26 run. Return to that saved selection and resolve it before starting another full-year selection.",
    );
    expect(response.flowStep?.safeSignals).toEqual([
      "full-fiscal-year-retained-staging-scope-conflict",
      "full-fiscal-year-opfs-retained",
    ]);
    expect(response.flowStep?.userAction?.message).toBe(
      "Return to the saved full-year selection and resolve it first.",
    );
    expect(response.flowSummary?.fullFiscalYearRecovery).toMatchObject({
      ledgerId: ledger.ledgerId,
      expectedRevision: ledger.revision,
      targetId: ledger.targets[0]!.targetId,
      targetStatus: "blocked",
    });
    expect(response.flowSummary?.currentPeriod).toBe(ledger.targets[0]!.period);
    expect(ledger).toEqual(original);
  });
});
