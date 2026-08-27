import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { getFiledReturnsFullFiscalYearPeriods } from "../connectors/gst/filed-returns-scope";
import { filedReturnsSummaryStatusMessage } from "../connectors/gst/filed-returns-summary-status";
import type {
  FiledReturnsFlowRunnerDeps,
  FiledReturnsFlowStepCategory,
} from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  createFullFiscalYearLedger,
  hasCanonicalFullFiscalYearTargetPlan,
  hasInconsistentFullFiscalYearCompletion,
  markFullFiscalYearTargetRunning,
  markFullFiscalYearTargetTerminal,
  nextRunnableFullFiscalYearTarget,
  reconcileFullFiscalYearLedgerTargets,
  resumeFullFiscalYearLedger,
  sameFiledReturnsScope,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  blockedFullFiscalYearStep,
  completeFullFiscalYearStep,
  fullFiscalYearZipPhaseStep,
  hasLegacyRetainedStaging,
  summariseFullFiscalYearLedger,
  targetStatusFromFlowStep,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-summary";
import {
  fullFiscalYearErrorStep,
  hasDownloadUnconfirmedTarget,
  hasRetainedFullFiscalYearStaging,
  hasTerminalPositiveTarget,
  persistLedger,
  persistLedgerAndMaybeSummary,
  persistLedgerAndSummary,
  persistSummary,
  readLedgerForScope,
  readLedgersWithPendingZipDownload,
  readLedgerWithPendingZipDownload,
  responseForExistingLedger,
  shouldPersistReconciledLedger,
} from "./filed-returns-full-fiscal-year-run-state";
import {
  completedRunCleanupBlockedStep,
  createFullFiscalYearCleanupPendingState,
  finishFullFiscalYearCleanup,
  mergeRetriedArtifactSignals,
  cleanupPendingPhaseFor,
  markFullFiscalYearCleanupPending,
  markFullFiscalYearRestagingRequired,
  markFullFiscalYearZipDownloadIntent,
  markFullFiscalYearZipDownloadObserving,
  markFullFiscalYearZipManualReview,
  markFullFiscalYearZipPhase,
  requireFullFiscalYearArtifactsStaged,
  restorePersistedFullFiscalYearSummaryOutcome,
  scopeForFullFiscalYearTarget,
} from "./filed-returns-full-fiscal-year-staging";
import {
  discardFullFiscalYearFiledReturnsZip,
  exportFullFiscalYearZip,
  reconcileFullFiscalYearZipDownload,
} from "./filed-returns-full-fiscal-year-zip";
import { getFullFiscalYearTabSessionId } from "./filed-returns-active-tab";
export type SinglePeriodRunner = (
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  options?: {
    onPortalTabSelected?: (tabId: number, tabSessionId: string) => Promise<void>;
    persistSinglePeriodSummary?: boolean;
    requiredPortalTabId?: number;
    requiredPortalTabSessionId?: string;
  },
) => Promise<PackMessageResponse>;

export { summariseFullFiscalYearLedger, targetStatusFromFlowStep };

type FullFiscalYearSystemErrorPredecessor = FiledReturnsFlowStepCategory | "initial";
const MAX_DURABLE_FLOW_SIGNALS = 32;

/**
 * Reconciles one persisted final-ZIP download after Chrome reports a terminal
 * state. The saved browser ID is the boundary: unrelated browser downloads
 * cannot advance or clean a fiscal-year run.
 */
export async function reconcilePendingFullFiscalYearZipDownload(
  downloadId: number,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<boolean> {
  if (!Number.isSafeInteger(downloadId) || downloadId < 0) return false;
  const ledger = await readLedgerWithPendingZipDownload(deps, downloadId);
  if (
    !ledger ||
    ledger.zipPhase !== "download-observing" ||
    ledger.zipDownloadAttempt?.downloadId !== downloadId
  ) {
    return false;
  }
  await reconcilePersistedFullFiscalYearZip(deps, ledger);
  return true;
}

/**
 * Reconciles every persisted final-ZIP ID after an MV3 restart. Each plan is
 * matched only to its exact stored ID; it never scans or adopts an unrelated
 * browser download.
 */
export async function reconcilePersistedFullFiscalYearZipDownload(
  deps: FiledReturnsFlowRunnerDeps,
): Promise<boolean> {
  const ledgers = await readLedgersWithPendingZipDownload(deps);
  const ledgersByDownloadId = new Map<number, FiledReturnsFullFiscalYearLedger[]>();
  for (const ledger of ledgers) {
    const downloadId = ledger.zipDownloadAttempt?.downloadId;
    if (typeof downloadId !== "number" || !Number.isSafeInteger(downloadId) || downloadId < 0)
      continue;
    const owners = ledgersByDownloadId.get(downloadId) ?? [];
    owners.push(ledger);
    ledgersByDownloadId.set(downloadId, owners);
  }

  let handled = false;
  for (const owners of ledgersByDownloadId.values()) {
    if (owners.length === 1) {
      await reconcilePersistedFullFiscalYearZip(deps, owners[0]!);
      handled = true;
      continue;
    }
    await moveDuplicateZipOwnersToManualReview(deps, owners);
    handled = true;
  }
  return handled;
}

export async function startFullFiscalYearDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  runSinglePeriod: SinglePeriodRunner,
  options: { allowExistingLedgerResume?: boolean } = {},
): Promise<PackMessageResponse> {
  const now = deps.now?.() ?? new Date();
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);
  let existingLedger = await readLedgerForScope(deps, scope);
  if (existingLedger && hasInconsistentFullFiscalYearCompletion(existingLedger)) {
    const summary = summariseFullFiscalYearLedger(existingLedger, now);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }
  let sameScopeExistingLedger =
    existingLedger && sameFiledReturnsScope(existingLedger.scope, scope) ? existingLedger : null;
  if (sameScopeExistingLedger && plannedPeriods.length > 0) {
    const reconciledLedger = reconcileFullFiscalYearLedgerTargets(
      sameScopeExistingLedger,
      now,
      plannedPeriods,
    );
    if (!hasCanonicalFullFiscalYearTargetPlan(reconciledLedger)) {
      const step = blockedFullFiscalYearStep(
        "full-fiscal-year-target-plan-invalid",
        sameScopeExistingLedger,
      );
      await persistLedgerAndSummary(deps, sameScopeExistingLedger, step);
      return {
        ok: true,
        flowStep: step,
        flowSummary: toFullFiscalYearSummary(sameScopeExistingLedger, step),
      };
    }
    if (shouldPersistReconciledLedger(sameScopeExistingLedger, reconciledLedger)) {
      await persistLedger(deps, reconciledLedger);
    }
    existingLedger = reconciledLedger;
    sameScopeExistingLedger = reconciledLedger;
  }
  if (
    sameScopeExistingLedger &&
    [
      "downloaded-cleanup-pending",
      "no-artifacts-cleanup-pending",
      "legacy-cleanup-pending",
    ].includes(sameScopeExistingLedger.zipPhase ?? "")
  ) {
    return finishFullFiscalYearCleanup(deps, sameScopeExistingLedger);
  }
  if (sameScopeExistingLedger && hasLegacyRetainedStaging(sameScopeExistingLedger)) {
    const cleanupPendingLedger = markFullFiscalYearCleanupPending(
      sameScopeExistingLedger,
      now,
      "legacy-cleanup-pending",
    );
    const step = fullFiscalYearZipPhaseStep(cleanupPendingLedger)!;
    await persistLedgerAndSummary(deps, cleanupPendingLedger, step);
    return finishFullFiscalYearCleanup(deps, cleanupPendingLedger);
  }
  if (sameScopeExistingLedger?.zipPhase === "download-observing") {
    const downloadId = sameScopeExistingLedger.zipDownloadAttempt?.downloadId;
    const owners =
      typeof downloadId === "number" && Number.isSafeInteger(downloadId) && downloadId >= 0
        ? await readLedgersWithPendingZipDownload(deps, downloadId)
        : [];
    if (owners.length > 1) {
      const reviewLedgers = await moveDuplicateZipOwnersToManualReview(deps, owners);
      const reviewLedger = reviewLedgers.get(sameScopeExistingLedger.ledgerId);
      if (reviewLedger) {
        const flowStep = fullFiscalYearZipPhaseStep(reviewLedger)!;
        return {
          ok: true,
          flowStep,
          flowSummary: toFullFiscalYearSummary(reviewLedger, flowStep),
        };
      }
    }
    return reconcilePersistedFullFiscalYearZip(deps, sameScopeExistingLedger);
  }
  if (
    sameScopeExistingLedger &&
    ["download-intent-persisted", "download-started"].includes(
      sameScopeExistingLedger.zipPhase ?? "",
    )
  ) {
    // A saved intent without a correlated download ID is ambiguous across an
    // MV3 restart. Keep the staged files and require explicit review/discard;
    // a repeated Start must never infer that the previous ZIP may be replayed.
    const reviewLedger = markFullFiscalYearZipManualReview(sameScopeExistingLedger, now);
    const reviewStep = await restorePersistedFullFiscalYearSummaryOutcome(
      deps,
      sameScopeExistingLedger,
      fullFiscalYearZipPhaseStep(reviewLedger)!,
    );
    await persistLedgerAndSummary(deps, reviewLedger, reviewStep);
    return {
      ok: true,
      flowStep: reviewStep,
      flowSummary: toFullFiscalYearSummary(reviewLedger, reviewStep),
    };
  }
  if (
    sameScopeExistingLedger &&
    ["export-pending", "export-retry-pending"].includes(sameScopeExistingLedger.zipPhase ?? "")
  ) {
    return completeRun(deps, sameScopeExistingLedger);
  }
  const replaceCompletedSameScopeLedger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    existingLedger.status === "complete" &&
    canCompleteFullFiscalYearLedger(existingLedger) &&
    !existingLedger.zipDownloadAttempt &&
    !hasRetainedFullFiscalYearStaging(existingLedger) &&
    !options.allowExistingLedgerResume;
  const replaceUnstartedCancelledSameScopeLedger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    existingLedger.status === "cancelled" &&
    !existingLedger.zipDownloadAttempt &&
    !hasTerminalPositiveTarget(existingLedger) &&
    !hasDownloadUnconfirmedTarget(existingLedger) &&
    !hasRetainedFullFiscalYearStaging(existingLedger) &&
    !options.allowExistingLedgerResume;
  if (existingLedger && replaceCompletedSameScopeLedger) {
    const clearSignals = await discardFullFiscalYearFiledReturnsZip(existingLedger.ledgerId);
    if (!clearSignals.includes("full-fiscal-year-opfs-cleared")) {
      // Derived from the phase this ledger already reached, never reset. This
      // call took the default before, which is `downloaded-cleanup-pending` --
      // so retrying the cleanup of a run that never exported a ZIP promoted it
      // to the delivery route and, on completion, to `cleaned-after-download`.
      const cleanupPendingLedger = markFullFiscalYearCleanupPending(
        existingLedger,
        now,
        cleanupPendingPhaseFor(existingLedger.zipPhase),
      );
      const step = completedRunCleanupBlockedStep(cleanupPendingLedger, clearSignals);
      const summary = toFullFiscalYearSummary(cleanupPendingLedger, step);
      await persistLedgerAndSummary(deps, cleanupPendingLedger, step);
      return { ok: true, flowStep: step, flowSummary: summary };
    }
  }
  let ledger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    !replaceCompletedSameScopeLedger &&
    !replaceUnstartedCancelledSameScopeLedger
      ? reconcileFullFiscalYearLedgerTargets(existingLedger, now, plannedPeriods)
      : createFullFiscalYearLedger(scope, now, plannedPeriods);

  if (
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    !replaceCompletedSameScopeLedger &&
    !replaceUnstartedCancelledSameScopeLedger
  ) {
    if (shouldPersistReconciledLedger(existingLedger, ledger)) {
      await persistLedger(deps, ledger);
    }
    const duplicateResponse = responseForExistingLedger(ledger, now, options);
    if (duplicateResponse) return duplicateResponse;
  }

  ledger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    !replaceCompletedSameScopeLedger &&
    !replaceUnstartedCancelledSameScopeLedger
      ? resumeFullFiscalYearLedger(ledger, now)
      : ledger;

  if (ledger.targets.length === 0) {
    ledger = { ...ledger, status: "blocked", updatedAt: now.toISOString() };
    await persistLedger(deps, ledger);
    const step = blockedFullFiscalYearStep("full-fiscal-year-no-eligible-periods", ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

  await persistLedger(deps, ledger);

  // An explicitly confirmed resume may cross a browser restart. Rebind only
  // when that durable tab-session marker differs from this browser session;
  // a matching marker must retain its original tab binding.
  const currentTabSessionId =
    options.allowExistingLedgerResume &&
    ledger.portalTabId !== undefined &&
    ledger.portalTabSessionId !== undefined
      ? await getFullFiscalYearTabSessionId()
      : null;
  let mustRebindPortalTab =
    options.allowExistingLedgerResume &&
    ledger.portalTabId !== undefined &&
    ledger.portalTabSessionId !== undefined &&
    currentTabSessionId !== null &&
    currentTabSessionId !== ledger.portalTabSessionId;

  while (true) {
    const nextTarget = nextRunnableFullFiscalYearTarget(ledger);
    if (!nextTarget) return completeRun(deps, ledger);
    const retryScope = scopeForFullFiscalYearTarget(nextTarget);
    const previousTargetSafeSignals = nextTarget.safeSignals;
    let systemErrorPredecessor: FullFiscalYearSystemErrorPredecessor = "initial";

    ledger = markFullFiscalYearTargetRunning(
      ledger,
      nextTarget.targetId,
      deps.now?.() ?? new Date(),
    );
    await persistLedger(deps, ledger);

    const response = await runSinglePeriod(
      retryScope,
      {
        ...deps,
        onFlowStepObservation: (observation) => {
          deps.onFlowStepObservation?.(observation);
          if (!observation.portalSystemError) {
            systemErrorPredecessor = observation.category;
          }
        },
        persistTargetReview: false,
        stageCapturedDownloads: { bundleKind: "full-fiscal-year", ledgerId: ledger.ledgerId },
      },
      {
        onPortalTabSelected: async (tabId, tabSessionId) => {
          if (ledger.portalTabId !== undefined && !mustRebindPortalTab) return;
          ledger = {
            ...ledger,
            portalTabId: tabId,
            portalTabSessionId: tabSessionId,
            revision: (ledger.revision ?? 1) + 1,
            updatedAt: (deps.now?.() ?? new Date()).toISOString(),
          };
          await persistLedger(deps, ledger);
          mustRebindPortalTab = false;
        },
        persistSinglePeriodSummary: false,
        ...(!mustRebindPortalTab &&
        ledger.portalTabId !== undefined &&
        ledger.portalTabSessionId !== undefined
          ? {
              requiredPortalTabId: ledger.portalTabId,
              requiredPortalTabSessionId: ledger.portalTabSessionId,
            }
          : {}),
      },
    );

    if (!response.ok || !("flowStep" in response)) {
      ledger = markFullFiscalYearTargetTerminal(
        ledger,
        nextTarget.targetId,
        "failed",
        fullFiscalYearErrorStep(nextTarget),
        deps.now?.() ?? new Date(),
      );
      await persistLedger(deps, ledger);
      return response;
    }

    const flowStep = requireFullFiscalYearArtifactsStaged(
      retryScope,
      withFullFiscalYearSystemErrorPredecessor(
        mergeRetriedArtifactSignals(previousTargetSafeSignals, response.flowStep),
        systemErrorPredecessor,
      ),
    );
    const targetStatus = targetStatusFromFlowStep(flowStep);
    ledger = markFullFiscalYearTargetTerminal(
      ledger,
      nextTarget.targetId,
      targetStatus,
      flowStep,
      deps.now?.() ?? new Date(),
    );
    if (
      (targetStatus === "downloaded" || targetStatus === "not-filed") &&
      canCompleteFullFiscalYearLedger(ledger)
    ) {
      ledger = markFullFiscalYearZipPhase(ledger, deps.now?.() ?? new Date(), "export-pending");
    }
    await persistLedgerAndMaybeSummary(deps, ledger, flowStep);

    if (targetStatus === "downloaded" || targetStatus === "not-filed") continue;
    const flowSummary = toFullFiscalYearSummary(ledger, flowStep);
    if (targetStatus !== "download-unconfirmed") {
      await persistSummary(deps, flowSummary);
    }
    return { ...response, flowStep, flowSummary };
  }
}

async function completeRun(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
): Promise<PackMessageResponse> {
  const now = deps.now?.() ?? new Date();
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(ledger.scope.financialYear, now);
  const reconciledLedger =
    plannedPeriods.length > 0
      ? reconcileFullFiscalYearLedgerTargets(ledger, now, plannedPeriods)
      : ledger;
  if (shouldPersistReconciledLedger(ledger, reconciledLedger)) {
    await persistLedger(deps, reconciledLedger);
  }
  if (!canCompleteFullFiscalYearLedger(reconciledLedger)) {
    const signal = hasCanonicalFullFiscalYearTargetPlan(reconciledLedger)
      ? "full-fiscal-year-run-needs-action"
      : "full-fiscal-year-target-plan-invalid";
    const step = blockedFullFiscalYearStep(signal, reconciledLedger);
    await persistLedgerAndSummary(deps, reconciledLedger, step);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(reconciledLedger, step),
    };
  }

  const readyLedger =
    reconciledLedger.zipPhase === "export-pending" ||
    reconciledLedger.zipPhase === "export-retry-pending"
      ? reconciledLedger
      : markFullFiscalYearZipPhase(reconciledLedger, now, "export-pending");
  const step = completeFullFiscalYearStep(readyLedger, now);
  // Persist a resumable pre-export state before the browser download can suspend
  // this MV3 worker. A later start can then retry the retained staged ZIP without
  // re-running already completed portal targets.
  await persistLedger(deps, readyLedger);
  let exportLedger = readyLedger;
  const zipStep = await exportFullFiscalYearZip(readyLedger, step, {
    onBeforeDownloadStart: async (requestedAt, summaryOutcome) => {
      const intentLedger = markFullFiscalYearZipDownloadIntent(exportLedger, requestedAt);
      const phaseStep = fullFiscalYearZipPhaseStep(intentLedger)!;
      const intentStep = {
        ...phaseStep,
        safeSignals: Array.from(new Set([...phaseStep.safeSignals, ...summaryOutcome.safeSignals])),
        safeMessage: [
          phaseStep.safeMessage,
          filedReturnsSummaryStatusMessage(summaryOutcome.safeSignals, "intent"),
        ]
          .filter(Boolean)
          .join(" "),
      };
      await persistLedgerAndSummary(deps, intentLedger, intentStep);
      exportLedger = intentLedger;
    },
    onDownloadStarted: async (downloadId) => {
      const observingLedger = markFullFiscalYearZipDownloadObserving(
        exportLedger,
        deps.now?.() ?? new Date(),
        downloadId,
      );
      if (observingLedger === exportLedger) {
        throw new Error("invalid full-fiscal-year ZIP download ID checkpoint");
      }
      await persistLedger(deps, observingLedger);
      exportLedger = observingLedger;
    },
  });
  if (zipStep.state !== "downloaded") {
    const stagingIncomplete = zipStep.safeSignals.some((signal) =>
      [
        "full-fiscal-year-zip-artifact-staging-incomplete",
        "full-fiscal-year-zip-entry-count-mismatch",
      ].includes(signal),
    );
    const downloadAmbiguous = zipStep.state === "download-unconfirmed";
    const nextLedger = stagingIncomplete
      ? markFullFiscalYearRestagingRequired(exportLedger, now)
      : downloadAmbiguous
        ? exportLedger
        : markFullFiscalYearZipPhase(exportLedger, now, "export-retry-pending");
    const phaseStep = fullFiscalYearZipPhaseStep(nextLedger)!;
    const persistedStep = {
      ...zipStep,
      safeSignals: Array.from(new Set([...zipStep.safeSignals, ...phaseStep.safeSignals])),
    };
    const summary = toFullFiscalYearSummary(nextLedger, persistedStep);
    await persistLedgerAndSummary(deps, nextLedger, persistedStep);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  const cleanupPending = createFullFiscalYearCleanupPendingState(exportLedger, zipStep);
  await persistLedgerAndSummary(deps, cleanupPending.ledger, cleanupPending.step);
  return finishFullFiscalYearCleanup(deps, cleanupPending.ledger, cleanupPending.step);
}

async function reconcilePersistedFullFiscalYearZip(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
): Promise<PackMessageResponse> {
  const now = deps.now?.() ?? new Date();
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(ledger.scope.financialYear, now);
  const reconciledLedger =
    plannedPeriods.length > 0
      ? reconcileFullFiscalYearLedgerTargets(ledger, now, plannedPeriods)
      : ledger;
  if (shouldPersistReconciledLedger(ledger, reconciledLedger)) {
    await persistLedger(deps, reconciledLedger);
  }
  if (!canCompleteFullFiscalYearLedger(reconciledLedger)) {
    const signal = hasCanonicalFullFiscalYearTargetPlan(reconciledLedger)
      ? "full-fiscal-year-zip-target-state-invalid"
      : "full-fiscal-year-target-plan-invalid";
    const step = blockedFullFiscalYearStep(signal, reconciledLedger);
    await persistLedgerAndSummary(deps, reconciledLedger, step);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(reconciledLedger, step),
    };
  }
  ledger = reconciledLedger;
  const completeStep = completeFullFiscalYearStep(ledger, now);
  const zipStep = await restorePersistedFullFiscalYearSummaryOutcome(
    deps,
    ledger,
    await reconcileFullFiscalYearZipDownload(ledger, completeStep),
  );
  if (zipStep.state === "downloaded") {
    const cleanupPending = createFullFiscalYearCleanupPendingState(ledger, zipStep);
    await persistLedgerAndSummary(deps, cleanupPending.ledger, cleanupPending.step);
    return finishFullFiscalYearCleanup(deps, cleanupPending.ledger, cleanupPending.step);
  }

  if (zipStep.state === "blocked") {
    const retryLedger = markFullFiscalYearZipPhase(
      ledger,
      deps.now?.() ?? new Date(),
      "export-retry-pending",
    );
    const retryStep = fullFiscalYearZipPhaseStep(retryLedger)!;
    const persistedStep = {
      ...zipStep,
      safeSignals: Array.from(new Set([...zipStep.safeSignals, ...retryStep.safeSignals])),
    };
    await persistLedgerAndSummary(deps, retryLedger, persistedStep);
    return {
      ok: true,
      flowStep: persistedStep,
      flowSummary: toFullFiscalYearSummary(retryLedger, persistedStep),
    };
  }

  if (shouldMoveExactZipToManualReview(zipStep)) {
    const reviewLedger = markFullFiscalYearZipManualReview(ledger, deps.now?.() ?? new Date());
    const reviewStep = fullFiscalYearZipPhaseStep(reviewLedger)!;
    const persistedStep = {
      ...zipStep,
      safeSignals: Array.from(new Set([...zipStep.safeSignals, ...reviewStep.safeSignals])),
      ...(reviewStep.userAction ? { userAction: reviewStep.userAction } : {}),
    };
    await persistLedgerAndSummary(deps, reviewLedger, persistedStep);
    return {
      ok: true,
      flowStep: persistedStep,
      flowSummary: toFullFiscalYearSummary(reviewLedger, persistedStep),
    };
  }

  await persistLedgerAndSummary(deps, ledger, zipStep);
  return {
    ok: true,
    flowStep: zipStep,
    flowSummary: toFullFiscalYearSummary(ledger, zipStep),
  };
}

async function moveDuplicateZipOwnersToManualReview(
  deps: FiledReturnsFlowRunnerDeps,
  owners: readonly FiledReturnsFullFiscalYearLedger[],
): Promise<Map<string, FiledReturnsFullFiscalYearLedger>> {
  const now = deps.now?.() ?? new Date();
  const reviewLedgers = new Map<string, FiledReturnsFullFiscalYearLedger>();
  for (const ledger of owners) {
    const reviewLedger = markFullFiscalYearZipManualReview(ledger, now);
    await persistLedgerAndSummary(deps, reviewLedger, fullFiscalYearZipPhaseStep(reviewLedger)!);
    reviewLedgers.set(reviewLedger.ledgerId, reviewLedger);
  }
  return reviewLedgers;
}

function withFullFiscalYearSystemErrorPredecessor(
  flowStep: PortalFlowStepResult,
  predecessor: FullFiscalYearSystemErrorPredecessor,
): PortalFlowStepResult {
  if (
    !flowStep.safeSignals.includes("portal-system-error") ||
    flowStep.safeSignals.length >= MAX_DURABLE_FLOW_SIGNALS
  ) {
    return flowStep;
  }
  const signal = `full-fiscal-year-system-error-preceded-by:${predecessor}`;
  if (flowStep.safeSignals.includes(signal)) return flowStep;
  return { ...flowStep, safeSignals: [...flowStep.safeSignals, signal] };
}

function shouldMoveExactZipToManualReview(step: PortalFlowStepResult): boolean {
  if (step.state !== "download-unconfirmed") return false;
  const permanentSignals = new Set([
    "full-fiscal-year-zip-download-id-not-found",
    "full-fiscal-year-zip-download-search-unavailable",
    "full-fiscal-year-zip-download-state-unknown",
    "browser-download-search-missing",
    "browser-download-search-unavailable",
    "browser-download-correlation-rejected",
    "browser-download-size-unknown",
    "browser-download-existence-unknown",
    "browser-download-danger-unknown",
  ]);
  return step.safeSignals.some((signal) => permanentSignals.has(signal));
}
