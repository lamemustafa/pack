import { browser } from "wxt/browser";
import type { FiledReturnsFullFiscalYearLedger, PortalFlowStepResult } from "../core/contracts";
import {
  clearOffscreenFiledReturnLedger,
  closeOffscreenBlobDocument,
  createOffscreenFiledReturnZipUrl,
  revokeOffscreenBlobUrl,
} from "./offscreen-blob-url";
import { observeBrowserDownloadById } from "./download-observer";

export async function exportFullFiscalYearZip(
  ledger: FiledReturnsFullFiscalYearLedger,
  completeStep: PortalFlowStepResult,
): Promise<PortalFlowStepResult> {
  if (
    !ledger.targets.some((target) => target.safeSignals.includes("full-fiscal-year-opfs-staged"))
  ) {
    return completeStep;
  }

  const zip = await createOffscreenFiledReturnZipUrl(ledger.ledgerId);
  if (!zip) {
    const clearSignal = await clearStagedLedgerSignal(ledger.ledgerId);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [...completeStep.safeSignals, "full-fiscal-year-zip-export-failed", clearSignal],
      safeMessage: "Pack staged the fiscal-year files, but could not prepare the final zip export.",
    };
  }

  let downloadId: number | null = null;
  try {
    downloadId = await browser.downloads.download({
      conflictAction: "uniquify",
      filename: fullFiscalYearZipFilename(ledger),
      saveAs: false,
      url: zip.blobUrl,
    });
  } catch {
    await revokeOffscreenBlobUrl(zip.blobUrl);
    const clearSignal = await clearStagedLedgerSignal(ledger.ledgerId);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        "full-fiscal-year-zip-download-start-rejected",
        clearSignal,
      ],
      safeMessage: "Pack prepared the fiscal-year zip, but the browser rejected the final save.",
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
        message: "Allow downloads for Pack, then retry the fiscal-year export.",
        canResume: true,
      },
    };
  }

  const observed = await observeBrowserDownloadById(browser.downloads, downloadId, {
    armedAt: new Date(),
    expectedFileExtensions: [".zip"],
    expectedMimeTypes: ["application/zip", "application/octet-stream"],
    expectedOrigins: [],
    expectedUrlSubstrings: [],
    trustedDownloadIds: new Set([downloadId]),
  });
  await revokeOffscreenBlobUrl(zip.blobUrl);
  const clearSignal = await clearStagedLedgerSignal(ledger.ledgerId);
  await closeOffscreenBlobDocument();

  if (observed.state !== "completed") {
    return {
      ...completeStep,
      state: observed.state === "failed" ? "blocked" : "download-unconfirmed",
      safeSignals: [
        ...completeStep.safeSignals,
        "full-fiscal-year-zip-download-started",
        "full-fiscal-year-zip-download-unconfirmed",
        clearSignal,
        ...observed.safeSignals,
      ],
      safeMessage:
        "Pack prepared the fiscal-year zip, but the final browser download did not complete.",
      ...(observed.userAction ? { userAction: observed.userAction } : {}),
    };
  }

  return {
    ...completeStep,
    safeSignals: [
      ...completeStep.safeSignals,
      "full-fiscal-year-zip-download-started",
      "full-fiscal-year-zip-downloaded",
      `full-fiscal-year-zip-entry-count:${zip.zipEntryCount}`,
      clearSignal,
      ...observed.safeSignals,
    ],
    safeMessage: "Pack exported the fiscal-year return files as one local zip.",
  };
}

async function clearStagedLedgerSignal(ledgerId: string): Promise<string> {
  return (await clearOffscreenFiledReturnLedger(ledgerId)) === "cleared"
    ? "full-fiscal-year-opfs-cleared"
    : "full-fiscal-year-opfs-clear-failed";
}

function fullFiscalYearZipFilename(ledger: FiledReturnsFullFiscalYearLedger): string {
  const returnType = ledger.scope.returnType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `complyeaze-pack/gst/${ledger.scope.financialYear}/${returnType}-full-year.zip`;
}
