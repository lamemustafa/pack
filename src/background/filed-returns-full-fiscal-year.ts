import type {
  FiledReturnsDownloadScope,
  FiledReturnsFullFiscalYearLedger,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { getFiledReturnsFullFiscalYearPeriods } from "../core/filed-returns-scope";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  completeFullFiscalYearLedger,
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
import { exportFullFiscalYearZip } from "./filed-returns-full-fiscal-year-zip";

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
  const plannedPeriods = getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now);

  const replaceCompletedSameScopeLedger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    existingLedger.status === "complete" &&
    canCompleteFullFiscalYearLedger(existingLedger) &&
    !options.allowExistingLedgerResume;
  const replaceUnstartedBlockedSameScopeLedger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    (existingLedger.status === "blocked" || existingLedger.status === "cancelled") &&
    !hasTerminalPositiveTarget(existingLedger) &&
    !hasDownloadUnconfirmedTarget(existingLedger) &&
    !options.allowExistingLedgerResume;
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
  const readyLedger: FiledReturnsFullFiscalYearLedger = {
    ...ledger,
    status: "blocked",
    updatedAt: now.toISOString(),
  };
  const step = completeFullFiscalYearStep(readyLedger);
  const zipStep = await exportFullFiscalYearZip(readyLedger, step);
  if (zipStep.state !== "downloaded") {
    const summary = toFullFiscalYearSummary(readyLedger, zipStep);
    await persistLedgerAndSummary(deps, readyLedger, zipStep);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  const completedLedger = completeFullFiscalYearLedger(ledger, now);
  const summary = toFullFiscalYearSummary(completedLedger, zipStep);
  await persistLedgerAndSummary(deps, completedLedger, zipStep);
  return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
}
