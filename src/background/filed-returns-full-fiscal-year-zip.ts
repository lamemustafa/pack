import { browser } from "wxt/browser";
import type {
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsDownloadScope } from "../connectors/gst/filed-returns-contracts";
import {
  concreteFiledReturnsArtifactTypes,
  type FiledReturnsConcreteArtifactType,
  normaliseFiledReturnsArtifactType,
} from "../connectors/gst/filed-returns-artifacts";
import type { PackOffscreenFiledReturnZipExpectedEntry } from "../connectors/gst/offscreen-blob-url";
import {
  clearAllOffscreenFiledReturnLedgers,
  clearOffscreenFiledReturnLedger,
  closeOffscreenBlobDocument,
  createOffscreenFiledReturnZipUrl,
  revokeOffscreenBlobUrl,
  type OffscreenFiledReturnClearResult,
} from "./offscreen-blob-url";
import { observeBrowserDownloadById } from "./download-observer";
import {
  safeFiledReturnZipEntryPath,
  safeFullFiscalYearZipFilename,
  safeSinglePeriodZipFilename,
} from "./filed-returns-download-filename";
import { installPackDownloadFilenameReassertion } from "./pack-download-filename-reassertion";
import { isRequestedFilenameOverridden } from "./download-filename-comparison";
import {
  canCompleteFullFiscalYearLedger,
  hasCanonicalFullFiscalYearTargetPlan,
} from "./filed-returns-full-fiscal-year-ledger";
import type { DownloadCreatedItem, SafeDownloadObservation } from "./download-observer";

const USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS = 45 * 1000;

interface ZipDownloadCheckpointCallbacks {
  onBeforeDownloadStart?: (requestedAt: Date) => Promise<void>;
  onDownloadStarted?: (downloadId: number) => Promise<void>;
}

interface SinglePeriodZipDownloadCheckpointCallbacks {
  onAfterStagingCleared: (outcome: "downloaded" | "not-downloaded") => Promise<void>;
  onBeforeDownloadStart: (requestedAt: Date) => Promise<void>;
  onDownloadStarted: (downloadId: number) => Promise<void>;
}

interface SinglePeriodStagingClearResult {
  cleanupCheckpointVerified: boolean;
  opfsCleared: boolean;
  safeSignals: string[];
}

export interface SinglePeriodFiledReturnsZipEntryPlan {
  artifactTypes: readonly FiledReturnsConcreteArtifactType[];
  unavailableArtifactTypes: readonly FiledReturnsConcreteArtifactType[];
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
    expectedZipEntries: staging.expectedEntries,
    ...(options.onBeforeDownloadStart
      ? { onBeforeDownloadStart: options.onBeforeDownloadStart }
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
    fullFiscalYearZipObservationContext(downloadId, new Date(attempt.requestedAt)),
    USER_MEDIATED_ZIP_DOWNLOAD_WAIT_MS,
  );
  return reconciledFullFiscalYearZipStep(completeStep, observed);
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
    expectedZipEntries: transientSinglePeriodZipExpectedEntries(scope, entryPlan.artifactTypes),
    expectedZipEntryCount: entryPlan.artifactTypes.length,
    onAfterStagingCleared: options.onAfterStagingCleared,
    ...(options.onBeforeDownloadStart
      ? { onBeforeDownloadStart: options.onBeforeDownloadStart }
      : {}),
    ...(options.onDownloadStarted ? { onDownloadStarted: options.onDownloadStarted } : {}),
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

export async function discardFullFiscalYearFiledReturnsZip(ledgerId: string): Promise<string[]> {
  const clearSignals = await clearStagedLedgerSignals(ledgerId, "full-fiscal-year");
  await closeOffscreenBlobDocument();
  return clearSignals;
}

export async function discardAllFiledReturnsStaging(): Promise<string[]> {
  const clearSignals = opfsClearSignals(
    await clearAllOffscreenFiledReturnLedgers(),
    "filed-returns",
  );
  await closeOffscreenBlobDocument();
  return clearSignals;
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
  expectedZipEntries,
  expectedZipEntryCount,
  onBeforeDownloadStart,
  onDownloadStarted,
  onAfterStagingCleared,
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
  onDownloadStarted?: (downloadId: number) => Promise<void>;
  onAfterStagingCleared?: (outcome: "downloaded" | "not-downloaded") => Promise<void>;
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
    const stagingClear =
      clearSignalPrefix === "single-period"
        ? await clearSinglePeriodExportStaging(ledgerId, onAfterStagingCleared, "not-downloaded")
        : null;
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
          ? singlePeriodCleanupCheckpointFailedMessage()
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
    const stagingClear =
      clearSignalPrefix === "single-period"
        ? await clearSinglePeriodExportStaging(ledgerId, onAfterStagingCleared, "not-downloaded")
        : null;
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
          ? singlePeriodCleanupCheckpointFailedMessage()
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
    const stagingClear =
      clearSignalPrefix === "single-period"
        ? await clearSinglePeriodExportStaging(ledgerId, onAfterStagingCleared, "not-downloaded")
        : null;
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
          ? singlePeriodCleanupCheckpointFailedMessage()
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
    const stagingClear =
      clearSignalPrefix === "single-period"
        ? await clearSinglePeriodExportStaging(ledgerId, onAfterStagingCleared, "not-downloaded")
        : null;
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
          ? singlePeriodCleanupCheckpointFailedMessage()
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
    fullFiscalYearZipObservationContext(downloadId, armedAt),
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
  const stagingClear =
    clearSignalPrefix === "single-period"
      ? await clearSinglePeriodExportStaging(ledgerId, onAfterStagingCleared, "downloaded")
      : null;
  const stagedLedgerSignals = stagingClear?.safeSignals ?? [
    retainedStagedLedgerSignal(clearSignalPrefix),
  ];
  if (clearSignalPrefix === "single-period") {
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
        safeMessage: singlePeriodCleanupCheckpointFailedMessage(),
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

function fullFiscalYearZipObservationContext(downloadId: number, armedAt: Date) {
  return {
    armedAt,
    expectedFileExtensions: [".zip"],
    expectedMimeTypes: ["application/zip", "application/octet-stream"],
    trustedDownloadIds: new Set([downloadId]),
  };
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

function checkBrowserDownloadsAction(prefix: "full-fiscal-year" | "single-period") {
  const label = prefix === "full-fiscal-year" ? "fiscal-year ZIP" : "selected-file ZIP";
  return {
    type: "NAVIGATE_TO_SUPPORTED_PAGE" as const,
    message: `Check browser Downloads for the saved ${label}. Do not start another ZIP until this state is resolved.`,
    canResume: true,
  };
}

function fullFiscalYearStagingRequirement(ledger: FiledReturnsFullFiscalYearLedger): {
  expectedArtifactCount: number;
  expectedEntries: PackOffscreenFiledReturnZipExpectedEntry[];
  missingArtifactCount: number;
} {
  const expectedEntries: PackOffscreenFiledReturnZipExpectedEntry[] = [];
  let missingArtifactCount = 0;
  for (const target of ledger.targets) {
    if (target.status === "not-filed") continue;
    const signals = new Set(target.safeSignals);
    for (const artifactType of selectedArtifactTypesForScope(target)) {
      if (signals.has(`filed-return-artifact-unavailable:${artifactType}`)) continue;
      expectedEntries.push(
        ...transientSinglePeriodZipExpectedEntries(
          {
            artifactType,
            financialYear: target.financialYear,
            period: target.period,
            returnType: target.returnType,
          },
          [artifactType],
        ),
      );
      if (!signals.has(`full-fiscal-year-opfs-staged:${artifactType}`)) {
        missingArtifactCount += 1;
      }
    }
  }
  return {
    expectedArtifactCount: expectedEntries.length,
    expectedEntries,
    missingArtifactCount,
  };
}

function selectedArtifactTypesForScope(
  scope: Pick<FiledReturnsDownloadScope, "artifactType" | "returnType">,
): FiledReturnsConcreteArtifactType[] {
  return scope.returnType === "GSTR-2B" && scope.artifactType === "PDF_AND_EXCEL"
    ? ["PDF", "EXCEL", "JSON"]
    : concreteFiledReturnsArtifactTypes(scope.artifactType);
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

function transientSinglePeriodZipExpectedEntries(
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

function singlePeriodCleanupCheckpointFailedMessage(): string {
  return "Pack cleared the temporary selected-file staging but could not verify its durable recovery checkpoint cleanup.";
}

async function clearSinglePeriodExportStaging(
  ledgerId: string,
  onAfterStagingCleared: ((outcome: "downloaded" | "not-downloaded") => Promise<void>) | undefined,
  outcome: "downloaded" | "not-downloaded",
): Promise<SinglePeriodStagingClearResult> {
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
    if (!onAfterStagingCleared) throw new Error("cleanup callback missing");
    return {
      cleanupCheckpointVerified: true,
      opfsCleared: true,
      safeSignals: ["single-period-opfs-cleared", "single-period-cleanup-checkpoints-cleared"],
    };
  } catch {
    return {
      cleanupCheckpointVerified: false,
      opfsCleared: true,
      safeSignals: ["single-period-opfs-cleared", "single-period-cleanup-checkpoint-failed"],
    };
  }
}

async function clearStagedLedgerSignals(
  ledgerId: string,
  prefix: "full-fiscal-year",
): Promise<string[]> {
  return opfsClearSignals(await clearOffscreenFiledReturnLedger(ledgerId), prefix);
}

function opfsClearSignals(
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
