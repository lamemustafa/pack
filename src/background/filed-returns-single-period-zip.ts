import type {
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypes,
  type FiledReturnsConcreteArtifactType,
  normaliseFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import {
  SinglePeriodCleanupCheckpointError,
  singlePeriodCleanupCheckpointFailureSignal,
} from "../connectors/gst/single-period-cleanup-checkpoint";
import { safeSinglePeriodZipFilename } from "./filed-returns-download-filename";
import {
  exportStagedFiledReturnsZip,
  filedReturnsZipExpectedEntries,
  opfsClearSignals,
  type StagedFiledReturnsZipClearResult,
} from "./filed-returns-staged-zip";
import { clearOffscreenFiledReturnLedger, closeOffscreenBlobDocument } from "./offscreen-blob-url";

interface SinglePeriodZipDownloadCheckpointCallbacks {
  onAfterStagingCleared: (outcome: "downloaded" | "not-downloaded") => Promise<void>;
  onBeforeDownloadStart: (requestedAt: Date) => Promise<void>;
  onDownloadStarted: (downloadId: number) => Promise<void>;
}

export interface SinglePeriodFiledReturnsZipEntryPlan {
  artifactTypes: readonly FiledReturnsConcreteArtifactType[];
  unavailableArtifactTypes: readonly FiledReturnsConcreteArtifactType[];
}

export async function exportSinglePeriodFiledReturnsZip({
  completeStep,
  entryPlan,
  ledgerId,
  options,
  scope,
}: {
  completeStep: PortalFlowStepResult;
  entryPlan: SinglePeriodFiledReturnsZipEntryPlan;
  ledgerId: string;
  options: SinglePeriodZipDownloadCheckpointCallbacks;
  scope: FiledReturnsDownloadScope;
}): Promise<PortalFlowStepResult> {
  if (!entryPlan || !isValidSinglePeriodZipEntryPlan(scope, entryPlan)) {
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "single-period-zip-entry-plan-invalid",
        "single-period-opfs-retained",
      ],
      safeMessage:
        "Pack did not export the selected ZIP because its exact staged artifact plan was invalid.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry the selected period so Pack can rebuild the exact artifact set.",
        canResume: true,
      },
    };
  }
  if (
    !options ||
    typeof options.onAfterStagingCleared !== "function" ||
    typeof options.onBeforeDownloadStart !== "function" ||
    typeof options.onDownloadStarted !== "function"
  ) {
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "single-period-zip-recovery-checkpoint-missing",
        "single-period-opfs-retained",
      ],
      safeMessage:
        "Pack did not export the selected ZIP because its durable cleanup checkpoint was unavailable.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry after Pack can verify its selected-file recovery checkpoint.",
        canResume: true,
      },
    };
  }
  return exportStagedFiledReturnsZip({
    clearSignalPrefix: "single-period",
    completeStep,
    ledgerId,
    scope,
    safeMessage:
      completeStep.state === "partial"
        ? completeStep.safeMessage
        : "Pack exported the selected filed-return files as one local zip.",
    startRejectedMessage:
      "Pack prepared the selected filed-return zip, but the browser rejected the final save.",
    unconfirmedMessage:
      "Pack prepared the selected filed-return zip, but the final browser download did not complete.",
    zipFailedMessage:
      "Pack staged the selected filed-return files, but could not prepare the final zip export.",
    zipFilename: safeSinglePeriodZipFilename(scope),
    expectedZipEntries: filedReturnsZipExpectedEntries(scope, entryPlan.artifactTypes),
    expectedZipEntryCount: entryPlan.artifactTypes.length,
    onBeforeDownloadStart: options.onBeforeDownloadStart,
    onClearStaging: (outcome) =>
      clearSinglePeriodExportStaging(ledgerId, options.onAfterStagingCleared, outcome),
    onDownloadStarted: options.onDownloadStarted,
    stagingCleanupCheckpointFailedMessage: singlePeriodCleanupCheckpointFailedMessage(),
  });
}

export async function discardSinglePeriodFiledReturnsZip(ledgerId: string): Promise<string[]> {
  const clearSignals = opfsClearSignals(
    await clearOffscreenFiledReturnLedger(ledgerId),
    "single-period",
  );
  await closeOffscreenBlobDocument();
  return clearSignals;
}

function isValidSinglePeriodZipEntryPlan(
  scope: FiledReturnsDownloadScope,
  entryPlan: SinglePeriodFiledReturnsZipEntryPlan,
): boolean {
  const selectedArtifactTypes: FiledReturnsConcreteArtifactType[] =
    scope.returnType === "GSTR-2B" &&
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType) === "PDF_AND_EXCEL"
      ? ["PDF", "EXCEL", "JSON"]
      : concreteFiledReturnsArtifactTypes(
          normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
        );
  const unavailableArtifactTypes = [...entryPlan.unavailableArtifactTypes];
  const expectedArtifactTypes = [...entryPlan.artifactTypes];
  if (
    expectedArtifactTypes.length < 1 ||
    expectedArtifactTypes.length > 3 ||
    new Set(expectedArtifactTypes).size !== expectedArtifactTypes.length ||
    new Set(unavailableArtifactTypes).size !== unavailableArtifactTypes.length ||
    expectedArtifactTypes.some((artifactType) => unavailableArtifactTypes.includes(artifactType))
  ) {
    return false;
  }
  const accountedArtifactTypes = new Set([...expectedArtifactTypes, ...unavailableArtifactTypes]);
  if (
    accountedArtifactTypes.size !== selectedArtifactTypes.length ||
    selectedArtifactTypes.some((artifactType) => !accountedArtifactTypes.has(artifactType)) ||
    unavailableArtifactTypes.some((artifactType) => !selectedArtifactTypes.includes(artifactType))
  ) {
    return false;
  }
  return true;
}

function singlePeriodCleanupCheckpointFailedMessage(): string {
  return "Pack cleared the temporary selected-file staging but could not verify its durable recovery checkpoint cleanup.";
}

async function clearSinglePeriodExportStaging(
  ledgerId: string,
  onAfterStagingCleared: ((outcome: "downloaded" | "not-downloaded") => Promise<void>) | undefined,
  outcome: "downloaded" | "not-downloaded",
): Promise<StagedFiledReturnsZipClearResult> {
  const clearSignals = opfsClearSignals(
    await clearOffscreenFiledReturnLedger(ledgerId),
    "single-period",
  );
  const opfsCleared = clearSignals.includes("single-period-opfs-cleared");
  if (!opfsCleared) {
    return {
      cleanupCheckpointVerified: false,
      opfsCleared: false,
      safeSignals: [...clearSignals, "single-period-opfs-retained"],
    };
  }
  try {
    await onAfterStagingCleared?.(outcome);
    if (!onAfterStagingCleared) {
      throw new SinglePeriodCleanupCheckpointError("callback-missing");
    }
    return {
      cleanupCheckpointVerified: true,
      opfsCleared: true,
      safeSignals: ["single-period-opfs-cleared", "single-period-cleanup-checkpoints-cleared"],
    };
  } catch (error) {
    const stage =
      error instanceof SinglePeriodCleanupCheckpointError ? error.stage : "callback-failed";
    return {
      cleanupCheckpointVerified: false,
      opfsCleared: true,
      safeSignals: [
        "single-period-opfs-cleared",
        "single-period-cleanup-checkpoint-failed",
        singlePeriodCleanupCheckpointFailureSignal(stage),
      ],
    };
  }
}
