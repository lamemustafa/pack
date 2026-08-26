import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";
import {
  SinglePeriodCleanupCheckpointError,
  singlePeriodCleanupCheckpointFailureSignal,
} from "../connectors/gst/single-period-cleanup-checkpoint";
import { discardSinglePeriodFiledReturnsZip } from "./filed-returns-single-period-zip";
import {
  clearLegacySinglePeriodStagingRecord,
  clearSinglePeriodBundleLedger,
  readSinglePeriodBundleLedgerStorageState,
  sameSinglePeriodBundleScope,
  type SinglePeriodBundleLedger,
} from "./filed-returns-single-period-bundle-ledger";

export type SinglePeriodBundleCleanupResult =
  | {
      state: "cleared";
      safeSignals: ["single-period-opfs-cleared"];
    }
  | {
      state: "blocked";
      safeSignals: string[];
      transientStagingCleared: boolean;
    };

/**
 * Clears one exact single-period staging bundle without allowing a stale target
 * to remove another run's durable recovery checkpoint.
 */
export async function cleanupSinglePeriodBundleStaging({
  expectedLedger,
  ledgerId,
  onAfterTransientClear,
  scope,
}: {
  expectedLedger?: SinglePeriodBundleLedger;
  ledgerId: string;
  onAfterTransientClear?: () => Promise<boolean>;
  scope: FiledReturnsDownloadScope;
}): Promise<SinglePeriodBundleCleanupResult> {
  let storageState;
  try {
    storageState = await readSinglePeriodBundleLedgerStorageState();
  } catch {
    return blockedBeforeTransientClear("single-period-bundle-state-read-failed");
  }

  if (storageState.state === "malformed") {
    return blockedBeforeTransientClear("single-period-bundle-ledger-malformed");
  }
  if (storageState.state === "legacy" && storageState.ledgerId !== ledgerId) {
    return blockedBeforeTransientClear("single-period-bundle-scope-conflict");
  }
  const storedLedger = storageState.state === "valid" ? storageState.ledger : null;
  if (
    storedLedger &&
    (storedLedger.ledgerId !== ledgerId || !sameSinglePeriodBundleScope(storedLedger.scope, scope))
  ) {
    return blockedBeforeTransientClear("single-period-bundle-scope-conflict");
  }
  if (
    expectedLedger &&
    (!storedLedger ||
      storedLedger.ledgerId !== expectedLedger.ledgerId ||
      storedLedger.revision !== expectedLedger.revision ||
      !sameSinglePeriodBundleScope(storedLedger.scope, expectedLedger.scope))
  ) {
    return blockedBeforeTransientClear("single-period-bundle-revision-conflict");
  }

  const clearSignals = await discardSinglePeriodFiledReturnsZip(ledgerId);
  if (!clearSignals.includes("single-period-opfs-cleared")) {
    return {
      state: "blocked",
      safeSignals: [...clearSignals, "single-period-opfs-retained"],
      transientStagingCleared: false,
    };
  }

  if (onAfterTransientClear) {
    let checkpointPersisted = false;
    let checkpointFailureStage: Parameters<typeof singlePeriodCleanupCheckpointFailureSignal>[0] =
      "callback-failed";
    try {
      checkpointPersisted = await onAfterTransientClear();
    } catch (error) {
      checkpointFailureStage =
        error instanceof SinglePeriodCleanupCheckpointError ? error.stage : "callback-failed";
    }
    if (!checkpointPersisted) {
      return {
        state: "blocked",
        safeSignals: [
          "single-period-opfs-cleared",
          "single-period-cleanup-checkpoint-failed",
          singlePeriodCleanupCheckpointFailureSignal(checkpointFailureStage),
        ],
        transientStagingCleared: true,
      };
    }
  }

  if (storedLedger) {
    const durableLedgerCleared = await clearSinglePeriodBundleLedger(
      storedLedger.ledgerId,
      storedLedger.revision,
    );
    if (!durableLedgerCleared) {
      return {
        state: "blocked",
        safeSignals: [
          "single-period-opfs-cleared",
          "single-period-cleanup-checkpoint-failed",
          "single-period-bundle-revision-conflict",
        ],
        transientStagingCleared: true,
      };
    }
  } else if (storageState.state === "legacy") {
    const legacyRecordCleared = await clearLegacySinglePeriodStagingRecord(ledgerId);
    if (!legacyRecordCleared) {
      return {
        state: "blocked",
        safeSignals: [
          "single-period-opfs-cleared",
          "single-period-cleanup-checkpoint-failed",
          "single-period-bundle-revision-conflict",
        ],
        transientStagingCleared: true,
      };
    }
  }

  return { state: "cleared", safeSignals: ["single-period-opfs-cleared"] };
}

function blockedBeforeTransientClear(signal: string): SinglePeriodBundleCleanupResult {
  return {
    state: "blocked",
    safeSignals: [signal, "single-period-opfs-retained"],
    transientStagingCleared: false,
  };
}
