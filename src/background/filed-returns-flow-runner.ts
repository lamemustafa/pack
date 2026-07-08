import type { FiledReturnsDownloadScope } from "../core/contracts";
import type {
  FullFiscalYearTargetRecoveryPayload,
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
import { startFullFiscalYearDownloadFlow } from "./filed-returns-full-fiscal-year";
import {
  prepareFullFiscalYearTargetRetry,
  readFullFiscalYearTargetRecoveryScope,
} from "./filed-returns-full-fiscal-year-recovery";
import {
  readFiledReturnsTargetReview,
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
          | "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3"
          | "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3";
      }
    >,
  ) => Promise<PackMessageResponse>;
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
  stageCapturedDownloads?: {
    bundleKind?: "full-fiscal-year" | "single-period";
    ledgerId: string;
  };
  timings?: {
    contentMessageTimeoutMs?: number;
    detailSummaryModalSettleMs?: number;
    flowStepSettleMs?: number;
    resultRowNavigationSettleMs?: number;
  };
}

export async function startFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<PackMessageResponse> {
  if (!isFullFiscalYearScope(scope)) {
    const targetReview = await readFiledReturnsTargetReview(scope, deps);
    if (targetReview) return responseForFiledReturnsTargetReview(targetReview);
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
