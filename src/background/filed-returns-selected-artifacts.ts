import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import {
  concreteFiledReturnsArtifactTypes,
  normaliseFiledReturnsArtifactType,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import {
  combineDownloadedArtifactFlowSteps,
  createSinglePeriodBundleLedgerId,
  markArtifactProgressNeedsReview,
  persistPartialArtifactSummary,
  readPersistedArtifactProgress,
  selectedArtifactsSafeMessage,
  toOptionalArtifactUnavailableFlowStep,
} from "./filed-returns-artifact-progress";
import { triggerAndObserveFiledReturnDownload } from "./filed-returns-download-trigger";
import {
  discardSinglePeriodFiledReturnsZip,
  exportSinglePeriodFiledReturnsZip,
} from "./filed-returns-full-fiscal-year-zip";
import { runDownloadStepWithRetry } from "./filed-returns-flow-messaging";
import type { FiledReturnsFlowRunnerDeps } from "./filed-returns-flow-runner";
import {
  delay,
  extractActivePeriod,
  getFlowStepSettleMs,
  isFiledReturnDownloadReady,
  MAX_FLOW_STEPS,
  persistFlowResponse,
  shouldContinueFlow,
} from "./filed-returns-flow-runner-utils";
import { toStepLimitReachedFlowStep } from "./filed-returns-step-limit";

export async function triggerSelectedArtifacts({
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
    const response = await runDownloadStepWithRetry(deps, tabId, {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3",
      payload: scope,
    });
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
