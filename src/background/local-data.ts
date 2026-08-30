import { browser } from "wxt/browser";
import type { FiledReturnsFullFiscalYearLedger } from "../connectors/gst/filed-returns-contracts";
import { isCleanedZipPhase } from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import {
  readActiveFiledReturnsRunStorageState,
  runFiledReturnsOperationCriticalSection,
} from "./filed-returns-active-run";
import {
  hasInconsistentFullFiscalYearCompletion,
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
import { hasArtifactAcquisitionCheckpoint } from "./artifact-acquisition-state";
import { readCurrentFiledReturnsTargetReviewSummary } from "./filed-returns-target-review";
import {
  clearLedgerPlans,
  readPlanLedgersStorageState,
  readRetainedPlanLedgers,
} from "./filed-returns-full-fiscal-year-run-state";
import {
  clearAllSupportedFullFiscalYearLedgerPlans,
  readAllSupportedPlanLedgersStorageState,
} from "./filed-returns-all-supported-full-fiscal-year-run-state";

export interface PackLocalDataDeps {
  clearableLocalStorageKeys: readonly string[];
  storageKeys: {
    activeRun: string;
    allSupportedFullFiscalYearLedgerIndex?: string;
    fullFiscalYearLedger: string;
    fullFiscalYearLedgerIndex?: string;
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
  let hasUnresolvedRecoveryState: boolean;
  try {
    hasUnresolvedRecoveryState = await hasUnresolvedFiledReturnsRecoveryState(deps);
  } catch {
    return {
      ok: false,
      error:
        "Pack could not verify retained artifact recovery. Retry clearing local data before removing saved state.",
    };
  }
  if (hasUnresolvedRecoveryState) {
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
  const planLedgers = await readPlanLedgersStorageState(deps);
  requiresBroadStagingClear ||= planLedgers.state === "malformed";
  const allSupportedPlanLedgers = deps.storageKeys.allSupportedFullFiscalYearLedgerIndex
    ? await readAllSupportedPlanLedgersStorageState(deps)
    : { state: "valid" as const, ledgers: [] };
  requiresBroadStagingClear ||= allSupportedPlanLedgers.state === "malformed";

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
  if (!requiresBroadStagingClear && planLedgers.state === "valid") {
    for (const planLedger of planLedgers.ledgers) {
      const clearSignals = await discardFullFiscalYearFiledReturnsZip(planLedger.ledgerId);
      if (!clearSignals.includes("full-fiscal-year-opfs-cleared")) {
        return {
          ok: false,
          error:
            "Pack could not clear retained fiscal-year files. Retry clearing local data before removing the saved ledger.",
        };
      }
    }
  }
  if (!requiresBroadStagingClear && allSupportedPlanLedgers.state === "valid") {
    for (const planLedger of allSupportedPlanLedgers.ledgers) {
      const clearSignals = await discardFullFiscalYearFiledReturnsZip(planLedger.ledgerId);
      if (!clearSignals.includes("full-fiscal-year-opfs-cleared")) {
        return {
          ok: false,
          error:
            "Pack could not clear retained fiscal-year files. Retry clearing local data before removing the saved ledger.",
        };
      }
    }
  }

  await browser.storage.session.clear();
  await clearLedgerPlans(deps);
  await clearAllSupportedFullFiscalYearLedgerPlans(deps);
  await browser.storage.local.remove([...deps.clearableLocalStorageKeys]);
  return { ok: true, cleared: true };
}

async function hasUnresolvedFiledReturnsRecoveryState(deps: PackLocalDataDeps): Promise<boolean> {
  const activeRunState = await readActiveFiledReturnsRunStorageState({
    storageKeys: { activeRun: deps.storageKeys.activeRun },
  });
  if (activeRunState.state === "valid") return true;

  const targetReviewSummary = await readCurrentFiledReturnsTargetReviewSummary({
    storageKeys: { targetReview: deps.storageKeys.targetReview },
  });
  if (targetReviewSummary) return true;

  // Direct portal artifact actions have their own session-only recovery record.
  // Clearing it would discard the exact target/download ownership that prevents
  // a later start from repeating an externally visible download.
  if (await hasArtifactAcquisitionCheckpoint()) return true;

  const ledger = await readLocalValue<unknown>(deps.storageKeys.fullFiscalYearLedger);
  if (
    isFullFiscalYearLedger(ledger) &&
    (hasUnresolvedZipState(ledger) || isUnresolvedFullFiscalYearLedger(ledger))
  ) {
    return true;
  }
  const retainedLedgers = await readRetainedPlanLedgers(deps);
  if (
    retainedLedgers.some(
      (planLedger) =>
        hasUnresolvedZipState(planLedger) || isUnresolvedFullFiscalYearLedger(planLedger),
    )
  ) {
    return true;
  }
  // The Options-page clear action is an explicit discard route for every
  // all-supported plan. It deletes that plan's staged files before removing
  // the persisted ledger, so it cannot resume or mark an unresolved target
  // complete on a later start.
  return false;
}

function hasUnresolvedZipState(ledger: {
  zipDownloadAttempt?: unknown;
  zipPhase?: FiledReturnsFullFiscalYearLedger["zipPhase"];
}): boolean {
  if (ledger.zipDownloadAttempt !== undefined) return true;
  return ledger.zipPhase !== undefined && !isCleanedZipPhase(ledger.zipPhase);
}

function isUnresolvedFullFiscalYearLedger(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  if (hasInconsistentFullFiscalYearCompletion(ledger)) return true;
  if (ledger.status === "complete" || ledger.status === "cancelled") return false;
  return ledger.targets.some((target) =>
    [
      "pending",
      "running",
      "download-unconfirmed",
      "blocked",
      "failed",
      "manually-observed",
    ].includes(target.status),
  );
}

async function readLocalValue<T>(key: string): Promise<T | null> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? null;
}
