import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import type { PackOffscreenFiledReturnZipExpectedEntry } from "../connectors/gst/offscreen-blob-url";
import {
  clearAllOffscreenFiledReturnLedgers,
  closeOffscreenBlobDocument,
  createOffscreenFiledReturnZipUrl,
  revokeOffscreenBlobUrl,
  type OffscreenFiledReturnClearResult,
} from "./offscreen-blob-url";
import { observeBrowserDownloadById } from "./download-observer";
import { safeFiledReturnZipEntryPath } from "./filed-returns-download-filename";
import { installPackDownloadFilenameReassertion } from "./pack-download-filename-reassertion";
import { isRequestedFilenameOverridden } from "./download-filename-comparison";

const USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS = 45 * 1000;

export interface StagedFiledReturnsZipClearResult {
  cleanupCheckpointVerified: boolean;
  opfsCleared: boolean;
  safeSignals: string[];
}

export async function discardAllFiledReturnsStaging(): Promise<string[]> {
  const clearSignals = opfsClearSignals(
    await clearAllOffscreenFiledReturnLedgers(),
    "filed-returns",
  );
  await closeOffscreenBlobDocument();
  return clearSignals;
}

export async function exportStagedFiledReturnsZip({
  clearSignalPrefix,
  completeStep,
  ledgerId,
  scope,
  safeMessage,
  startRejectedMessage,
  unconfirmedMessage,
  zipFailedMessage,
  zipFilename,
  expectedZipEntries,
  expectedZipEntryCount,
  onBeforeDownloadStart,
  onClearStaging,
  onDownloadStarted,
  stagingCleanupCheckpointFailedMessage,
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
  expectedZipEntries?: readonly PackOffscreenFiledReturnZipExpectedEntry[];
  expectedZipEntryCount?: number;
  onBeforeDownloadStart?: (requestedAt: Date) => Promise<void>;
  onClearStaging?: (
    outcome: "downloaded" | "not-downloaded",
  ) => Promise<StagedFiledReturnsZipClearResult>;
  onDownloadStarted?: (downloadId: number) => Promise<void>;
  stagingCleanupCheckpointFailedMessage?: string;
}): Promise<PortalFlowStepResult> {
  if (
    !Number.isInteger(expectedZipEntryCount) ||
    expectedZipEntryCount === undefined ||
    expectedZipEntryCount < 1 ||
    !expectedZipEntries
  ) {
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-entry-plan-invalid`,
        retainedStagedLedgerSignal(clearSignalPrefix),
      ],
      safeMessage: zipFailedMessage,
    };
  }
  const zip = await createOffscreenFiledReturnZipUrl(ledgerId, {
    returnType: scope.returnType,
    entryCount: expectedZipEntryCount,
    entries: expectedZipEntries,
  });
  if (zip.status !== "created") {
    const stagingClear = onClearStaging ? await onClearStaging("not-downloaded") : null;
    const stagedLedgerSignals = stagingClear?.safeSignals ?? [
      retainedStagedLedgerSignal(clearSignalPrefix),
    ];
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-export-failed`,
        ...(zip.errorCategory
          ? [`${clearSignalPrefix}-zip-export-error:${zip.errorCategory}`]
          : []),
        ...stagedLedgerSignals,
      ],
      safeMessage:
        stagingClear?.opfsCleared && !stagingClear.cleanupCheckpointVerified
          ? (stagingCleanupCheckpointFailedMessage ?? zipFailedMessage)
          : zipFailedMessage,
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
        `${clearSignalPrefix}-zip-entry-count-mismatch`,
        `${clearSignalPrefix}-zip-expected-entry-count:${expectedZipEntryCount}`,
        `${clearSignalPrefix}-zip-actual-entry-count:${zip.zipEntryCount}`,
        retainedStagedLedgerSignal(clearSignalPrefix),
      ],
      safeMessage:
        clearSignalPrefix === "full-fiscal-year"
          ? "Pack rejected the fiscal-year zip because its staged entry count was incomplete."
          : "Pack rejected the selected zip because its staged artifact set was incomplete.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message:
          clearSignalPrefix === "full-fiscal-year"
            ? "Retry the unresolved periods before exporting the fiscal-year zip."
            : "Retry the selected period so Pack can rebuild the exact artifact set.",
        canResume: true,
      },
    };
  }

  let downloadId: number | null = null;
  const armedAt = new Date();
  try {
    await onBeforeDownloadStart?.(armedAt);
  } catch {
    await revokeOffscreenBlobUrl(zip.blobUrl);
    const stagingClear = onClearStaging ? await onClearStaging("not-downloaded") : null;
    const stagedLedgerSignals = stagingClear?.safeSignals ?? [
      retainedStagedLedgerSignal(clearSignalPrefix),
    ];
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-state-persist-failed`,
        ...stagedLedgerSignals,
      ],
      safeMessage:
        stagingClear?.opfsCleared && !stagingClear.cleanupCheckpointVerified
          ? (stagingCleanupCheckpointFailedMessage ?? zipFailedMessage)
          : "Pack did not start the ZIP download because it could not save a safe recovery checkpoint.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry the ZIP handoff after Pack can save its local recovery state.",
        canResume: true,
      },
    };
  }
  if (Boolean(onBeforeDownloadStart) !== Boolean(onDownloadStarted)) {
    await revokeOffscreenBlobUrl(zip.blobUrl);
    const stagingClear = onClearStaging ? await onClearStaging("not-downloaded") : null;
    const stagedLedgerSignals = stagingClear?.safeSignals ?? [
      retainedStagedLedgerSignal(clearSignalPrefix),
    ];
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-checkpoint-incomplete`,
        ...stagedLedgerSignals,
      ],
      safeMessage:
        stagingClear?.opfsCleared && !stagingClear.cleanupCheckpointVerified
          ? (stagingCleanupCheckpointFailedMessage ?? zipFailedMessage)
          : "Pack did not start the ZIP download because its recovery callbacks were incomplete.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Retry after Pack can save both ZIP recovery checkpoints.",
        canResume: true,
      },
    };
  }
  const filenameReservation = installPackDownloadFilenameReassertion().reserve(
    zip.blobUrl,
    zipFilename,
  );
  try {
    downloadId = await browser.downloads.download({
      conflictAction: "uniquify",
      filename: zipFilename,
      saveAs: false,
      url: zip.blobUrl,
    });
  } catch {
    filenameReservation.release();
    await revokeOffscreenBlobUrl(zip.blobUrl);
    const stagingClear = onClearStaging ? await onClearStaging("not-downloaded") : null;
    const stagedLedgerSignals = stagingClear?.safeSignals ?? [
      retainedStagedLedgerSignal(clearSignalPrefix),
    ];
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "blocked",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-start-rejected`,
        ...stagedLedgerSignals,
      ],
      safeMessage:
        stagingClear?.opfsCleared && !stagingClear.cleanupCheckpointVerified
          ? (stagingCleanupCheckpointFailedMessage ?? zipFailedMessage)
          : startRejectedMessage,
      userAction: {
        type: "ALLOW_MULTIPLE_DOWNLOADS",
        message: "Allow downloads for Pack, then retry the zip export.",
        canResume: true,
      },
    };
  }

  if (!Number.isSafeInteger(downloadId) || downloadId === null || downloadId < 0) {
    filenameReservation.release();
    await revokeOffscreenBlobUrl(zip.blobUrl);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "download-unconfirmed",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-id-invalid`,
        retainedStagedLedgerSignal(clearSignalPrefix),
      ],
      safeMessage:
        "Pack may have started the ZIP download but could not bind it to a valid browser download ID. Check browser Downloads before taking another action.",
      userAction: checkBrowserDownloadsAction(clearSignalPrefix),
    };
  }
  filenameReservation.bind(downloadId);

  try {
    await onDownloadStarted?.(downloadId);
  } catch {
    filenameReservation.release();
    await revokeOffscreenBlobUrl(zip.blobUrl);
    await closeOffscreenBlobDocument();
    return {
      ...completeStep,
      state: "download-unconfirmed",
      safeSignals: [
        ...completeStep.safeSignals,
        `${clearSignalPrefix}-zip-download-id-persist-failed`,
        retainedStagedLedgerSignal(clearSignalPrefix),
      ],
      safeMessage:
        "Pack may have started the ZIP download but could not save its browser download ID. Check browser Downloads before taking another action.",
      userAction: checkBrowserDownloadsAction(clearSignalPrefix),
    };
  }

  const observed = await observeBrowserDownloadById(
    browser.downloads,
    downloadId,
    filedReturnsZipObservationContext(downloadId, armedAt),
    USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS,
  );
  await revokeOffscreenBlobUrl(zip.blobUrl);

  if (observed.state !== "completed") {
    filenameReservation.release();
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

  const filenameOutcome = await completedZipFilenameOutcome(downloadId, zipFilename);
  filenameReservation.release();
  const stagingClear = onClearStaging ? await onClearStaging("downloaded") : null;
  const stagedLedgerSignals = stagingClear?.safeSignals ?? [
    retainedStagedLedgerSignal(clearSignalPrefix),
  ];
  if (onClearStaging) {
    await closeOffscreenBlobDocument();
    if (!stagingClear?.opfsCleared) {
      return {
        ...completeStep,
        state: "blocked",
        safeSignals: [
          ...completeStep.safeSignals,
          "single-period-zip-download-started",
          "single-period-zip-downloaded",
          `single-period-zip-entry-count:${zip.zipEntryCount}`,
          ...stagedLedgerSignals,
          ...observed.safeSignals,
          ...filenameOutcome.safeSignals,
        ],
        safeMessage:
          "Pack downloaded the selected ZIP but could not clear its temporary local staging.",
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Retry the selected download after Pack can clear its temporary staging.",
          canResume: true,
        },
      };
    }
    if (!stagingClear.cleanupCheckpointVerified) {
      return {
        ...completeStep,
        state: "blocked",
        safeSignals: [
          ...completeStep.safeSignals,
          "single-period-zip-download-started",
          "single-period-zip-downloaded",
          `single-period-zip-entry-count:${zip.zipEntryCount}`,
          ...stagedLedgerSignals,
          ...observed.safeSignals,
          ...filenameOutcome.safeSignals,
        ],
        safeMessage: stagingCleanupCheckpointFailedMessage ?? zipFailedMessage,
        userAction: {
          type: "RETRY_PORTAL_GENERATION",
          message: "Retry so Pack can reconcile its selected-file recovery checkpoint.",
          canResume: true,
        },
      };
    }
  }

  return {
    ...completeStep,
    safeSignals: [
      ...completeStep.safeSignals,
      `${clearSignalPrefix}-zip-download-started`,
      `${clearSignalPrefix}-zip-downloaded`,
      `${clearSignalPrefix}-zip-entry-count:${zip.zipEntryCount}`,
      ...stagedLedgerSignals,
      ...observed.safeSignals,
      ...filenameOutcome.safeSignals,
    ],
    safeMessage: filenameOutcome.safeMessage
      ? `${safeMessage} ${filenameOutcome.safeMessage}`
      : safeMessage,
  };
}

async function completedZipFilenameOutcome(
  downloadId: number,
  requestedFilename: string,
): Promise<{ safeMessage?: string; safeSignals: string[] }> {
  const [item] = await browser.downloads.search({ id: downloadId }).catch(() => []);
  if (!isRequestedFilenameOverridden(requestedFilename, item?.filename)) {
    return { safeSignals: [] };
  }
  return {
    safeSignals: ["zip-download-filename-overridden"],
    safeMessage:
      "Pack completed the ZIP download, but the browser saved it under a different name. Check browser Downloads before using the file.",
  };
}

export function filedReturnsZipObservationContext(downloadId: number, armedAt: Date) {
  return {
    armedAt,
    expectedFileExtensions: [".zip"],
    expectedMimeTypes: ["application/zip", "application/octet-stream"],
    trustedDownloadIds: new Set([downloadId]),
  };
}

export function checkBrowserDownloadsAction(prefix: "full-fiscal-year" | "single-period") {
  const label = prefix === "full-fiscal-year" ? "fiscal-year ZIP" : "selected-file ZIP";
  return {
    type: "NAVIGATE_TO_SUPPORTED_PAGE" as const,
    message: `Check browser Downloads for the saved ${label}. Do not start another ZIP until this state is resolved.`,
    canResume: true,
  };
}

export function filedReturnsZipExpectedEntries(
  scope: FiledReturnsDownloadScope,
  artifactTypes: readonly FiledReturnsConcreteArtifactType[],
): PackOffscreenFiledReturnZipExpectedEntry[] {
  return artifactTypes.map((artifactType) => ({
    artifactType,
    entryNames:
      artifactType === "PDF"
        ? [safeFiledReturnZipEntryPath(scope, artifactType, ".pdf")]
        : artifactType === "JSON"
          ? [safeFiledReturnZipEntryPath(scope, artifactType, ".json")]
          : [
              safeFiledReturnZipEntryPath(scope, artifactType, ".xls"),
              safeFiledReturnZipEntryPath(scope, artifactType, ".xlsx"),
            ],
  }));
}

function retainedStagedLedgerSignal(prefix: "full-fiscal-year" | "single-period"): string {
  return `${prefix}-opfs-retained`;
}

export function opfsClearSignals(
  result: OffscreenFiledReturnClearResult,
  prefix: "filed-returns" | "full-fiscal-year" | "single-period",
): string[] {
  if (result.status === "cleared") return [`${prefix}-opfs-cleared`];
  if (result.errorCategory === "clear-failed" || result.errorCategory === "opfs-unavailable") {
    return [`${prefix}-opfs-clear-failed`, `${prefix}-opfs-clear-error:${result.errorCategory}`];
  }
  return [
    `${prefix}-opfs-clear-failed`,
    result.errorCategory === "offscreen-response-invalid"
      ? `${prefix}-opfs-clear-offscreen-response-invalid`
      : `${prefix}-opfs-clear-offscreen-unreachable`,
  ];
}
