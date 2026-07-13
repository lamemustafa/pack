import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../core/contracts";
import type {
  FullFiscalYearTargetRecoveryPayload,
  FiledReturnsFreshStartPayload,
  PackMessage,
  PackMessageResponse,
} from "../core/messages";
import { isFullFiscalYearScope } from "../core/filed-returns-scope";
import {
  acquireFiledReturnsRun,
  releaseFiledReturnsRun,
  startFiledReturnsRunLeaseRenewal,
} from "./filed-returns-active-run";
import type { ActiveGstTab } from "./filed-returns-active-tab";
import type { MainWorldFiledReturnsFilterSelectionOutcome } from "./main-world-filed-returns-filter-selection";
import { startFullFiscalYearDownloadFlow } from "./filed-returns-full-fiscal-year";
import {
  prepareFullFiscalYearTargetRetry,
  readFullFiscalYearTargetRecoveryScope,
  resolveFullFiscalYearTarget,
} from "./filed-returns-full-fiscal-year-recovery";
import { sameFiledReturnsScope } from "./filed-returns-full-fiscal-year-ledger";
import { readLedger, responseForExistingLedger } from "./filed-returns-full-fiscal-year-run-state";
import {
  clearFiledReturnsTargetReview,
  noTargetReviewResponse,
  readFiledReturnsTargetReview,
  readCurrentFiledReturnsTargetReview,
  resolveUnconfirmedFiledReturnsDownload,
  responseForFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { startSinglePeriodFiledReturnsDownloadFlow } from "./filed-returns-single-period-flow";

export type { ActiveGstTab } from "./filed-returns-active-tab";

export interface FiledReturnsFlowRunnerDeps {
  getActiveGstTab: () => Promise<ActiveGstTab | null>;
  sendMessageToTabWithInjection: (
    tabId: number,
    message: Extract<
      PackMessage,
      {
        type:
          | "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3"
          | "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3"
          | "PACK_CONTENT_RESOLVE_GSTR1_VIEW_POINT_V3"
          | "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3"
          | "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3";
      }
    >,
  ) => Promise<PackMessageResponse>;
  clickGstr1ResultViewWithDebugger?: (
    tabId: number,
    scope: FiledReturnsDownloadScope,
  ) => Promise<PortalFlowStepResult>;
  storageKeys: {
    activeRun?: string;
    completion: string;
    fullFiscalYearLedger: string;
    observation: string;
    targetReview?: string;
  };
  now?: () => Date;
  persistTargetReview?: boolean;
  preferDirectDownload?: boolean;
  selectFiltersInMainWorld?: (
    tabId: number,
    scope: FiledReturnsDownloadScope,
  ) => Promise<MainWorldFiledReturnsFilterSelectionOutcome>;
  stageCapturedDownloads?: {
    bundleKind?: "full-fiscal-year" | "single-period";
    ledgerId: string;
  };
  timings?: {
    contentMessageTimeoutMs?: number;
    detailSummaryModalSettleMs?: number;
    flowStepSettleMs?: number;
    portalNavigationSettleMs?: number;
    resultRowNavigationSettleMs?: number;
  };
}

export async function startFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  if (!isFullFiscalYearScope(scope)) {
    const targetReview = await readCurrentFiledReturnsTargetReview(deps);
    if (targetReview) return responseForFiledReturnsTargetReview(targetReview);
  }

  if (isFullFiscalYearScope(scope)) {
    const existingLedger = await readLedger(deps.storageKeys.fullFiscalYearLedger);
    if (existingLedger && !sameFiledReturnsScope(existingLedger.scope, scope)) {
      const existingLedgerResponse = responseForExistingLedger(
        existingLedger,
        deps.now?.() ?? new Date(),
      );
      if (existingLedgerResponse) return existingLedgerResponse;
    }
  }

  const activeRun = await acquireFiledReturnsRun(scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    if (isFullFiscalYearScope(scope)) {
      return startFullFiscalYearDownloadFlow(
        scope,
        deps,
        startSinglePeriodFiledReturnsDownloadFlow,
      );
    }
    return startSinglePeriodFiledReturnsDownloadFlow(scope, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

export async function retryFullFiscalYearTargetDownloadFlow(
  payload: FullFiscalYearTargetRecoveryPayload,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const recoveryScope = await readFullFiscalYearTargetRecoveryScope(payload, deps);
  if ("response" in recoveryScope) return recoveryScope.response;

  const activeRun = await acquireFiledReturnsRun(recoveryScope.scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    const recovery = await prepareFullFiscalYearTargetRetry(payload, deps);
    if (!recovery.ok) return recovery.response;
    return startFullFiscalYearDownloadFlow(
      recovery.ledger.scope,
      deps,
      startSinglePeriodFiledReturnsDownloadFlow,
      { allowExistingLedgerResume: true },
    );
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

export async function retryFiledReturnsTargetDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  const targetReview = await readFiledReturnsTargetReview(scope, deps);
  if (!targetReview) return noTargetReviewResponse(scope);

  const activeRun = await acquireFiledReturnsRun(scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    await clearFiledReturnsTargetReview(scope, deps);
    return startSinglePeriodFiledReturnsDownloadFlow(scope, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

export async function startFreshFiledReturnsDownloadFlow(
  payload: FiledReturnsFreshStartPayload,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  if (payload.recovery.kind === "target-review") {
    const targetReview = await readFiledReturnsTargetReview(payload.recovery.scope, deps);
    if (!targetReview) return noTargetReviewResponse(payload.recovery.scope);
  } else {
    const recoveryScope = await readFullFiscalYearTargetRecoveryScope(payload.recovery, deps);
    if ("response" in recoveryScope) return recoveryScope.response;
  }

  const activeRun = await acquireFiledReturnsRun(payload.scope, deps);
  if ("response" in activeRun) return activeRun.response;

  const stopLeaseRenewal = startFiledReturnsRunLeaseRenewal(activeRun.run, deps);
  try {
    const discarded =
      payload.recovery.kind === "target-review"
        ? await resolveUnconfirmedFiledReturnsDownload(payload.recovery.scope, "cancelled", deps)
        : await resolveFullFiscalYearTarget(payload.recovery, "cancelled", deps);
    if (!isRecoveryDiscarded(discarded)) return discarded;
    if (payload.recovery.kind === "full-fiscal-year") {
      const remainingTargetReview = await readCurrentFiledReturnsTargetReview(deps);
      if (remainingTargetReview) return responseForFiledReturnsTargetReview(remainingTargetReview);
    }

    if (isFullFiscalYearScope(payload.scope)) {
      return startFullFiscalYearDownloadFlow(
        payload.scope,
        deps,
        startSinglePeriodFiledReturnsDownloadFlow,
      );
    }
    return startSinglePeriodFiledReturnsDownloadFlow(payload.scope, deps);
  } finally {
    stopLeaseRenewal();
    await releaseFiledReturnsRun(activeRun.run, deps);
  }
}

function isRecoveryDiscarded(response: PackMessageResponse): boolean {
  if (!response.ok || !("flowStep" in response)) return false;
  return response.flowStep.safeSignals.some((signal) =>
    ["filed-returns-target-cancelled", "full-fiscal-year-run-discarded"].includes(signal),
  );
}
