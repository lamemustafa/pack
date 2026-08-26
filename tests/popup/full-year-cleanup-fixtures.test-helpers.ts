import { expect } from "vitest";
import type { FiledReturnsFlowSummary } from "../../src/connectors/gst/filed-returns-contracts";
import { parseDurableFiledReturnsFlowSummary } from "../../src/background/filed-returns-durable-summary";
import { isFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-ledger";
import {
  markFullFiscalYearCleanupPending,
  markFullFiscalYearZipDownloadIntent,
  markFullFiscalYearZipDownloadObserving,
  markFullFiscalYearZipPhase,
} from "../../src/background/filed-returns-full-fiscal-year-staging";
import { summariseFullFiscalYearLedger } from "../../src/background/filed-returns-full-fiscal-year-summary";
import {
  makeCompletedRecoveryLedger,
  RECOVERY_NOW,
} from "../background/full-year-completion-fixtures.test-helpers";

export const CLEANUP_ACTION_CASES = [
  {
    name: "downloaded producer",
    phase: "downloaded-cleanup-pending",
    parsed: false,
    delivery: "One ZIP · saved by your browser",
  },
  {
    name: "no-artifacts producer",
    phase: "no-artifacts-cleanup-pending",
    parsed: false,
    delivery: "No ZIP created · no eligible files",
  },
  {
    name: "legacy producer",
    phase: "legacy-cleanup-pending",
    parsed: false,
    delivery: "One ZIP · browser download not confirmed",
  },
  {
    name: "legacy parser round-trip",
    phase: "legacy-cleanup-pending",
    parsed: true,
    delivery: "One ZIP · browser download not confirmed",
  },
] as const;

export function makeCleanupActionSummary(
  testCase: (typeof CLEANUP_ACTION_CASES)[number] = CLEANUP_ACTION_CASES[0],
): FiledReturnsFlowSummary {
  const completed = makeCompletedRecoveryLedger(
    testCase.phase === "no-artifacts-cleanup-pending" ? "not-filed" : "downloaded",
  );
  expect(isFullFiscalYearLedger(completed)).toBe(true);
  const ledger = markFullFiscalYearCleanupPending(completed, RECOVERY_NOW, testCase.phase);
  expect(isFullFiscalYearLedger(ledger)).toBe(true);
  const produced = summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
  const summary = testCase.parsed
    ? parseDurableFiledReturnsFlowSummary(JSON.parse(JSON.stringify(produced)))
    : produced;
  expect(summary).not.toBeNull();
  if (!summary) throw new Error("The accepted legacy cleanup summary must survive parsing.");
  expect(summary.status).toBe("blocked");
  expect(summary.currentPeriod).toBeUndefined();
  expect(summary.fullFiscalYearRecovery).toBeUndefined();
  expect(summary.completedPeriods).toHaveLength(12);
  if (testCase.parsed) expect(summary.targetEvidence).toBeUndefined();
  return summary;
}

export function makeZipActionSummary(
  phase:
    | "export-pending"
    | "export-retry-pending"
    | "download-started"
    | "download-intent-persisted"
    | "download-observing",
): FiledReturnsFlowSummary {
  const completed = makeCompletedRecoveryLedger("downloaded");
  const ledger =
    phase === "download-observing"
      ? markFullFiscalYearZipDownloadObserving(
          markFullFiscalYearZipDownloadIntent(completed, RECOVERY_NOW),
          RECOVERY_NOW,
          7,
        )
      : phase === "download-intent-persisted"
        ? markFullFiscalYearZipDownloadIntent(completed, RECOVERY_NOW)
        : markFullFiscalYearZipPhase(completed, RECOVERY_NOW, phase);
  expect(isFullFiscalYearLedger(ledger)).toBe(true);
  return summariseFullFiscalYearLedger(ledger, RECOVERY_NOW);
}

export function makeContradictoryCleanupSummary(
  contradiction: "current period" | "target recovery" | "both",
): FiledReturnsFlowSummary {
  const summary = makeCleanupActionSummary();
  const recovery = summariseFullFiscalYearLedger(
    makeCompletedRecoveryLedger("blocked"),
    RECOVERY_NOW,
  );
  if (!recovery.currentPeriod || !recovery.fullFiscalYearRecovery) {
    throw new Error("The canonical blocked fixture must identify its unresolved target.");
  }
  // Deliberately contradictory direct props, not a claim about a valid stored summary.
  if (contradiction !== "target recovery") summary.currentPeriod = recovery.currentPeriod;
  if (contradiction !== "current period") {
    summary.fullFiscalYearRecovery = recovery.fullFiscalYearRecovery;
  }
  return summary;
}
