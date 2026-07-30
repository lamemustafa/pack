import { browser } from "wxt/browser";
import type { FiledReturnsFullFiscalYearLedger } from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import {
  readActiveFiledReturnsRunStorageState,
  runFiledReturnsOperationCriticalSection,
} from "./filed-returns-active-run";
import {
  isFullFiscalYearLedger,
  recoverableFullFiscalYearLedgerId,
} from "./filed-returns-full-fiscal-year-ledger";
import { discardFullFiscalYearFiledReturnsZip } from "./filed-returns-full-fiscal-year-zip";
import { discardSinglePeriodFiledReturnsZip } from "./filed-returns-single-period-zip";
import { discardAllFiledReturnsStaging } from "./filed-returns-staged-zip";
import {
  InvalidSinglePeriodStagingRecordError,
  readSinglePeriodStagingRecord,
} from "./filed-returns-artifact-progress";
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
  return runFiledReturnsOperationCriticalSection(() => clearPackLocalDataWithinOperation(deps));
}

async function clearPackLocalDataWithinOperation(
  deps: PackLocalDataDeps,
): Promise<PackMessageResponse> {
  if (await hasUnresolvedFiledReturnsRecoveryState(deps)) {
    return {
      ok: false,
      error:
        "Pack has unresolved filed-return recovery state. Cancel or resolve the run before clearing local data.",
    };
  }

  let singlePeriodStaging;
  let requiresBroadStagingClear = false;
  try {
    singlePeriodStaging = await readSinglePeriodStagingRecord();
  } catch (error) {
    if (!(error instanceof InvalidSinglePeriodStagingRecordError)) {
      return {
        ok: false,
        error:
          "Pack could not verify temporary selected-file staging. Retry clearing local data before removing saved state.",
      };
    }
    singlePeriodStaging = error.recoverableLedgerId
      ? { ledgerId: error.recoverableLedgerId, schemaVersion: "1.0" as const }
      : null;
    requiresBroadStagingClear = !error.recoverableLedgerId;
  }

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  const fullFiscalYearLedgerId = isFullFiscalYearLedger(ledger)
    ? ledger.ledgerId
    : recoverableFullFiscalYearLedgerId(ledger);
  requiresBroadStagingClear ||= ledger !== null && !fullFiscalYearLedgerId;

  if (requiresBroadStagingClear) {
    const clearSignals = await discardAllFiledReturnsStaging();
    if (!clearSignals.includes("filed-returns-opfs-cleared")) {
      return {
        ok: false,
        error:
          "Pack could not clear temporary filed-return staging. Retry clearing local data before removing saved state.",
      };
    }
  } else if (singlePeriodStaging) {
    const clearSignals = await discardSinglePeriodFiledReturnsZip(singlePeriodStaging.ledgerId);
    if (!clearSignals.includes("single-period-opfs-cleared")) {
      return {
        ok: false,
        error:
          "Pack could not clear temporary selected-file staging. Retry clearing local data before removing saved state.",
      };
    }
  }
  if (!requiresBroadStagingClear && fullFiscalYearLedgerId) {
    const clearSignals = await discardFullFiscalYearFiledReturnsZip(fullFiscalYearLedgerId);
    if (!clearSignals.includes("full-fiscal-year-opfs-cleared")) {
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
  const activeRunState = await readActiveFiledReturnsRunStorageState({
    storageKeys: { activeRun: deps.storageKeys.activeRun },
  });
  // A malformed marker cannot be acknowledged safely, so Clear local Pack data is
  // its explicit recovery path. Only a valid active lease blocks local-data removal.
  if (activeRunState.state === "valid") return true;

  const targetReviewSummary = await readCurrentFiledReturnsTargetReviewSummary({
    storageKeys: { targetReview: deps.storageKeys.targetReview },
  });
  if (targetReviewSummary) return true;

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  if (!isFullFiscalYearLedger(ledger)) return false;
  return hasUnresolvedZipState(ledger) || isUnresolvedFullFiscalYearLedger(ledger);
}

function hasUnresolvedZipState(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  if (ledger.zipDownloadAttempt !== undefined) return true;
  return ledger.zipPhase !== undefined && ledger.zipPhase !== "cleaned";
}

function isUnresolvedFullFiscalYearLedger(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  if (ledger.status === "complete" || ledger.status === "cancelled") return false;
  return ledger.targets.some((target) =>
    ["pending", "running", "download-unconfirmed", "blocked", "failed"].includes(target.status),
  );
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}
