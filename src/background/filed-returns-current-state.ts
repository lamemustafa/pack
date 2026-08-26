import { fullFiscalYearTargetEvidence } from "./filed-returns-full-fiscal-year-summary";
import { browser } from "wxt/browser";
import type {
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
} from "../connectors/gst/filed-returns-contracts";
import { isFullFiscalYearScope } from "../connectors/gst/filed-returns-scope";
import { readActiveFiledReturnsRunSummary } from "./filed-returns-active-run";
import { readCanonicalFiledReturnsFlowSummary } from "./filed-returns-session-summary";
import { summariseFullFiscalYearLedger } from "./filed-returns-full-fiscal-year";
import {
  hasInconsistentFullFiscalYearCompletion,
  isFullFiscalYearLedger,
  sameFiledReturnsScope,
} from "./filed-returns-full-fiscal-year-ledger";
import { readCurrentFiledReturnsTargetReviewSummary } from "./filed-returns-target-review";

export interface FiledReturnsCurrentStateDeps {
  storageKeys: {
    activeRun: string;
    completion: string;
    fullFiscalYearLedger: string;
    targetReview: string;
  };
  now?: () => Date;
}

export async function readCurrentFiledReturnsFlowSummary(
  deps: FiledReturnsCurrentStateDeps,
): Promise<FiledReturnsFlowSummary | null> {
  const completionSummary = await readCanonicalFiledReturnsFlowSummary(deps.storageKeys.completion);
  const activeRunSummary = await readActiveFiledReturnsRunSummary({
    storageKeys: { activeRun: deps.storageKeys.activeRun },
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (activeRunSummary) {
    // The generic active-run summary carries no per-period detail, and the start
    // message only returns once the whole run finishes -- so mounting or
    // refreshing the panel mid-run showed an empty list precisely while
    // "In progress" and "Waiting" rows are the thing worth seeing.
    //
    // Read the ledger here rather than moving the read above: the ledger lookup
    // costs a storage round trip that the other early returns do not need.
    const activeLedger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
    if (
      isFullFiscalYearLedger(activeLedger) &&
      sameFiledReturnsScope(activeLedger.scope, activeRunSummary.scope)
    ) {
      return {
        ...activeRunSummary,
        targetEvidence: fullFiscalYearTargetEvidence(activeLedger, activeRunSummary.flowStep),
      };
    }
    return activeRunSummary;
  }

  const targetReviewSummary = await readCurrentFiledReturnsTargetReviewSummary({
    storageKeys: { targetReview: deps.storageKeys.targetReview },
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (targetReviewSummary) return targetReviewSummary;

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  if (isFullFiscalYearLedger(ledger) && hasInconsistentFullFiscalYearCompletion(ledger)) {
    return summariseFullFiscalYearLedger(ledger, deps.now?.());
  }
  if (isFullFiscalYearLedger(ledger) && isRetainedZipRetrySummary(completionSummary, ledger)) {
    // Evidence is display-only and never persisted, so this path -- which
    // returns the durable summary rather than re-summarising -- has to rebuild
    // it from the ledger already read above. Otherwise the per-period list is
    // missing in exactly the state where a reader is deciding whether to retry.
    return {
      ...completionSummary,
      targetEvidence: fullFiscalYearTargetEvidence(ledger, completionSummary.flowStep),
    };
  }
  if (isFullFiscalYearLedger(ledger) && isActionableFullFiscalYearLedger(ledger)) {
    return summariseFullFiscalYearLedger(ledger, deps.now?.());
  }

  if (isFullFiscalYearLedger(ledger) && isNewerSinglePeriodSummary(completionSummary, ledger)) {
    return completionSummary;
  }

  if (isFullFiscalYearLedger(ledger)) return summariseFullFiscalYearLedger(ledger, deps.now?.());

  if (completionSummary && !isUnbackedFullFiscalYearCompletion(completionSummary)) {
    return completionSummary;
  }

  return null;
}

function isUnbackedFullFiscalYearCompletion(
  completionSummary: FiledReturnsFlowSummary | null,
): boolean {
  return Boolean(
    completionSummary &&
    completionSummary.status === "complete" &&
    isFullFiscalYearScope(completionSummary.scope),
  );
}

function isRetainedZipRetrySummary(
  completionSummary: FiledReturnsFlowSummary | null,
  ledger: FiledReturnsFullFiscalYearLedger,
): completionSummary is FiledReturnsFlowSummary {
  if (!completionSummary || !isFullFiscalYearScope(completionSummary.scope)) return false;
  if (!sameFiledReturnsScope(completionSummary.scope, ledger.scope)) return false;
  if (!completionSummary.flowStep.safeSignals.includes("full-fiscal-year-opfs-retained")) {
    return false;
  }
  const completionTime = flowSummaryTimestampMs(completionSummary);
  const ledgerTime = Date.parse(ledger.updatedAt);
  return (
    Number.isFinite(completionTime) && Number.isFinite(ledgerTime) && completionTime >= ledgerTime
  );
}

function isActionableFullFiscalYearLedger(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  if (ledger.status === "complete") return false;
  return ledger.targets.some((target) =>
    ["pending", "running", "download-unconfirmed", "blocked", "failed", "cancelled"].includes(
      target.status,
    ),
  );
}

function isNewerSinglePeriodSummary(
  completionSummary: FiledReturnsFlowSummary | null,
  ledger: FiledReturnsFullFiscalYearLedger,
): completionSummary is FiledReturnsFlowSummary {
  if (!completionSummary) return false;
  if (isFullFiscalYearScope(completionSummary.scope)) return false;

  const completionTime = flowSummaryTimestampMs(completionSummary);
  const ledgerTime = Date.parse(ledger.updatedAt);
  return (
    Number.isFinite(completionTime) && Number.isFinite(ledgerTime) && completionTime >= ledgerTime
  );
}

function flowSummaryTimestampMs(summary: FiledReturnsFlowSummary): number {
  const timestamp = summary.completedAt ?? summary.updatedAt;
  if (!timestamp) return Number.NaN;
  return Date.parse(timestamp);
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}
