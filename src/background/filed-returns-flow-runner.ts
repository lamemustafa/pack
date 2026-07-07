import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type {
  FullFiscalYearTargetRecoveryPayload,
  PackMessage,
  PackMessageResponse,
} from "../core/messages";
import {
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import { isFullFiscalYearScope } from "../core/filed-returns-scope";
import {
  acquireFiledReturnsRun,
  releaseFiledReturnsRun,
  startFiledReturnsRunLeaseRenewal,
} from "./filed-returns-active-run";
import { triggerAndObserveFiledReturnDownload } from "./filed-returns-download-trigger";
import { startFullFiscalYearDownloadFlow } from "./filed-returns-full-fiscal-year";
import {
  discardSinglePeriodFiledReturnsZip,
  exportSinglePeriodFiledReturnsZip,
} from "./filed-returns-full-fiscal-year-zip";
import { runDownloadStepWithRetry } from "./filed-returns-flow-messaging";
import {
  prepareFullFiscalYearTargetRetry,
  readFullFiscalYearTargetRecoveryScope,
} from "./filed-returns-full-fiscal-year-recovery";
import {
  readFiledReturnsTargetReview,
  responseForFiledReturnsTargetReview,
} from "./filed-returns-target-review";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import {
  filedReturnDescriptor,
  filedReturnScopedSignal,
  filedReturnScopeId,
} from "../connectors/gst/filed-returns-return-descriptors";

const GST_SERVICES_ORIGIN = GST_CONNECTOR_DESCRIPTOR.supportedOrigins[1] ?? "";
const GST_LOGIN_URL = new URL("/services/login", GST_SERVICES_ORIGIN).href;
const FLOW_STEP_SETTLE_MS = 1_600;
const RESULT_ROW_NAVIGATION_SETTLE_MS = 4_500;
const MAX_FLOW_STEPS = 6;

export type ActiveGstTab = Browser.tabs.Tab & { id: number };

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

async function startSinglePeriodFiledReturnsDownloadFlow(
  scope: FiledReturnsDownloadScope,
  deps: FiledReturnsFlowRunnerDeps,
  options: { persistSinglePeriodSummary?: boolean } = {},
): Promise<PackMessageResponse> {
  const shouldPersistSinglePeriodSummary = options.persistSinglePeriodSummary !== false;
  const activeTab = await getOrOpenGstTab(deps.getActiveGstTab);
  if (activeTab.openedForLogin) {
    return withPersistedSinglePeriodSummary(
      scope,
      {
        ok: true,
        flowStep: {
          connectorId: "gst",
          scopeId: filedReturnScopeId(scope.returnType),
          state: "login-required",
          safeSignals: ["gst-login-tab-opened"],
          safeMessage: "Pack opened the GST Portal login page. Sign in, then click Start download.",
          userAction: {
            type: "LOGIN",
            message: "Sign in to the GST Portal. Pack will resume after you click Start download.",
            canResume: true,
          },
        },
      },
      deps,
      shouldPersistSinglePeriodSummary,
    );
  }

  let lastStep: PortalFlowStepResult | null = null;
  let activePeriod: string | null = null;
  for (let attempt = 0; attempt < MAX_FLOW_STEPS; attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, activeTab.tab.id, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;

    if (lastStep.safeSignals.includes("filed-return-api-result-posted")) {
      await delay(getResultRowNavigationSettleMs(deps));

      return waitForDetailReadyThenTrigger({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId: activeTab.tab.id,
      });
    }

    if (lastStep.safeSignals.includes("filed-return-result-view-clicked")) {
      await delay(getResultRowNavigationSettleMs(deps));

      if (shouldWaitForDetailReadyAfterResultNavigation(scope)) {
        return waitForDetailReadyThenTrigger({
          activePeriod,
          deps,
          shouldPersistSinglePeriodSummary,
          scope,
          tabId: activeTab.tab.id,
        });
      }

      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId: activeTab.tab.id,
      });
    }

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId: activeTab.tab.id,
      });
    }

    if (!shouldContinueFlow(lastStep)) {
      return withPersistedSinglePeriodSummary(
        scope,
        response,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return withPersistedSinglePeriodSummary(
    scope,
    {
      ok: true,
      flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
        safeSignal: "flow-step-limit-reached",
        safeMessage: searchStepLimitReachedMessage(scope),
        userActionMessage:
          "Wait for the GST Portal result page to finish loading, then click Start download again.",
      }),
    },
    deps,
    shouldPersistSinglePeriodSummary,
  );
}

async function waitForDetailReadyThenTrigger({
  activePeriod,
  deps,
  shouldPersistSinglePeriodSummary,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  shouldPersistSinglePeriodSummary: boolean;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  let lastStep: PortalFlowStepResult | null = null;

  for (let attempt = 0; attempt < MAX_FLOW_STEPS; attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return response;
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    activePeriod = extractActivePeriod(lastStep) ?? activePeriod;

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (shouldAttemptDirectDownloadFromDetailRoute(lastStep, scope, deps)) {
      return triggerSinglePeriodDownloadAndPersistSummary({
        activePeriod,
        deps,
        shouldPersistSinglePeriodSummary,
        scope,
        tabId,
      });
    }

    if (!shouldContinueFlow(lastStep)) {
      return withPersistedSinglePeriodSummary(
        scope,
        response,
        deps,
        shouldPersistSinglePeriodSummary,
      );
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return withPersistedSinglePeriodSummary(
    scope,
    {
      ok: true,
      flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
        safeSignal: "detail-ready-step-limit-reached",
        safeMessage: detailStepLimitReachedMessage(scope),
        userActionMessage:
          "Wait for the filed-return detail page to finish loading, then click Start download again.",
      }),
    },
    deps,
    shouldPersistSinglePeriodSummary,
  );
}

function runScopedDownloadStepWithRetry(
  deps: FiledReturnsFlowRunnerDeps,
  tabId: number,
  scope: FiledReturnsDownloadScope,
): Promise<PackMessageResponse> {
  return runDownloadStepWithRetry(deps, tabId, {
    type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
    payload: scope,
  });
}

async function triggerSinglePeriodDownloadAndPersistSummary({
  activePeriod,
  deps,
  shouldPersistSinglePeriodSummary,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  shouldPersistSinglePeriodSummary: boolean;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  const response = await triggerSelectedArtifacts({
    activePeriod,
    deps,
    scope,
    tabId,
  });
  if (shouldPersistSinglePeriodSummary && response.ok && "flowStep" in response) {
    return withPersistedSinglePeriodSummary(
      scope,
      response,
      deps,
      shouldPersistSinglePeriodSummary,
    );
  }
  return response;
}

async function triggerSelectedArtifacts({
  activePeriod,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  const artifactTypes = concreteFiledReturnsArtifactTypes(
    normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType),
  );
  const singlePeriodBundleLedgerId =
    artifactTypes.length > 1 && !deps.stageCapturedDownloads
      ? createSinglePeriodBundleLedgerId(scope)
      : null;
  const artifactDeps: FiledReturnsFlowRunnerDeps = singlePeriodBundleLedgerId
    ? {
        ...deps,
        stageCapturedDownloads: {
          bundleKind: "single-period",
          ledgerId: singlePeriodBundleLedgerId,
        },
      }
    : deps;
  const persistedProgress =
    artifactTypes.length > 1 && !singlePeriodBundleLedgerId
      ? await readPersistedArtifactProgress(scope, artifactTypes, artifactDeps)
      : null;
  const completedArtifactTypes = new Set(persistedProgress?.completedArtifactTypes ?? []);
  let combinedFlowStep: PortalFlowStepResult | null = persistedProgress?.flowStep ?? null;
  let lastResponse: Extract<
    PackMessageResponse,
    { ok: true; flowStep: PortalFlowStepResult }
  > | null = null;

  for (const artifactType of artifactTypes) {
    if (completedArtifactTypes.has(artifactType)) continue;

    const pagePreparation = await preparePageForSelectedArtifact({
      activePeriod,
      artifactType,
      completedArtifactTypes,
      deps: artifactDeps,
      scope,
      tabId,
    });
    if (!pagePreparation.ok) return pagePreparation.response;
    activePeriod = pagePreparation.activePeriod;

    const response = await triggerAndObserveFiledReturnDownload({
      activePeriod,
      artifactType,
      deps: artifactDeps,
      scope,
      tabId,
    });
    if (!response.ok || !("flowStep" in response)) return response;
    if (response.flowStep.state !== "downloaded") {
      const unavailableArtifactFlowStep = toOptionalArtifactUnavailableFlowStep({
        artifactType,
        artifactTypes,
        combinedFlowStep,
        nextFlowStep: response.flowStep,
        scope,
      });
      if (unavailableArtifactFlowStep) {
        lastResponse = { ...response, flowStep: unavailableArtifactFlowStep };
        completedArtifactTypes.add(artifactType);
        combinedFlowStep = unavailableArtifactFlowStep;
        continue;
      }

      if (!combinedFlowStep || artifactTypes.length === 1) return response;

      if (singlePeriodBundleLedgerId) {
        const clearSignal = await discardSinglePeriodFiledReturnsZip(singlePeriodBundleLedgerId);
        return {
          ...response,
          flowStep: {
            ...response.flowStep,
            safeSignals: Array.from(
              new Set([
                ...response.flowStep.safeSignals,
                "single-period-zip-incomplete",
                clearSignal,
              ]),
            ),
            safeMessage:
              "Pack could not complete every selected filed-return artifact, so it did not export a partial zip.",
          },
        };
      }

      const flowStep = markArtifactProgressNeedsReview(
        combineDownloadedArtifactFlowSteps(combinedFlowStep, response.flowStep),
        response,
      );
      const flowSummary = await persistPartialArtifactSummary(scope, flowStep, deps);
      return {
        ...response,
        flowStep,
        flowSummary,
      };
    }

    lastResponse = response;
    completedArtifactTypes.add(artifactType);
    combinedFlowStep = combineDownloadedArtifactFlowSteps(combinedFlowStep, response.flowStep);
    if (
      artifactTypes.length > 1 &&
      completedArtifactTypes.size < artifactTypes.length &&
      !singlePeriodBundleLedgerId
    ) {
      await persistPartialArtifactSummary(scope, combinedFlowStep, artifactDeps);
    }
  }

  if (!combinedFlowStep) {
    return {
      ok: false,
      error: "Pack could not resolve a filed-return artifact selection.",
    };
  }

  if (!lastResponse) {
    return {
      ok: true,
      flowStep: {
        ...combinedFlowStep,
        safeMessage: "Pack already recorded the selected filed-return artifacts as downloaded.",
      },
    };
  }

  const response: PackMessageResponse = {
    ...lastResponse,
    flowStep:
      artifactTypes.length === 1
        ? combinedFlowStep
        : {
            ...combinedFlowStep,
            safeMessage: selectedArtifactsSafeMessage(combinedFlowStep),
          },
  };
  if (!singlePeriodBundleLedgerId || artifactTypes.length === 1 || !response.ok) return response;
  if (!("flowStep" in response) || response.flowStep.state !== "downloaded") return response;
  if (!response.flowStep.safeSignals.includes("single-period-opfs-staged")) return response;

  return {
    ...response,
    flowStep: await exportSinglePeriodFiledReturnsZip({
      completeStep: response.flowStep,
      ledgerId: singlePeriodBundleLedgerId,
      scope,
    }),
  };
}

function createSinglePeriodBundleLedgerId(scope: FiledReturnsDownloadScope): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return ["single-period", scope.returnType, scope.financialYear, scope.period, suffix]
    .join(":")
    .replace(/[^a-zA-Z0-9:._-]/g, "_");
}

function toOptionalArtifactUnavailableFlowStep({
  artifactType,
  artifactTypes,
  combinedFlowStep,
  nextFlowStep,
  scope,
}: {
  artifactType: FiledReturnsConcreteArtifactType;
  artifactTypes: readonly FiledReturnsConcreteArtifactType[];
  combinedFlowStep: PortalFlowStepResult | null;
  nextFlowStep: PortalFlowStepResult;
  scope: FiledReturnsDownloadScope;
}): PortalFlowStepResult | null {
  if (
    scope.returnType !== "GSTR-1" ||
    artifactTypes.length === 1 ||
    artifactType !== "EXCEL" ||
    !combinedFlowStep ||
    !nextFlowStep.safeSignals.includes("filed-gstr1-excel-no-details-available")
  ) {
    return null;
  }

  const flowStep = combineDownloadedArtifactFlowSteps(combinedFlowStep, nextFlowStep);
  return {
    ...flowStep,
    state: "downloaded",
    safeSignals: Array.from(
      new Set([...flowStep.safeSignals, "filed-return-artifact-unavailable:EXCEL"]),
    ),
    safeMessage:
      "Pack downloaded the filed GSTR-1 summary PDF. The GST Portal reported that no e-invoice details Excel is available for this period.",
  };
}

function selectedArtifactsSafeMessage(flowStep: PortalFlowStepResult): string {
  if (flowStep.safeSignals.includes("filed-return-artifact-unavailable:EXCEL")) {
    return "Pack downloaded the filed GSTR-1 summary PDF. The GST Portal reported that no e-invoice details Excel is available for this period.";
  }
  return "Pack downloaded the selected filed-return artifacts.";
}

async function preparePageForSelectedArtifact({
  activePeriod,
  artifactType,
  completedArtifactTypes,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  completedArtifactTypes: ReadonlySet<FiledReturnsConcreteArtifactType>;
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<
  { ok: true; activePeriod: string | null } | { ok: false; response: PackMessageResponse }
> {
  if (
    scope.returnType !== "GSTR-1" ||
    scope.artifactType !== "PDF_AND_EXCEL" ||
    artifactType !== "EXCEL" ||
    !completedArtifactTypes.has("PDF")
  ) {
    return { ok: true, activePeriod };
  }

  return waitForGstr1ExcelDetailReady({
    activePeriod,
    deps,
    scope: { ...scope, artifactType: "EXCEL" },
    tabId,
  });
}

async function waitForGstr1ExcelDetailReady({
  activePeriod,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowRunnerDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<
  { ok: true; activePeriod: string | null } | { ok: false; response: PackMessageResponse }
> {
  let lastStep: PortalFlowStepResult | null = null;
  let nextActivePeriod = activePeriod;

  for (let attempt = 0; attempt < MAX_FLOW_STEPS; attempt += 1) {
    const response = await runScopedDownloadStepWithRetry(deps, tabId, scope);
    if (!response.ok || !("flowStep" in response)) {
      return { ok: false, response };
    }

    await persistFlowResponse(response, deps);
    lastStep = response.flowStep;
    nextActivePeriod = extractActivePeriod(lastStep) ?? nextActivePeriod;

    if (isFiledReturnDownloadReady(lastStep, scope)) {
      return { ok: true, activePeriod: nextActivePeriod };
    }

    if (!shouldContinueFlow(lastStep)) {
      return { ok: false, response };
    }
    await delay(getFlowStepSettleMs(lastStep, deps));
  }

  return {
    ok: false,
    response: {
      ok: true,
      flowStep: toStepLimitReachedFlowStep(scope, lastStep, {
        safeSignal: "gstr1-excel-detail-step-limit-reached",
        safeMessage:
          "Pack downloaded the filed GSTR-1 summary PDF but did not reach the e-invoice details Excel control before Pack's retry limit. Wait for the GST Portal detail page to finish loading, then click Start download again.",
        userActionMessage:
          "Wait for the GST Portal detail page to finish loading, then click Start download again.",
      }),
    },
  };
}

function toStepLimitReachedFlowStep(
  scope: FiledReturnsDownloadScope,
  lastStep: PortalFlowStepResult | null,
  options: {
    safeSignal: string;
    safeMessage: string;
    userActionMessage: string;
  },
): PortalFlowStepResult {
  return {
    connectorId: lastStep?.connectorId ?? "gst",
    scopeId: lastStep?.scopeId ?? filedReturnScopeId(scope.returnType),
    state: "user-action-required",
    safeSignals: Array.from(new Set([...(lastStep?.safeSignals ?? []), options.safeSignal])),
    safeMessage: options.safeMessage,
    userAction: {
      type: "WAIT_FOR_PORTAL_AVAILABILITY",
      message: options.userActionMessage,
      canResume: true,
    },
  };
}

function searchStepLimitReachedMessage(scope: FiledReturnsDownloadScope): string {
  const descriptor = filedReturnDescriptor(scope.returnType);
  return `Pack selected the filed-return filters, but the GST Portal did not show a filed ${descriptor.label} row or download control before Pack's retry limit. If this period is not filed, no filed-return download is available. Otherwise wait for the portal results to finish loading, then start Pack again.`;
}

function detailStepLimitReachedMessage(scope: FiledReturnsDownloadScope): string {
  const descriptor = filedReturnDescriptor(scope.returnType);
  return `Pack opened the filed ${descriptor.label} detail path, but the GST Portal did not show the requested download control before Pack's retry limit. Wait for the detail page to finish loading, then start Pack again.`;
}

async function readPersistedArtifactProgress(
  scope: FiledReturnsDownloadScope,
  artifactTypes: readonly FiledReturnsConcreteArtifactType[],
  deps: FiledReturnsFlowRunnerDeps,
): Promise<{
  completedArtifactTypes: FiledReturnsConcreteArtifactType[];
  flowStep: PortalFlowStepResult;
} | null> {
  const values = (await browser.storage.session
    .get(deps.storageKeys.completion)
    .catch(() => ({}))) as Record<string, unknown>;
  const summary = parsePersistedPartialSummary(values[deps.storageKeys.completion]);
  if (!summary || summary.status !== "partial") return null;
  if (!sameFiledReturnsScope(summary.scope, scope)) return null;

  const completedArtifactTypes = downloadedArtifactTypes(summary.flowStep.safeSignals).filter(
    (artifactType) => artifactTypes.includes(artifactType),
  );
  if (completedArtifactTypes.length === 0) return null;
  return { completedArtifactTypes, flowStep: summary.flowStep };
}

function parsePersistedPartialSummary(input: unknown): FiledReturnsFlowSummary | null {
  if (!input || typeof input !== "object") return null;
  const summary = input as Partial<FiledReturnsFlowSummary>;
  if (summary.status !== "partial") return null;
  if (!summary.scope || typeof summary.scope !== "object") return null;
  if (!summary.flowStep || typeof summary.flowStep !== "object") return null;
  if (!Array.isArray(summary.flowStep.safeSignals)) return null;
  if (typeof summary.flowStep.state !== "string") return null;
  return summary as FiledReturnsFlowSummary;
}

function downloadedArtifactTypes(
  safeSignals: readonly string[],
): FiledReturnsConcreteArtifactType[] {
  const completedArtifactTypes = safeSignals
    .map((signal) => signal.match(/^filed-return-artifact-downloaded:(PDF|EXCEL)$/)?.[1])
    .filter(
      (artifactType): artifactType is FiledReturnsConcreteArtifactType =>
        artifactType === "PDF" || artifactType === "EXCEL",
    );
  return Array.from(new Set(completedArtifactTypes));
}

function shouldWaitForDetailReadyAfterResultNavigation(scope: FiledReturnsDownloadScope): boolean {
  return scope.returnType === "GSTR-1";
}

async function persistPartialArtifactSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<FiledReturnsFlowSummary> {
  const summary: FiledReturnsFlowSummary = {
    scope,
    status: "partial",
    updatedAt: (deps.now?.() ?? new Date()).toISOString(),
    completedPeriods: [],
    currentPeriod: scope.period,
    flowStep,
    totalPeriods: 1,
  };
  await browser.storage.session.set({ [deps.storageKeys.completion]: summary });
  return summary;
}

function markArtifactProgressNeedsReview(
  flowStep: PortalFlowStepResult,
  response: Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>,
): PortalFlowStepResult {
  if (
    !response.flowSummary?.flowStep.safeSignals.includes("filed-returns-target-review-required") ||
    flowStep.safeSignals.includes("filed-returns-target-review-required")
  ) {
    return flowStep;
  }
  return {
    ...flowStep,
    safeSignals: [...flowStep.safeSignals, "filed-returns-target-review-required"],
  };
}

function combineDownloadedArtifactFlowSteps(
  combinedFlowStep: PortalFlowStepResult | null,
  nextFlowStep: PortalFlowStepResult,
): PortalFlowStepResult {
  if (!combinedFlowStep) return nextFlowStep;
  return {
    ...nextFlowStep,
    safeSignals: Array.from(
      new Set([...combinedFlowStep.safeSignals, ...nextFlowStep.safeSignals]),
    ),
  };
}

function sameFiledReturnsScope(
  left: FiledReturnsDownloadScope,
  right: FiledReturnsDownloadScope,
): boolean {
  return (
    left.financialYear === right.financialYear &&
    left.period === right.period &&
    left.returnType === right.returnType &&
    normaliseFiledReturnsArtifactType(left.returnType, left.artifactType) ===
      normaliseFiledReturnsArtifactType(right.returnType, right.artifactType)
  );
}

async function withPersistedSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  response: Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>,
  deps: FiledReturnsFlowRunnerDeps,
  shouldPersistSinglePeriodSummary: boolean,
): Promise<PackMessageResponse> {
  if (!shouldPersistSinglePeriodSummary) return response;
  if (response.flowSummary) {
    await persistProvidedSinglePeriodSummary(response.flowSummary, deps);
    return response;
  }
  const flowSummary = await persistSinglePeriodSummary(scope, response.flowStep, deps);
  return { ...response, flowSummary };
}

async function getOrOpenGstTab(
  getActiveGstTab: () => Promise<ActiveGstTab | null>,
): Promise<{ tab: ActiveGstTab; openedForLogin: false } | { openedForLogin: true }> {
  const activeTab = await getActiveGstTab();
  if (activeTab) {
    await focusTab(activeTab);
    return { tab: activeTab, openedForLogin: false };
  }

  await browser.tabs.create({ active: true, url: GST_LOGIN_URL });
  return { openedForLogin: true };
}

async function focusTab(tab: ActiveGstTab): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await browser.windows.update(tab.windowId, { focused: true });
  }
}

async function persistFlowResponse(
  response: Extract<PackMessageResponse, { ok: true }>,
  deps: FiledReturnsFlowRunnerDeps,
) {
  if ("observation" in response && response.observation) {
    await browser.storage.session.set({
      [deps.storageKeys.observation]: response.observation,
    });
  }
}

async function persistSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<FiledReturnsFlowSummary> {
  const summary = toSinglePeriodSummary(scope, flowStep, deps.now?.() ?? new Date());
  await browser.storage.session.set({ [deps.storageKeys.completion]: summary });
  return summary;
}

async function persistProvidedSinglePeriodSummary(
  flowSummary: FiledReturnsFlowSummary,
  deps: FiledReturnsFlowRunnerDeps,
): Promise<void> {
  await browser.storage.session.set({ [deps.storageKeys.completion]: flowSummary });
}

function toSinglePeriodSummary(
  scope: FiledReturnsDownloadScope,
  flowStep: PortalFlowStepResult,
  now: Date,
): FiledReturnsFlowSummary {
  const isReconciled =
    flowStep.state === "downloaded" ||
    flowStep.safeSignals.includes("filed-return-positively-not-filed");
  return {
    scope,
    status: isReconciled ? "complete" : "blocked",
    ...(isReconciled ? { completedAt: now.toISOString() } : { updatedAt: now.toISOString() }),
    completedPeriods: isReconciled ? [scope.period] : [],
    currentPeriod: scope.period,
    flowStep,
    totalPeriods: 1,
  };
}

function shouldContinueFlow(step: PortalFlowStepResult): boolean {
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

function isFiledReturnDownloadReady(
  step: PortalFlowStepResult,
  scope: FiledReturnsDownloadScope,
): boolean {
  return (
    step.safeSignals.includes("filed-return-download-ready") ||
    step.safeSignals.includes(filedReturnScopedSignal(scope.returnType, "download-ready"))
  );
}

function shouldAttemptDirectDownloadFromDetailRoute(
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

function getResultRowNavigationSettleMs(deps: FiledReturnsFlowRunnerDeps): number {
  return deps.timings?.resultRowNavigationSettleMs ?? RESULT_ROW_NAVIGATION_SETTLE_MS;
}

function getFlowStepSettleMs(step: PortalFlowStepResult, deps: FiledReturnsFlowRunnerDeps): number {
  if (isFiledReturnDetailNavigationStep(step)) {
    return deps.timings?.resultRowNavigationSettleMs ?? RESULT_ROW_NAVIGATION_SETTLE_MS;
  }
  return deps.timings?.flowStepSettleMs ?? FLOW_STEP_SETTLE_MS;
}

function extractActivePeriod(step: PortalFlowStepResult): string | null {
  const prefixes = ["filed-return-result-period:", "filed-return-detail-period:"];
  for (const prefix of prefixes) {
    const signal = step.safeSignals.find((candidate) => candidate.startsWith(prefix));
    if (signal) return signal.slice(prefix.length);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
