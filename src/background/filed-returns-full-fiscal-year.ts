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
import {
  activeFullFiscalYearStep,
  blockedFullFiscalYearStep,
  completeFullFiscalYearLedger,
  completeFullFiscalYearStep,
  createFullFiscalYearLedger,
  isFullFiscalYearLedger,
  isFullFiscalYearLedgerStale,
  markFullFiscalYearTargetRunning,
  markFullFiscalYearTargetTerminal,
  nextRunnableFullFiscalYearTarget,
  resumeFullFiscalYearLedger,
  sameFiledReturnsScope,
  summariseFullFiscalYearLedger,
  targetStatusFromFlowStep,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-ledger";

export type SinglePeriodRunner = (
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
) => Promise<PackMessageResponse>;

export { summariseFullFiscalYearLedger };

export async function startFullFiscalYearDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  runSinglePeriod: SinglePeriodRunner,
): Promise<PackMessageResponse> {
  const now = deps.now?.() ?? new Date();
  const existingLedger = await readLedger(deps.storageKeys.fullFiscalYearLedger);

  if (existingLedger && sameFiledReturnsScope(existingLedger.scope, scope)) {
    const duplicateResponse = responseForExistingLedger(existingLedger, now);
    if (duplicateResponse) return duplicateResponse;
  }

  let ledger =
    existingLedger && sameFiledReturnsScope(existingLedger.scope, scope)
      ? resumeFullFiscalYearLedger(existingLedger, now)
      : createFullFiscalYearLedger(
          scope,
          now,
          getFiledReturnsFullFiscalYearPeriods(scope.financialYear, now),
        );

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

    ledger = markFullFiscalYearTargetRunning(
      ledger,
      nextTarget.targetId,
      deps.now?.() ?? new Date(),
    );
    await persistLedger(deps, ledger);

    const response = await runSinglePeriod(
      {
        financialYear: nextTarget.financialYear,
        period: nextTarget.period,
        returnType: nextTarget.returnType,
      },
      deps,
    );

    if (!response.ok || !("flowStep" in response)) {
      ledger = markFullFiscalYearTargetTerminal(
        ledger,
        nextTarget.targetId,
        "failed",
        fullFiscalYearErrorStep(
          response.ok ? "Unexpected Pack response." : response.error,
          nextTarget.period,
        ),
        deps.now?.() ?? new Date(),
      );
      await persistLedger(deps, ledger);
      return response;
    }

    const targetStatus = targetStatusFromFlowStep(response.flowStep);
    ledger = markFullFiscalYearTargetTerminal(
      ledger,
      nextTarget.targetId,
      targetStatus,
      response.flowStep,
      deps.now?.() ?? new Date(),
    );
    await persistLedgerAndMaybeSummary(deps, ledger, response.flowStep);

    if (targetStatus === "downloaded" || targetStatus === "not-filed") continue;
    return { ...response, flowSummary: toFullFiscalYearSummary(ledger, response.flowStep) };
  }
}

function responseForExistingLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): PackMessageResponse | null {
  if (ledger.status === "complete") {
    const summary = summariseFullFiscalYearLedger(ledger);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  if (ledger.status === "running" && !isFullFiscalYearLedgerStale(ledger, now)) {
    const summary = toFullFiscalYearSummary(ledger, activeFullFiscalYearStep(ledger));
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  return null;
}

async function completeRun(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
): Promise<PackMessageResponse> {
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

function fullFiscalYearErrorStep(message: string, period: string): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "blocked",
    safeSignals: ["full-fiscal-year-target-error"],
    safeMessage: `Pack stopped while checking ${period}: ${message}`,
  };
}
