import { browser } from "wxt/browser";
import type { PackMessageResponse } from "../core/messages";
import { readActiveFiledReturnsRunSummary } from "./filed-returns-active-run";
import { isFullFiscalYearLedger } from "./filed-returns-full-fiscal-year-ledger";
import { discardFullFiscalYearFiledReturnsZip } from "./filed-returns-full-fiscal-year-zip";
import { readCurrentFiledReturnsTargetReviewSummary } from "./filed-returns-target-review";

export interface PackLocalDataDeps {
  clearableLocalStorageKeys: readonly string[];
  storageKeys: {
    activeRun: string;
    fullFiscalYearLedger: string;
    targetReview: string;
  };
}

export async function clearPackLocalDataWithRecoveryGuard(
  deps: PackLocalDataDeps,
): Promise<PackMessageResponse> {
  if (await hasUnresolvedFiledReturnsRecoveryState(deps)) {
    return {
      ok: false,
      error:
        "Pack has unresolved filed-return recovery state. Cancel or resolve the run before clearing local data.",
    };
  }

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  if (isFullFiscalYearLedger(ledger)) {
    const clearSignal = await discardFullFiscalYearFiledReturnsZip(ledger.ledgerId);
    if (clearSignal !== "full-fiscal-year-opfs-cleared") {
      return {
        ok: false,
        error:
          "Pack could not clear retained fiscal-year files. Retry clearing local data before removing the saved ledger.",
      };
    }
  }

  await browser.storage.session.clear();
  await browser.storage.local.remove([...deps.clearableLocalStorageKeys]);
  return { ok: true, cleared: true };
}

async function hasUnresolvedFiledReturnsRecoveryState(deps: PackLocalDataDeps): Promise<boolean> {
  const activeRunSummary = await readActiveFiledReturnsRunSummary({
    storageKeys: { activeRun: deps.storageKeys.activeRun },
  });
  if (activeRunSummary) return true;

  const targetReviewSummary = await readCurrentFiledReturnsTargetReviewSummary({
    storageKeys: { targetReview: deps.storageKeys.targetReview },
  });
  if (targetReviewSummary) return true;

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  return isFullFiscalYearLedger(ledger) && isUnresolvedFullFiscalYearLedger(ledger);
}

function isUnresolvedFullFiscalYearLedger(ledger: unknown): boolean {
  if (!isFullFiscalYearLedger(ledger)) return false;
  if (ledger.status === "complete" || ledger.status === "cancelled") return false;
  return ledger.targets.some((target) =>
    ["pending", "running", "download-unconfirmed", "blocked", "failed"].includes(target.status),
  );
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}
