import { browser } from "wxt/browser";
import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import {
  filedReturnDescriptor,
  filedReturnScopedSignal,
} from "../connectors/gst/filed-returns-return-descriptors";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";

export const FLOW_STEP_SETTLE_MS = 600;
export const DETAIL_SUMMARY_MODAL_SETTLE_MS = 250;
export const RESULT_ROW_NAVIGATION_SETTLE_MS = 1_500;
export const MAX_FLOW_STEPS = 6;
export const MAX_GSTR1_FLOW_STEPS = 12;
export const MAX_GSTR2B_FLOW_STEPS = 12;

export function shouldContinueFlow(step: PortalFlowStepResult): boolean {
  if (step.safeSignals.includes("filed-return-download-clicked")) return false;
  if (step.safeSignals.includes("filed-gstr3b-download-clicked")) return false;
  if (
    step.safeSignals.includes("gstr-3b-detail-route") &&
    step.safeSignals.includes("filed-returns-heading")
  ) {
    return true;
  }
  return step.state === "clicked" || step.safeSignals.includes("detail-summary-modal");
}

export function maxFlowStepsFor(scope: FiledReturnsDownloadScope): number {
  if (scope.returnType === "GSTR-1") return MAX_GSTR1_FLOW_STEPS;
  return scope.returnType === "GSTR-2B" ? MAX_GSTR2B_FLOW_STEPS : MAX_FLOW_STEPS;
}

export function isFiledReturnDownloadReady(
  step: PortalFlowStepResult,
  scope: FiledReturnsDownloadScope,
): boolean {
  return (
    step.safeSignals.includes("filed-return-download-ready") ||
    step.safeSignals.includes(filedReturnScopedSignal(scope.returnType, "download-ready"))
  );
}

export function shouldAttemptDirectDownloadFromDetailRoute(
  step: PortalFlowStepResult,
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): boolean {
  return Boolean(
    deps.preferDirectDownload &&
      filedReturnDescriptor(scope.returnType).supportsDirectDownload &&
      step.safeSignals.includes("gstr-3b-detail-route") &&
      !step.safeSignals.includes("detail-summary-modal") &&
      hasDirectDownloadReadySignal(step, scope),
  );
}

export function getResultRowNavigationSettleMs(deps: FiledReturnsFlowRunnerDeps): number {
  return deps.timings?.resultRowNavigationSettleMs ?? RESULT_ROW_NAVIGATION_SETTLE_MS;
}

export function getFlowStepSettleMs(
  step: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): number {
  if (isFiledReturnDetailNavigationStep(step)) {
    return deps.timings?.resultRowNavigationSettleMs ?? RESULT_ROW_NAVIGATION_SETTLE_MS;
  }
  if (step.safeSignals.includes("detail-summary-modal")) {
    return deps.timings?.detailSummaryModalSettleMs ?? DETAIL_SUMMARY_MODAL_SETTLE_MS;
  }
  return deps.timings?.flowStepSettleMs ?? FLOW_STEP_SETTLE_MS;
}

export function extractActivePeriod(step: PortalFlowStepResult): string | null {
  const prefixes = ["filed-return-result-period:", "filed-return-detail-period:"];
  for (const prefix of prefixes) {
    const signal = step.safeSignals.find((candidate) => candidate.startsWith(prefix));
    if (signal) return signal.slice(prefix.length);
  }
  return null;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export async function persistFlowResponse(
  response: Extract<PackMessageResponse, { ok: true }>,
  deps: FiledReturnsFlowRunnerDeps,
) {
  if ("observation" in response && response.observation) {
    await browser.storage.session.set({
      [deps.storageKeys.observation]: response.observation,
    });
  }
}

function hasDirectDownloadReadySignal(
  step: PortalFlowStepResult,
  scope: FiledReturnsDownloadScope,
): boolean {
  return (
    isFiledReturnDownloadReady(step, scope) ||
    (step.safeSignals.includes(`filed-return-detail-period:${scope.period}`) &&
      step.safeSignals.includes(`filed-return-detail-financial-year:${scope.financialYear}`))
  );
}

function isFiledReturnDetailNavigationStep(step: PortalFlowStepResult): boolean {
  return (
    step.safeSignals.includes("filed-return-result-view-clicked") ||
    step.safeSignals.includes("filed-return-api-result-posted")
  );
}
