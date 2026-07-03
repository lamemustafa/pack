import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { getFiledReturnsFullFiscalYearPeriods } from "../core/filed-returns-scope";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import {
  canCompleteFullFiscalYearLedger,
  completeFullFiscalYearLedger,
  hasActionRequiredFullFiscalYearTarget,
  createFullFiscalYearLedger,
  isFullFiscalYearLedger,
  isFullFiscalYearLedgerStale,
  markFullFiscalYearTargetRunning,
  markFullFiscalYearTargetTerminal,
  nextRunnableFullFiscalYearTarget,
  reconcileFullFiscalYearLedgerTargets,
  resumeFullFiscalYearLedger,
  sameFiledReturnsScope,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  activeFullFiscalYearStep,
  blockedFullFiscalYearStep,
  completeFullFiscalYearStep,
  downloadUnconfirmedFullFiscalYearStep,
  interruptedFullFiscalYearStep,
  needsResumeConfirmation,
  summariseFullFiscalYearLedger,
  targetStatusFromFlowStep,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-summary";
import {
  mergeRetriedArtifactSignals,
  scopeForFullFiscalYearTarget,
} from "./filed-returns-full-fiscal-year-artifacts";

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
  let ledger =
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    !replaceCompletedSameScopeLedger
      ? reconcileFullFiscalYearLedgerTargets(existingLedger, now, plannedPeriods)
      : createFullFiscalYearLedger(scope, now, plannedPeriods);

  if (
    existingLedger &&
    sameFiledReturnsScope(existingLedger.scope, scope) &&
    !replaceCompletedSameScopeLedger
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
    !replaceCompletedSameScopeLedger
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
      { ...deps, persistTargetReview: false },
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

    const flowStep = mergeRetriedArtifactSignals(previousTargetSafeSignals, response.flowStep);
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
    return { ...response, flowStep, flowSummary: toFullFiscalYearSummary(ledger, flowStep) };
  }
}

function responseForExistingLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  options: { allowExistingLedgerResume?: boolean } = {},
): PackMessageResponse | null {
  const unconfirmedDownload = ledger.targets.some(
    (target) => target.status === "download-unconfirmed",
  );
  if (unconfirmedDownload) {
    const step = downloadUnconfirmedFullFiscalYearStep(ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

  if (ledger.status === "complete" && canCompleteFullFiscalYearLedger(ledger)) {
    const summary = summariseFullFiscalYearLedger(ledger);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  if (
    ledger.status === "running" &&
    ledger.targets.some((target) => target.status === "running") &&
    !isFullFiscalYearLedgerStale(ledger, now)
  ) {
    const summary = toFullFiscalYearSummary(ledger, activeFullFiscalYearStep(ledger));
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  if (
    ledger.status === "running" &&
    ledger.targets.some((target) => target.status === "running") &&
    isFullFiscalYearLedgerStale(ledger, now)
  ) {
    const displayLedger: FiledReturnsFullFiscalYearLedger = {
      ...ledger,
      status: "blocked",
      updatedAt: now.toISOString(),
    };
    const step = interruptedFullFiscalYearStep(displayLedger);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(displayLedger, step),
    };
  }

  if (!options.allowExistingLedgerResume && needsResumeConfirmation(ledger)) {
    const step = blockedFullFiscalYearStep("full-fiscal-year-resume-confirmation-required", ledger);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(ledger, step),
    };
  }

  if (hasActionRequiredFullFiscalYearTarget(ledger)) {
    const displayLedger = coerceInconsistentCompleteLedger(ledger, now);
    const step = blockedFullFiscalYearStep("full-fiscal-year-run-needs-action", displayLedger);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(displayLedger, step),
    };
  }

  return null;
}

function shouldPersistReconciledLedger(
  previous: FiledReturnsFullFiscalYearLedger,
  reconciled: FiledReturnsFullFiscalYearLedger,
): boolean {
  return (
    (previous.revision ?? 1) !== (reconciled.revision ?? 1) ||
    previous.status !== reconciled.status ||
    previous.targets.length !== reconciled.targets.length ||
    previous.eligibleThrough !== reconciled.eligibleThrough
  );
}

function coerceInconsistentCompleteLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  if (ledger.status !== "complete") return ledger;
  return { ...ledger, status: "blocked", updatedAt: now.toISOString() };
}

async function completeRun(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
): Promise<PackMessageResponse> {
  if (!canCompleteFullFiscalYearLedger(ledger)) {
    const step = blockedFullFiscalYearStep("full-fiscal-year-run-needs-action", ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

  const completedLedger = completeFullFiscalYearLedger(ledger, deps.now?.() ?? new Date());
  const step = completeFullFiscalYearStep(completedLedger);
  await persistLedgerAndSummary(deps, completedLedger, step);
  const summary = toFullFiscalYearSummary(completedLedger, step);
  return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
}

async function readLedger(key: string): Promise<FiledReturnsFullFiscalYearLedger | null> {
  const values = await browser.storage.local.get(key);
  const ledger = values[key];
  return isFullFiscalYearLedger(ledger) ? ledger : null;
}

async function persistLedger(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
): Promise<void> {
  await browser.storage.local.set({ [deps.storageKeys.fullFiscalYearLedger]: ledger });
}

async function persistLedgerAndMaybeSummary(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): Promise<void> {
  await persistLedger(deps, ledger);
  if (ledger.status === "complete") {
    await persistSummary(deps, toFullFiscalYearSummary(ledger, flowStep));
  }
}

async function persistLedgerAndSummary(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): Promise<void> {
  await persistLedger(deps, ledger);
  await persistSummary(deps, toFullFiscalYearSummary(ledger, flowStep));
}

async function persistSummary(
  deps: FiledReturnsFlowRunnerDeps,
  summary: FiledReturnsFlowSummary,
): Promise<void> {
  await browser.storage.session.set({ [deps.storageKeys.completion]: summary });
}

function fullFiscalYearErrorStep(
  target: FiledReturnsFullFiscalYearLedger["targets"][number],
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(target.returnType),
    state: "blocked",
    safeSignals: ["full-fiscal-year-target-error", "pack-error:CONTENT_SCRIPT_UNAVAILABLE"],
    safeMessage: `Pack stopped while checking ${target.period}. The GST tab could not be reached safely.`,
  };
}
