import type {
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { concreteFiledReturnsArtifactTypesForSelection } from "../connectors/gst/filed-returns-artifacts";
import type { PackOffscreenFiledReturnZipExpectedEntry } from "../connectors/gst/offscreen-blob-url";
import type { FiledReturnsSummaryPlanEntry } from "../connectors/gst/filed-returns-summary-sheet";
import { filedReturnsSummaryOutcomeCategory } from "../connectors/gst/filed-returns-summary-sheet";
import type { FiledReturnsSummaryStatus } from "../connectors/gst/filed-returns-summary-status";
import type { FiledReturnsMonth } from "../connectors/gst/filed-returns-scope";
import { safeFullFiscalYearZipFilename } from "./filed-returns-download-filename";
import {
  canCompleteFullFiscalYearLedger,
  hasCanonicalFullFiscalYearTargetPlan,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  exportStagedFiledReturnsZip,
  filedReturnsZipExpectedEntries,
  opfsClearSignals,
  reconcileStagedZipDownloadById,
} from "./filed-returns-staged-zip";
import { clearOffscreenFiledReturnLedger, closeOffscreenBlobDocument } from "./offscreen-blob-url";

interface ZipDownloadCheckpointCallbacks {
  onBeforeDownloadStart?: (
    requestedAt: Date,
    summaryOutcome: FiledReturnsSummaryStatus,
  ) => Promise<void>;
  onDownloadStarted?: (downloadId: number) => Promise<void>;
}

export async function exportFullFiscalYearZip(
  ledger: FiledReturnsFullFiscalYearLedger,
  completeStep: PortalFlowStepResult,
  options: ZipDownloadCheckpointCallbacks = {},
): Promise<PortalFlowStepResult> {
  if (!canCompleteFullFiscalYearLedger(ledger)) {
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        hasCanonicalFullFiscalYearTargetPlan(ledger)
          ? "full-fiscal-year-zip-target-state-invalid"
          : "full-fiscal-year-target-plan-invalid",
        "full-fiscal-year-opfs-retained",
      ],
      safeMessage:
        "Pack did not export the fiscal-year ZIP because its exact eligible-period plan was not complete.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Resume the unresolved fiscal-year periods before exporting the ZIP.",
        canResume: true,
      },
    };
  }
  const staging = fullFiscalYearStagingRequirement(ledger);
  if (staging.missingArtifactCount > 0) {
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "full-fiscal-year-zip-artifact-staging-incomplete",
        `full-fiscal-year-zip-missing-artifact-count:${staging.missingArtifactCount}`,
        "full-fiscal-year-opfs-retained",
      ],
      safeMessage:
        "Pack did not stage every required period file, so it did not export an incomplete fiscal-year zip.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry the unresolved periods before exporting the fiscal-year zip.",
        canResume: true,
      },
    };
  }
  if (staging.expectedArtifactCount === 0) {
    return {
      ...completeStep,
      safeSignals: [...completeStep.safeSignals, "full-fiscal-year-no-zip-artifacts"],
      safeMessage:
        "Pack reconciled the fiscal year, but no filed-return artifacts were available for a ZIP.",
    };
  }

  return exportStagedFiledReturnsZip({
    clearSignalPrefix: "full-fiscal-year",
    completeStep,
    ledgerId: ledger.ledgerId,
    expectedReturnType: ledger.scope.returnType,
    safeMessage: "Pack exported the fiscal-year return files as one local zip.",
    startRejectedMessage:
      "Pack prepared the fiscal-year zip, but the browser rejected the final save.",
    unconfirmedMessage:
      "Pack prepared the fiscal-year zip, but the final browser download did not complete.",
    zipFailedMessage:
      "Pack staged the fiscal-year files, but could not prepare the final zip export.",
    zipFilename: safeFullFiscalYearZipFilename(ledger.scope),
    expectedZipEntryCount: staging.expectedArtifactCount,
    expectedZipEntries: staging.expectedEntries,
    summaryPlan: staging.summaryPlan,
    ...(options.onBeforeDownloadStart
      ? {
          onBeforeDownloadStart: (
            requestedAt: Date,
            _extensionBlobUrlFingerprint: string,
            summaryOutcome: FiledReturnsSummaryStatus,
          ) => options.onBeforeDownloadStart!(requestedAt, summaryOutcome),
        }
      : {}),
    ...(options.onDownloadStarted ? { onDownloadStarted: options.onDownloadStarted } : {}),
  });
}

export async function reconcileFullFiscalYearZipDownload(
  ledger: FiledReturnsFullFiscalYearLedger,
  completeStep: PortalFlowStepResult,
): Promise<PortalFlowStepResult> {
  return reconcileStagedZipDownloadById("full-fiscal-year", ledger, completeStep);
}

export async function discardFullFiscalYearFiledReturnsZip(ledgerId: string): Promise<string[]> {
  const clearSignals = opfsClearSignals(
    await clearOffscreenFiledReturnLedger(ledgerId),
    "full-fiscal-year",
  );
  await closeOffscreenBlobDocument();
  return clearSignals;
}

function fullFiscalYearStagingRequirement(ledger: FiledReturnsFullFiscalYearLedger): {
  expectedArtifactCount: number;
  expectedEntries: PackOffscreenFiledReturnZipExpectedEntry[];
  missingArtifactCount: number;
  summaryPlan: FiledReturnsSummaryPlanEntry[];
} {
  const expectedEntries: PackOffscreenFiledReturnZipExpectedEntry[] = [];
  const summaryPlan: FiledReturnsSummaryPlanEntry[] = [];
  let missingArtifactCount = 0;
  for (const target of ledger.targets) {
    const signals = new Set(target.safeSignals);
    for (const artifactType of concreteFiledReturnsArtifactTypesForSelection(
      target.returnType,
      target.artifactType,
    )) {
      const [expectedEntry] = filedReturnsZipExpectedEntries(
        {
          artifactType,
          financialYear: target.financialYear,
          period: target.period,
          returnType: target.returnType,
        },
        [artifactType],
      );
      if (!expectedEntry) continue;
      const outcomeCategory = filedReturnsSummaryOutcomeCategory(
        target.status,
        signals,
        artifactType,
      );
      summaryPlan.push({
        artifactType,
        entryNames: outcomeCategory === "staged" ? expectedEntry.entryNames : [],
        financialYear: target.financialYear,
        outcomeCategory,
        period: target.period as FiledReturnsMonth,
        returnType: target.returnType,
      });
      if (outcomeCategory !== "staged") continue;
      expectedEntries.push(expectedEntry);
      if (!signals.has(`full-fiscal-year-opfs-staged:${artifactType}`)) {
        missingArtifactCount += 1;
      }
    }
  }
  return {
    expectedArtifactCount: expectedEntries.length,
    expectedEntries,
    missingArtifactCount,
    summaryPlan,
  };
}
