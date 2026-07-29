import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { getFiledReturnsFullFiscalYearPeriods } from "../connectors/gst/filed-returns-scope";
import {
  gstr3bFullFiscalYearAcquisitionNotWiredStep,
  isGstr3bFullFiscalYearAcquisitionScope,
} from "./gstr3b-artifact-acquisition-block";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  createFullFiscalYearLedger,
  hasCanonicalFullFiscalYearTargetPlan,
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
  readLedger,
  responseForExistingLedger,
  shouldPersistReconciledLedger,
} from "./filed-returns-full-fiscal-year-run-state";
import {
  mergeRetriedArtifactSignals,
  requireFullFiscalYearArtifactsStaged,
  scopeForFullFiscalYearTarget,
} from "./filed-returns-full-fiscal-year-artifacts";
import {
  discardFullFiscalYearFiledReturnsZip,
  exportFullFiscalYearZip,
  reconcileFullFiscalYearZipDownload,
} from "./filed-returns-full-fiscal-year-zip";
import {
  completedRunCleanupBlockedStep,
  createFullFiscalYearCleanupPendingState,
  finishFullFiscalYearCleanup,
  markFullFiscalYearCleanupPending,
  markFullFiscalYearZipDownloadIntent,
  markFullFiscalYearZipDownloadObserving,
  markFullFiscalYearZipManualReview,
  markFullFiscalYearZipPhase,
  markFullFiscalYearRestagingRequired,
} from "./filed-returns-full-fiscal-year-cleanup";
import {
  fullFiscalYearZipPhaseStep,
  hasLegacyRetainedStaging,
} from "./filed-returns-full-fiscal-year-zip-phase";

export type SinglePeriodRunner = (
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  options?: { persistSinglePeriodSummary?: boolean },
) => Promise<PackMessageResponse>;

export { summariseFullFiscalYearLedger, targetStatusFromFlowStep };

export async function startFullFiscalYearDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  runSinglePeriod: SinglePeriodRunner,
  options: { allowExistingLedgerResume?: boolean } = {},
): Promise<PackMessageResponse> {
  if (isGstr3bFullFiscalYearAcquisitionScope(scope)) {
    return { ok: true, flowStep: gstr3bFullFiscalYearAcquisitionNotWiredStep() };
  }
  const now = deps.now?.() ?? new Date();
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);
  let existingLedger = await readLedger(deps.storageKeys.fullFiscalYearLedger);
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
    return reconcilePersistedFullFiscalYearZip(deps, sameScopeExistingLedger);
  }
  if (
    sameScopeExistingLedger &&
    ["download-intent-persisted", "download-started"].includes(
      sameScopeExistingLedger.zipPhase ?? "",
    )
  ) {
    // This function is reached only from an explicit user-started background
    // message. Passive summary reconstruction uses fullFiscalYearZipPhaseStep
    // and never calls this mutating path. A no-ID or legacy checkpoint may be
    // retried here after the user has reviewed browser Downloads.
    const retryLedger = markFullFiscalYearZipPhase(
      sameScopeExistingLedger,
      now,
      "export-retry-pending",
    );
    return completeRun(deps, retryLedger);
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
    !hasRetainedFullFiscalYearStaging(existingLedger) &&
    !options.allowExistingLedgerResume;
  const replaceUnstartedBlockedSameScopeLedger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    (existingLedger.status === "blocked" || existingLedger.status === "cancelled") &&
    !hasTerminalPositiveTarget(existingLedger) &&
    !hasDownloadUnconfirmedTarget(existingLedger) &&
    !hasRetainedFullFiscalYearStaging(existingLedger) &&
    !options.allowExistingLedgerResume;
  if (existingLedger && replaceCompletedSameScopeLedger) {
    const clearSignals = await discardFullFiscalYearFiledReturnsZip(existingLedger.ledgerId);
    if (!clearSignals.includes("full-fiscal-year-opfs-cleared")) {
      const cleanupPendingLedger = markFullFiscalYearCleanupPending(existingLedger, now);
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
    !replaceUnstartedBlockedSameScopeLedger
      ? reconcileFullFiscalYearLedgerTargets(existingLedger, now, plannedPeriods)
      : createFullFiscalYearLedger(scope, now, plannedPeriods);

  if (
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    !replaceCompletedSameScopeLedger &&
    !replaceUnstartedBlockedSameScopeLedger
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
    !replaceUnstartedBlockedSameScopeLedger
      ? resumeFullFiscalYearLedger(ledger, now)
      : ledger;

  if (ledger.targets.length === 0) {
    ledger = { ...ledger, status: "blocked", updatedAt: now.toISOString() };
    await persistLedger(deps, ledger);
    const step = blockedFullFiscalYearStep("full-fiscal-year-no-eligible-periods", ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

  await persistLedger(deps, ledger);

  while (true) {
    const nextTarget = nextRunnableFullFiscalYearTarget(ledger);
    if (!nextTarget) return completeRun(deps, ledger);
    const retryScope = scopeForFullFiscalYearTarget(nextTarget);
    const previousTargetSafeSignals = nextTarget.safeSignals;

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
        persistTargetReview: false,
        stageCapturedDownloads: { bundleKind: "full-fiscal-year", ledgerId: ledger.ledgerId },
      },
      { persistSinglePeriodSummary: false },
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
      mergeRetriedArtifactSignals(previousTargetSafeSignals, response.flowStep),
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
  const step = completeFullFiscalYearStep(readyLedger);
  // Persist a resumable pre-export state before the browser download can suspend
  // this MV3 worker. A later start can then retry the retained staged ZIP without
  // re-running already completed portal targets.
  await persistLedger(deps, readyLedger);
  let exportLedger = readyLedger;
  const zipStep = await exportFullFiscalYearZip(readyLedger, step, {
    onBeforeDownloadStart: async (requestedAt) => {
      const intentLedger = markFullFiscalYearZipDownloadIntent(exportLedger, requestedAt);
      const intentStep = fullFiscalYearZipPhaseStep(intentLedger)!;
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
  return finishFullFiscalYearCleanup(deps, cleanupPending.ledger);
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
  const completeStep = completeFullFiscalYearStep(ledger);
  const zipStep = await reconcileFullFiscalYearZipDownload(ledger, completeStep);
  if (zipStep.state === "downloaded") {
    const cleanupPending = createFullFiscalYearCleanupPendingState(ledger, zipStep);
    await persistLedgerAndSummary(deps, cleanupPending.ledger, cleanupPending.step);
    return finishFullFiscalYearCleanup(deps, cleanupPending.ledger);
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
