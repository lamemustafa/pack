import type { PortalFlowStepResult } from "../connectors/gst/filed-returns-contracts";
import type { PackOffscreenFiledReturnZipExpectedEntry } from "../connectors/gst/offscreen-blob-url";
import type { FiledReturnsSummaryPlanEntry } from "../connectors/gst/filed-returns-summary-sheet";
import { filedReturnsSummaryOutcomeCategory } from "../connectors/gst/filed-returns-summary-sheet";
import type { FiledReturnsSummaryStatus } from "../connectors/gst/filed-returns-summary-status";
import { canCompleteAllSupportedFullFiscalYearLedger } from "./filed-returns-all-supported-full-fiscal-year-ledger";
import {
  isAllSupportedFullFiscalYearLedger,
  type FiledReturnsAllSupportedFullFiscalYearLedger,
} from "./filed-returns-all-supported-full-fiscal-year-validation";
import {
  safeAllSupportedFullFiscalYearZipEntryPath,
  safeAllSupportedFullFiscalYearZipFilename,
} from "./filed-returns-download-filename";
import {
  exportStagedFiledReturnsZip,
  opfsClearSignals,
  reconcileStagedZipDownloadById,
  unconfirmedZipReconciliation,
} from "./filed-returns-staged-zip";
import { clearOffscreenFiledReturnLedger, closeOffscreenBlobDocument } from "./offscreen-blob-url";

const ZIP_KIND = "all-supported-full-fiscal-year" as const;

interface ZipDownloadCheckpointCallbacks {
  onBeforeDownloadStart?: (
    requestedAt: Date,
    summaryOutcome: FiledReturnsSummaryStatus,
  ) => Promise<void>;
  onDownloadStarted?: (downloadId: number) => Promise<void>;
}

export async function exportAllSupportedFullFiscalYearZip(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  completeStep: PortalFlowStepResult,
  options: ZipDownloadCheckpointCallbacks = {},
): Promise<PortalFlowStepResult> {
  if (
    !isAllSupportedFullFiscalYearLedger(ledger) ||
    !canCompleteAllSupportedFullFiscalYearLedger(ledger)
  ) {
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "all-supported-full-fiscal-year-zip-target-plan-invalid",
        "all-supported-full-fiscal-year-opfs-retained",
      ],
      safeMessage:
        "Pack did not export the all-returns fiscal-year ZIP because its exact target plan was not complete.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Resume the unresolved fiscal-year targets before exporting the ZIP.",
        canResume: true,
      },
    };
  }

  const staging = allSupportedFullFiscalYearStagingRequirement(ledger);
  if (staging.missingArtifactCount > 0) {
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "all-supported-full-fiscal-year-zip-artifact-staging-incomplete",
        `all-supported-full-fiscal-year-zip-missing-artifact-count:${staging.missingArtifactCount}`,
        "all-supported-full-fiscal-year-opfs-retained",
      ],
      safeMessage:
        "Pack did not stage every required return file, so it did not export an incomplete fiscal-year ZIP.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry the unresolved targets before exporting the fiscal-year ZIP.",
        canResume: true,
      },
    };
  }
  if (staging.expectedArtifactCount === 0) {
    return {
      ...completeStep,
      safeSignals: [...completeStep.safeSignals, "all-supported-full-fiscal-year-no-zip-artifacts"],
      safeMessage:
        "Pack reconciled the selected returns for the fiscal year, but no filed-return artifacts were available for a ZIP.",
    };
  }

  return exportStagedFiledReturnsZip({
    clearSignalPrefix: ZIP_KIND,
    completeStep,
    ledgerId: ledger.ledgerId,
    safeMessage: "Pack exported the selected fiscal-year return files as one local ZIP.",
    startRejectedMessage:
      "Pack prepared the fiscal-year ZIP, but the browser rejected the final save.",
    unconfirmedMessage:
      "Pack prepared the fiscal-year ZIP, but the final browser download did not complete.",
    zipFailedMessage:
      "Pack staged the fiscal-year files, but could not prepare the final ZIP export.",
    zipFilename: safeAllSupportedFullFiscalYearZipFilename(ledger.planRoot.financialYear),
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

export async function reconcileAllSupportedFullFiscalYearZipDownload(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
  completeStep: PortalFlowStepResult,
): Promise<PortalFlowStepResult> {
  if (!isAllSupportedFullFiscalYearLedger(ledger)) {
    return unconfirmedZipReconciliation(
      ZIP_KIND,
      completeStep,
      "all-supported-full-fiscal-year-zip-ledger-invalid",
    );
  }
  return reconcileStagedZipDownloadById(ZIP_KIND, ledger, completeStep);
}

export async function discardAllSupportedFullFiscalYearFiledReturnsZip(
  ledgerId: string,
): Promise<string[]> {
  const clearSignals = opfsClearSignals(await clearOffscreenFiledReturnLedger(ledgerId), ZIP_KIND);
  await closeOffscreenBlobDocument();
  return clearSignals;
}

function allSupportedFullFiscalYearStagingRequirement(
  ledger: FiledReturnsAllSupportedFullFiscalYearLedger,
): {
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
    for (const artifactType of target.concreteArtifactTypes) {
      const expectedEntry: PackOffscreenFiledReturnZipExpectedEntry = {
        artifactType,
        entryNames: [safeAllSupportedFullFiscalYearZipEntryPath(target, artifactType, ".pdf")],
        returnType: target.returnType,
      };
      if (artifactType === "JSON") {
        expectedEntry.entryNames = [
          safeAllSupportedFullFiscalYearZipEntryPath(target, artifactType, ".json"),
        ];
      } else if (artifactType === "EXCEL") {
        expectedEntry.entryNames = [
          safeAllSupportedFullFiscalYearZipEntryPath(target, artifactType, ".xls"),
          safeAllSupportedFullFiscalYearZipEntryPath(target, artifactType, ".xlsx"),
        ];
      }
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
        period: target.period,
        returnType: target.returnType,
      });
      if (outcomeCategory !== "staged") continue;
      expectedEntries.push(expectedEntry);
      if (!signals.has(`${ZIP_KIND}-opfs-staged:${artifactType}`)) missingArtifactCount += 1;
    }
  }
  return {
    expectedArtifactCount: expectedEntries.length,
    expectedEntries,
    missingArtifactCount,
    summaryPlan,
  };
}
