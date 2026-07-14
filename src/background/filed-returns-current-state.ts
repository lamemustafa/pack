import { browser } from "wxt/browser";
import type { FiledReturnsFlowSummary, FiledReturnsFullFiscalYearLedger } from "../core/contracts";
import { isFullFiscalYearScope } from "../core/filed-returns-scope";
import { readActiveFiledReturnsRunSummary } from "./filed-returns-active-run";
import { summariseFullFiscalYearLedger } from "./filed-returns-full-fiscal-year";
import {
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
  const completionSummary = await readSessionValue<FiledReturnsFlowSummary>(
    deps.storageKeys.completion,
  );
  const activeRunSummary = await readActiveFiledReturnsRunSummary({
    storageKeys: { activeRun: deps.storageKeys.activeRun },
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (activeRunSummary) return activeRunSummary;

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  if (isFullFiscalYearLedger(ledger) && isRetainedZipRetrySummary(completionSummary, ledger)) {
    return completionSummary;
  }
  if (isFullFiscalYearLedger(ledger) && isActionableFullFiscalYearLedger(ledger)) {
    return summariseFullFiscalYearLedger(ledger, deps.now?.());
  }

  const targetReviewSummary = await readCurrentFiledReturnsTargetReviewSummary({
    storageKeys: { targetReview: deps.storageKeys.targetReview },
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (targetReviewSummary) return targetReviewSummary;

  if (isFullFiscalYearLedger(ledger) && isNewerSinglePeriodSummary(completionSummary, ledger)) {
    return completionSummary;
  }

  if (isFullFiscalYearLedger(ledger)) return summariseFullFiscalYearLedger(ledger, deps.now?.());

  return completionSummary;
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

async function readSessionValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.session.get(key);
  return (values[key] as T | undefined) ?? null;
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}
