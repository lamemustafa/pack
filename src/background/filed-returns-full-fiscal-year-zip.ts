import { browser } from "wxt/browser";
import type { FiledReturnsFullFiscalYearLedger, PortalFlowStepResult } from "../core/contracts";
import type { FiledReturnsDownloadScope } from "../core/contracts";
import {
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
} from "../core/filed-returns-artifacts";
import {
  clearOffscreenFiledReturnLedger,
  closeOffscreenBlobDocument,
  createOffscreenFiledReturnZipUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";
import { observeBrowserDownloadById } from "./download-observer";
import {
  safeFullFiscalYearZipFilename,
  safeSinglePeriodZipFilename,
} from "./filed-returns-download-filename";

const USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS = 45 * 1000;

export async function exportFullFiscalYearZip(
  ledger: FiledReturnsFullFiscalYearLedger,
  completeStep: PortalFlowStepResult,
): Promise<PortalFlowStepResult> {
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
  if (staging.expectedArtifactCount === 0) return completeStep;

  return exportStagedFiledReturnsZip({
    clearSignalPrefix: "full-fiscal-year",
    completeStep,
    ledgerId: ledger.ledgerId,
    scope: ledger.scope,
    safeMessage: "Pack exported the fiscal-year return files as one local zip.",
    startRejectedMessage:
      "Pack prepared the fiscal-year zip, but the browser rejected the final save.",
    unconfirmedMessage:
      "Pack prepared the fiscal-year zip, but the final browser download did not complete.",
    zipFailedMessage:
      "Pack staged the fiscal-year files, but could not prepare the final zip export.",
    zipFilename: safeFullFiscalYearZipFilename(ledger.scope),
    expectedZipEntryCount: staging.expectedArtifactCount,
  });
}

export async function exportSinglePeriodFiledReturnsZip({
  completeStep,
  ledgerId,
  scope,
}: {
  completeStep: PortalFlowStepResult;
  ledgerId: string;
  scope: FiledReturnsDownloadScope;
}): Promise<PortalFlowStepResult> {
  return exportStagedFiledReturnsZip({
    clearSignalPrefix: "single-period",
    completeStep,
    ledgerId,
    scope,
    safeMessage: "Pack exported the selected filed-return files as one local zip.",
    startRejectedMessage:
      "Pack prepared the selected filed-return zip, but the browser rejected the final save.",
    unconfirmedMessage:
      "Pack prepared the selected filed-return zip, but the final browser download did not complete.",
    zipFailedMessage:
      "Pack staged the selected filed-return files, but could not prepare the final zip export.",
    zipFilename: safeSinglePeriodZipFilename(scope),
  });
}

export async function discardSinglePeriodFiledReturnsZip(ledgerId: string): Promise<string> {
  const clearSignal = await clearStagedLedgerSignal(ledgerId, "single-period");
  await closeOffscreenBlobDocument();
  return clearSignal;
}

export async function discardFullFiscalYearFiledReturnsZip(ledgerId: string): Promise<string> {
  const clearSignal = await clearStagedLedgerSignal(ledgerId, "full-fiscal-year");
  await closeOffscreenBlobDocument();
  return clearSignal;
}

async function exportStagedFiledReturnsZip({
  clearSignalPrefix,
  completeStep,
  ledgerId,
  scope,
  safeMessage,
  startRejectedMessage,
  unconfirmedMessage,
  zipFailedMessage,
  zipFilename,
  expectedZipEntryCount,
}: {
  clearSignalPrefix: "full-fiscal-year" | "single-period";
  completeStep: PortalFlowStepResult;
  ledgerId: string;
  scope: FiledReturnsDownloadScope;
  safeMessage: string;
  startRejectedMessage: string;
  unconfirmedMessage: string;
  zipFailedMessage: string;
  zipFilename: string;
  expectedZipEntryCount?: number;
}): Promise<PortalFlowStepResult> {
  const zip = await createOffscreenFiledReturnZipUrl(ledgerId, {
    returnType: scope.returnType,
    artifactTypes: concreteFiledReturnsArtifactTypes(
      normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
    ),
  });
  if (!zip) {
    const stagedLedgerSignal =
      clearSignalPrefix === "full-fiscal-year"
        ? retainedStagedLedgerSignal(clearSignalPrefix)
        : await clearStagedLedgerSignal(ledgerId, clearSignalPrefix);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-export-failed`,
        stagedLedgerSignal,
      ],
      safeMessage: zipFailedMessage,
      ...(clearSignalPrefix === "full-fiscal-year"
        ? {
            userAction: {
              type: "RETRY_PORTAL_GENERATION" as const,
              message: "Retry the retained fiscal-year zip export.",
              canResume: true,
            },
          }
        : {}),
    };
  }

  if (typeof expectedZipEntryCount === "number" && zip.zipEntryCount !== expectedZipEntryCount) {
    await revokeOffscreenBlobUrl(zip.blobUrl);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "full-fiscal-year-zip-entry-count-mismatch",
        `full-fiscal-year-zip-expected-entry-count:${expectedZipEntryCount}`,
        `full-fiscal-year-zip-actual-entry-count:${zip.zipEntryCount}`,
        "full-fiscal-year-opfs-retained",
      ],
      safeMessage:
        "Pack rejected the fiscal-year zip because its staged entry count was incomplete.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry the unresolved periods before exporting the fiscal-year zip.",
        canResume: true,
      },
    };
  }

  let downloadId: number | null = null;
  const armedAt = new Date();
  try {
    downloadId = await browser.downloads.download({
      conflictAction: "uniquify",
      filename: zipFilename,
      saveAs: false,
      url: zip.blobUrl,
    });
  } catch {
    await revokeOffscreenBlobUrl(zip.blobUrl);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-start-rejected`,
        retainedStagedLedgerSignal(clearSignalPrefix),
      ],
      safeMessage: startRejectedMessage,
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
        message: "Allow downloads for Pack, then retry the zip export.",
        canResume: true,
      },
    };
  }

  const observed = await observeBrowserDownloadById(
    browser.downloads,
    downloadId,
    {
      armedAt,
      expectedFileExtensions: [".zip"],
      expectedMimeTypes: ["application/zip", "application/octet-stream"],
      expectedOrigins: [],
      expectedUrlSubstrings: [],
      trustedDownloadIds: new Set([downloadId]),
    },
    USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS,
  );
  await revokeOffscreenBlobUrl(zip.blobUrl);

  if (observed.state !== "completed") {
    const stagedLedgerSignal =
      clearSignalPrefix === "single-period"
        ? await clearStagedLedgerSignal(ledgerId, clearSignalPrefix)
        : retainedStagedLedgerSignal(clearSignalPrefix);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: observed.state === "failed" ? "blocked" : "download-unconfirmed",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-started`,
        `${clearSignalPrefix}-zip-download-unconfirmed`,
        stagedLedgerSignal,
        ...observed.safeSignals,
      ],
      safeMessage: unconfirmedMessage,
      ...(observed.userAction ? { userAction: observed.userAction } : {}),
    };
  }

  const stagedLedgerSignal =
    clearSignalPrefix === "full-fiscal-year"
      ? retainedStagedLedgerSignal(clearSignalPrefix)
      : await clearStagedLedgerSignal(ledgerId, clearSignalPrefix);
  if (clearSignalPrefix === "single-period") {
    await closeOffscreenBlobDocument();
  }

  return {
    ...completeStep,
    safeSignals: [
      ...completeStep.safeSignals,
      `${clearSignalPrefix}-zip-download-started`,
      `${clearSignalPrefix}-zip-downloaded`,
      `${clearSignalPrefix}-zip-entry-count:${zip.zipEntryCount}`,
      stagedLedgerSignal,
      ...observed.safeSignals,
    ],
    safeMessage,
  };
}

function fullFiscalYearStagingRequirement(ledger: FiledReturnsFullFiscalYearLedger): {
  expectedArtifactCount: number;
  missingArtifactCount: number;
} {
  let expectedArtifactCount = 0;
  let missingArtifactCount = 0;
  for (const target of ledger.targets) {
    if (target.status === "not-filed") continue;
    const signals = new Set(target.safeSignals);
    for (const artifactType of concreteFiledReturnsArtifactTypes(target.artifactType)) {
      if (signals.has(`filed-return-artifact-unavailable:${artifactType}`)) continue;
      expectedArtifactCount += 1;
      if (!signals.has(`full-fiscal-year-opfs-staged:${artifactType}`)) {
        missingArtifactCount += 1;
      }
    }
  }
  return { expectedArtifactCount, missingArtifactCount };
}

function retainedStagedLedgerSignal(prefix: "full-fiscal-year" | "single-period"): string {
  return `${prefix}-opfs-retained`;
}

async function clearStagedLedgerSignal(
  ledgerId: string,
  prefix: "full-fiscal-year" | "single-period",
): Promise<string> {
  return (await clearOffscreenFiledReturnLedger(ledgerId)) === "cleared"
    ? `${prefix}-opfs-cleared`
    : `${prefix}-opfs-clear-failed`;
}
