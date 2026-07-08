import { browser } from "wxt/browser";
import type { FiledReturnsFullFiscalYearLedger, PortalFlowStepResult } from "../core/contracts";
import type { FiledReturnsDownloadScope } from "../core/contracts";
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

const USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS = 90 * 1000;

export async function exportFullFiscalYearZip(
  ledger: FiledReturnsFullFiscalYearLedger,
  completeStep: PortalFlowStepResult,
): Promise<PortalFlowStepResult> {
  if (
    !ledger.targets.some((target) => target.safeSignals.includes("full-fiscal-year-opfs-staged"))
  ) {
    return completeStep;
  }

  return exportStagedFiledReturnsZip({
    clearSignalPrefix: "full-fiscal-year",
    completeStep,
    ledgerId: ledger.ledgerId,
    safeMessage: "Pack exported the fiscal-year return files as one local zip.",
    startRejectedMessage:
      "Pack prepared the fiscal-year zip, but the browser rejected the final save.",
    unconfirmedMessage:
      "Pack prepared the fiscal-year zip, but the final browser download did not complete.",
    zipFailedMessage:
      "Pack staged the fiscal-year files, but could not prepare the final zip export.",
    zipFilename: safeFullFiscalYearZipFilename(ledger.scope),
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

async function exportStagedFiledReturnsZip({
  clearSignalPrefix,
  completeStep,
  ledgerId,
  safeMessage,
  startRejectedMessage,
  unconfirmedMessage,
  zipFailedMessage,
  zipFilename,
}: {
  clearSignalPrefix: "full-fiscal-year" | "single-period";
  completeStep: PortalFlowStepResult;
  ledgerId: string;
  safeMessage: string;
  startRejectedMessage: string;
  unconfirmedMessage: string;
  zipFailedMessage: string;
  zipFilename: string;
}): Promise<PortalFlowStepResult> {
  const zip = await createOffscreenFiledReturnZipUrl(ledgerId);
  if (!zip) {
    const clearSignal = await clearStagedLedgerSignal(ledgerId, clearSignalPrefix);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-export-failed`,
        clearSignal,
      ],
      safeMessage: zipFailedMessage,
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

  const observed = await observeBrowserDownloadById(browser.downloads, downloadId, {
    armedAt,
    expectedFileExtensions: [".zip"],
    expectedMimeTypes: ["application/zip", "application/octet-stream"],
    expectedOrigins: [],
    expectedUrlSubstrings: [],
    trustedDownloadIds: new Set([downloadId]),
  }, USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS);
  await revokeOffscreenBlobUrl(zip.blobUrl);

  if (observed.state !== "completed") {
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: observed.state === "failed" ? "blocked" : "download-unconfirmed",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-started`,
        `${clearSignalPrefix}-zip-download-unconfirmed`,
        retainedStagedLedgerSignal(clearSignalPrefix),
        ...observed.safeSignals,
      ],
      safeMessage: unconfirmedMessage,
      ...(observed.userAction ? { userAction: observed.userAction } : {}),
    };
  }

  const clearSignal = await clearStagedLedgerSignal(ledgerId, clearSignalPrefix);
  await closeOffscreenBlobDocument();

  return {
    ...completeStep,
    safeSignals: [
      ...completeStep.safeSignals,
      `${clearSignalPrefix}-zip-download-started`,
      `${clearSignalPrefix}-zip-downloaded`,
      `${clearSignalPrefix}-zip-entry-count:${zip.zipEntryCount}`,
      clearSignal,
      ...observed.safeSignals,
    ],
    safeMessage,
  };
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
