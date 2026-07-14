import { browser } from "wxt/browser";
import type {
  FiledReturnsFlowSummary,
  FiledReturnsFullFiscalYearLedger,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  canCompleteFullFiscalYearLedger,
  hasActionRequiredFullFiscalYearTarget,
  isFullFiscalYearLedger,
  isFullFiscalYearLedgerStale,
} from "./filed-returns-full-fiscal-year-ledger";
import {
  activeFullFiscalYearStep,
  blockedFullFiscalYearStep,
  downloadUnconfirmedFullFiscalYearStep,
  interruptedFullFiscalYearStep,
  needsResumeConfirmation,
  summariseFullFiscalYearLedger,
  toFullFiscalYearSummary,
} from "./filed-returns-full-fiscal-year-summary";

export function hasTerminalPositiveTarget(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return ledger.targets.some((target) =>
    ["downloaded", "manually-observed", "not-filed"].includes(target.status),
  );
}

export function hasDownloadUnconfirmedTarget(ledger: FiledReturnsFullFiscalYearLedger): boolean {
  return ledger.targets.some((target) => target.status === "download-unconfirmed");
}

export function hasRetainedFullFiscalYearStaging(
  ledger: FiledReturnsFullFiscalYearLedger,
): boolean {
  if (ledger.zipPhase === "downloaded-cleanup-pending") return true;
  if (ledger.status === "complete") return false;
  return ledger.targets.some((target) =>
    target.safeSignals.some(
      (signal) =>
        signal === "full-fiscal-year-opfs-staged" ||
        signal.startsWith("full-fiscal-year-opfs-staged:"),
    ),
  );
}

export function responseForExistingLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
  options: { allowExistingLedgerResume?: boolean; blockRetainedStaging?: boolean } = {},
): PackMessageResponse | null {
  if (options.blockRetainedStaging && hasRetainedFullFiscalYearStaging(ledger)) {
    const step = retainedStagingScopeConflictStep(ledger);
    return { ok: true, flowStep: step, flowSummary: toFullFiscalYearSummary(ledger, step) };
  }

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

  if (hasActionRequiredFullFiscalYearTarget(ledger)) {
    const displayLedger = coerceInconsistentCompleteLedger(ledger, now);
    const summary = summariseFullFiscalYearLedger(displayLedger, now);
    return { ok: true, flowStep: summary.flowStep, flowSummary: summary };
  }

  if (!options.allowExistingLedgerResume && needsResumeConfirmation(ledger)) {
    const step = blockedFullFiscalYearStep("full-fiscal-year-resume-confirmation-required", ledger);
    return {
      ok: true,
      flowStep: step,
      flowSummary: toFullFiscalYearSummary(ledger, step),
    };
  }

  return null;
}

function retainedStagingScopeConflictStep(
  ledger: FiledReturnsFullFiscalYearLedger,
): PortalFlowStepResult {
  const finalZipRetry = canCompleteFullFiscalYearLedger(ledger);
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(ledger.scope.returnType),
    state: "blocked",
    safeSignals: [
      "full-fiscal-year-retained-staging-scope-conflict",
      "full-fiscal-year-opfs-retained",
      ...(finalZipRetry ? ["full-fiscal-year-final-zip-retry"] : []),
    ],
    safeMessage: finalZipRetry
      ? `Pack retained the prepared FY ${ledger.scope.financialYear} files. Retry that final ZIP before starting another full-year selection.`
      : `Pack retained staged files for FY ${ledger.scope.financialYear}. Resolve or discard that saved run before starting another full-year selection.`,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Return to the saved full-year selection and finish or discard it first.",
      canResume: true,
    },
  };
}

export function shouldPersistReconciledLedger(
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

export async function readLedger(key: string): Promise<FiledReturnsFullFiscalYearLedger | null> {
  const values = await browser.storage.local.get(key);
  const ledger = values[key];
  return isFullFiscalYearLedger(ledger) ? ledger : null;
}

export async function persistLedger(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
): Promise<void> {
  await browser.storage.local.set({ [deps.storageKeys.fullFiscalYearLedger]: ledger });
}

export async function persistLedgerAndMaybeSummary(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): Promise<void> {
  await persistLedger(deps, ledger);
  if (ledger.status === "complete") {
    await persistSummary(deps, toFullFiscalYearSummary(ledger, flowStep));
  }
}

export async function persistLedgerAndSummary(
  deps: FiledReturnsFlowRunnerDeps,
  ledger: FiledReturnsFullFiscalYearLedger,
  flowStep: PortalFlowStepResult,
): Promise<void> {
  await persistLedger(deps, ledger);
  await persistSummary(deps, toFullFiscalYearSummary(ledger, flowStep));
}

export async function persistSummary(
  deps: FiledReturnsFlowRunnerDeps,
  summary: FiledReturnsFlowSummary,
): Promise<void> {
  await browser.storage.session.set({ [deps.storageKeys.completion]: summary });
}

export function fullFiscalYearErrorStep(
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

function coerceInconsistentCompleteLedger(
  ledger: FiledReturnsFullFiscalYearLedger,
  now: Date,
): FiledReturnsFullFiscalYearLedger {
  if (ledger.status !== "complete") return ledger;
  return { ...ledger, status: "blocked", updatedAt: now.toISOString() };
}
