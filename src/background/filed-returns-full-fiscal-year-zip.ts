import { browser } from "wxt/browser";
import type {
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { concreteFiledReturnsArtifactTypesForSelection } from "../connectors/gst/filed-returns-artifacts";
import type { PackOffscreenFiledReturnZipExpectedEntry } from "../connectors/gst/offscreen-blob-url";
import type { FiledReturnsSummaryPlanEntry } from "../connectors/gst/filed-returns-summary-sheet";
import type { FiledReturnsSummaryStatus } from "../connectors/gst/filed-returns-summary-status";
import type { FiledReturnsMonth } from "../connectors/gst/filed-returns-scope";
import {
  type DownloadCreatedItem,
  observeBrowserDownloadById,
  type SafeDownloadObservation,
} from "./download-observer";
import { safeFullFiscalYearZipFilename } from "./filed-returns-download-filename";
import {
  canCompleteFullFiscalYearLedger,
  hasCanonicalFullFiscalYearTargetPlan,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  checkBrowserDownloadsAction,
  exportStagedFiledReturnsZip,
  filedReturnsZipExpectedEntries,
  filedReturnsZipObservationContext,
  opfsClearSignals,
} from "./filed-returns-staged-zip";
import { clearOffscreenFiledReturnLedger, closeOffscreenBlobDocument } from "./offscreen-blob-url";

const USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS = 45 * 1000;

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
  const attempt = ledger.zipDownloadAttempt;
  const downloadId = attempt?.downloadId;
  if (
    ledger.zipPhase !== "download-observing" ||
    !attempt ||
    !Number.isSafeInteger(downloadId) ||
    downloadId === undefined ||
    downloadId < 0
  ) {
    return unconfirmedFullFiscalYearZipReconciliation(
      completeStep,
      "full-fiscal-year-zip-download-id-missing",
    );
  }

  let item: DownloadCreatedItem | undefined;
  try {
    const matches = await browser.downloads.search({ id: downloadId });
    [item] = matches;
  } catch {
    return unconfirmedFullFiscalYearZipReconciliation(
      completeStep,
      "full-fiscal-year-zip-download-search-unavailable",
    );
  }
  if (!item || item.id !== downloadId) {
    return unconfirmedFullFiscalYearZipReconciliation(
      completeStep,
      "full-fiscal-year-zip-download-id-not-found",
    );
  }
  if (!["complete", "in_progress", "interrupted"].includes(item.state ?? "")) {
    return unconfirmedFullFiscalYearZipReconciliation(
      completeStep,
      "full-fiscal-year-zip-download-state-unknown",
    );
  }

  const observed = await observeBrowserDownloadById(
    browser.downloads,
    downloadId,
    filedReturnsZipObservationContext(downloadId, new Date(attempt.requestedAt)),
    USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS,
  );
  return reconciledFullFiscalYearZipStep(completeStep, observed);
}

export async function discardFullFiscalYearFiledReturnsZip(ledgerId: string): Promise<string[]> {
  const clearSignals = opfsClearSignals(
    await clearOffscreenFiledReturnLedger(ledgerId),
    "full-fiscal-year",
  );
  await closeOffscreenBlobDocument();
  return clearSignals;
}

function reconciledFullFiscalYearZipStep(
  completeStep: PortalFlowStepResult,
  observed: SafeDownloadObservation,
): PortalFlowStepResult {
  if (observed.state === "completed") {
    return {
      ...completeStep,
      state: "downloaded",
      safeSignals: [
        ...completeStep.safeSignals,
        "full-fiscal-year-zip-download-started",
        "full-fiscal-year-zip-downloaded",
        "full-fiscal-year-zip-reconciled-by-id",
        "full-fiscal-year-opfs-retained",
        ...observed.safeSignals,
      ],
      safeMessage:
        "Pack confirmed the previously started fiscal-year ZIP by its browser download ID.",
    };
  }
  return {
    ...completeStep,
    state: observed.state === "failed" ? "blocked" : "download-unconfirmed",
    safeSignals: [
      ...completeStep.safeSignals,
      "full-fiscal-year-zip-download-started",
      "full-fiscal-year-zip-download-unconfirmed",
      "full-fiscal-year-zip-reconciled-by-id",
      "full-fiscal-year-opfs-retained",
      ...observed.safeSignals,
    ],
    safeMessage:
      observed.state === "failed"
        ? "The browser reported that the saved fiscal-year ZIP download ended unsuccessfully. Pack retained staging for an explicit retry."
        : "Pack could not yet confirm the saved fiscal-year ZIP download. Check browser Downloads before taking another action.",
    ...(observed.state === "failed"
      ? observed.userAction
        ? { userAction: observed.userAction }
        : {}
      : { userAction: checkBrowserDownloadsAction("full-fiscal-year") }),
  };
}

function unconfirmedFullFiscalYearZipReconciliation(
  completeStep: PortalFlowStepResult,
  signal: string,
): PortalFlowStepResult {
  return {
    ...completeStep,
    state: "download-unconfirmed",
    safeSignals: [
      ...completeStep.safeSignals,
      "full-fiscal-year-zip-download-started",
      "full-fiscal-year-zip-download-unconfirmed",
      signal,
      "full-fiscal-year-opfs-retained",
    ],
    safeMessage:
      "Pack could not confirm the saved fiscal-year ZIP download by its browser ID. Check browser Downloads before taking another action.",
    userAction: checkBrowserDownloadsAction("full-fiscal-year"),
  };
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
      const outcomeCategory =
        target.status === "not-filed"
          ? "not-filed"
          : signals.has(`filed-return-artifact-unavailable:${artifactType}`)
            ? "artifact-unavailable"
            : "staged";
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
