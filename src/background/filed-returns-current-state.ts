import { browser } from "wxt/browser";
import type { FiledReturnsFlowSummary, FiledReturnsFullFiscalYearLedger } from "../core/contracts";
import { readActiveFiledReturnsRunSummary } from "./filed-returns-active-run";
import { summariseFullFiscalYearLedger } from "./filed-returns-full-fiscal-year";
import { isFullFiscalYearLedger } from "./filed-returns-full-fiscal-year-ledger";
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
  const activeRunSummary = await readActiveFiledReturnsRunSummary({
    storageKeys: { activeRun: deps.storageKeys.activeRun },
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (activeRunSummary) return activeRunSummary;

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  if (isFullFiscalYearLedger(ledger) && isActionableFullFiscalYearLedger(ledger)) {
    return summariseFullFiscalYearLedger(ledger, deps.now?.());
  }

  const targetReviewSummary = await readCurrentFiledReturnsTargetReviewSummary({
    storageKeys: { targetReview: deps.storageKeys.targetReview },
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (targetReviewSummary) return targetReviewSummary;

  if (isFullFiscalYearLedger(ledger)) return summariseFullFiscalYearLedger(ledger, deps.now?.());

  return readSessionValue<FiledReturnsFlowSummary>(deps.storageKeys.completion);
}

function isActionableFullFiscalYearLedger(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  if (ledger.status === "complete") return false;
  return ledger.targets.some((target) =>
    ["pending", "running", "download-unconfirmed", "blocked", "failed", "cancelled"].includes(
      target.status,
    ),
  );
}

async function readSessionValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.session.get(key);
  return (values[key] as T | undefined) ?? null;
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}
