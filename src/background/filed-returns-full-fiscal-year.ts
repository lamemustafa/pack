import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { getFiledReturnsFullFiscalYearPeriods } from "../core/filed-returns-scope";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  createFullFiscalYearLedger,
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
} from "./filed-returns-full-fiscal-year-zip";
import {
  completedRunCleanupBlockedStep,
  createFullFiscalYearCleanupPendingState,
  finishFullFiscalYearCleanup,
  markFullFiscalYearCleanupPending,
  markFullFiscalYearExportPhase,
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
  const now = deps.now?.() ?? new Date();
  const existingLedger = await readLedger(deps.storageKeys.fullFiscalYearLedger);
  const sameScopeExistingLedger =
    existingLedger && sameFiledReturnsScope(existingLedger.scope, scope) ? existingLedger : null;
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
  if (
    sameScopeExistingLedger &&
    ["export-pending", "export-retry-pending"].includes(sameScopeExistingLedger.zipPhase ?? "")
  ) {
    return completeRun(deps, sameScopeExistingLedger);
  }
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);

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
  if (replaceCompletedSameScopeLedger) {
    const clearSignal = await discardFullFiscalYearFiledReturnsZip(existingLedger.ledgerId);
    if (clearSignal !== "full-fiscal-year-opfs-cleared") {
      const cleanupPendingLedger = markFullFiscalYearCleanupPending(existingLedger, now);
      const step = completedRunCleanupBlockedStep(cleanupPendingLedger);
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
        preferDirectDownload: false,
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
      ledger = markFullFiscalYearExportPhase(ledger, deps.now?.() ?? new Date(), "export-pending");
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
  if (!canCompleteFullFiscalYearLedger(ledger)) {
    const step = blockedFullFiscalYearStep("full-fiscal-year-run-needs-action", ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

  const now = deps.now?.() ?? new Date();
  const readyLedger =
    ledger.zipPhase === "export-pending" || ledger.zipPhase === "export-retry-pending"
      ? ledger
      : markFullFiscalYearExportPhase(ledger, now, "export-pending");
  const step = completeFullFiscalYearStep(readyLedger);
  // Persist a resumable pre-export state before the browser download can suspend
  // this MV3 worker. A later start can then retry the retained staged ZIP without
  // re-running already completed portal targets.
  await persistLedger(deps, readyLedger);
  const zipStep = await exportFullFiscalYearZip(readyLedger, step);
  if (zipStep.state !== "downloaded") {
    const nextLedger = zipStep.safeSignals.some(
      (signal) =>
        signal === "full-fiscal-year-zip-artifact-staging-incomplete" ||
        signal === "full-fiscal-year-zip-entry-count-mismatch",
    )
      ? markFullFiscalYearRestagingRequired(readyLedger, now)
      : markFullFiscalYearExportPhase(readyLedger, now, "export-retry-pending");
    const phaseStep = fullFiscalYearZipPhaseStep(nextLedger)!;
    const persistedStep = {
      ...zipStep,
      safeSignals: Array.from(new Set([...zipStep.safeSignals, ...phaseStep.safeSignals])),
    };
    const summary = toFullFiscalYearSummary(nextLedger, persistedStep);
    await persistLedgerAndSummary(deps, nextLedger, persistedStep);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  const cleanupPending = createFullFiscalYearCleanupPendingState(readyLedger, zipStep);
  await persistLedgerAndSummary(deps, cleanupPending.ledger, cleanupPending.step);
  return finishFullFiscalYearCleanup(deps, cleanupPending.ledger);
}
