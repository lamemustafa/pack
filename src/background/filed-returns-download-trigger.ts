import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { FULL_FISCAL_YEAR_PERIOD } from "../core/filed-returns-scope";
import {
  mergeFlowStepWithDownloadObservation,
  observeNextBrowserDownload,
} from "./download-observer";
import { suggestNextBrowserDownloadFilename } from "./download-filename-suggester";
import { triggerDirectFiledReturnDownload } from "./filed-returns-direct-download-trigger";
import { safeFiledReturnDownloadFilename } from "./filed-returns-download-filename";
import {
  runDownloadTriggerOnce,
  type FiledReturnsFlowMessagingDeps,
} from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const EXPECTED_FILED_RETURN_DOWNLOAD = {
  expectedFileExtensions: [".pdf"],
  expectedMimeTypes: ["application/pdf"],
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

type FlowStepResponse = Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>;

export async function triggerAndObserveFiledReturnDownload({
  activePeriod,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  const target = createDownloadTarget(scope);
  if (!target) return unverifiedPeriodResponse();

  if (deps.preferDirectDownload) {
    const directDownloadResponse = await triggerDirectFiledReturnDownload({
      activePeriod,
      deps,
      scope,
      tabId,
      target,
    });
    if (directDownloadResponse) return directDownloadResponse;
  }

  const armedAt = new Date();
  const filename = safeFiledReturnDownloadFilename(scope);
  const trustedDownloadIds = new Set<number>();
  const observationContext = {
    ...EXPECTED_FILED_RETURN_DOWNLOAD,
    armedAt,
    ignoredFilenames: [filename],
    trustedDownloadIds,
  };
  const detailDownloadFilenameSuggestion = suggestNextBrowserDownloadFilename(
    browser.downloads,
    observationContext,
    filename,
  );
  const detailDownloadObservation = observeFiledReturnDownload(observationContext);
  const observedDownloadPromise = detailDownloadObservation.promise.finally(() => {
    detailDownloadFilenameSuggestion.stop();
  });
  const triggerResponse = await runDownloadTriggerOnce(deps, tabId, target);
  const triggerFlowResponse = toTriggerFlowResponse(triggerResponse, activePeriod);
  if (!triggerFlowResponse.ok || !("flowStep" in triggerFlowResponse)) {
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
    return triggerFlowResponse;
  }

  if (!shouldAwaitDownloadObservation(triggerFlowResponse.flowStep)) {
    detailDownloadObservation.stop();
    detailDownloadFilenameSuggestion.stop();
    return triggerFlowResponse;
  }

  const observedDownload = await observedDownloadPromise;
  const flowStep = normaliseAmbiguousTriggerDownloadResult(
    triggerFlowResponse.flowStep,
    mergeFlowStepWithDownloadObservation(triggerFlowResponse.flowStep, observedDownload),
  );
  if (deps.persistTargetReview !== false) {
    await persistFiledReturnsTargetReview(scope, flowStep, deps);
  }
  return {
    ...triggerFlowResponse,
    flowStep,
  };
}

function createDownloadTarget(scope: FiledReturnsDownloadScope): FiledReturnsDownloadTarget | null {
  if (scope.period === "ALL" || scope.period === FULL_FISCAL_YEAR_PERIOD) return null;
  return {
    actionId: createActionId(),
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
  };
}

function toTriggerFlowResponse(
  response: PackMessageResponse,
  activePeriod: string | null,
): PackMessageResponse {
  if (!response.ok || "flowStep" in response) return response;
  if ("downloadTrigger" in response) {
    return {
      ...response,
      flowStep: {
        ...response.downloadTrigger,
        safeSignals: [
          ...response.downloadTrigger.safeSignals,
          ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
        ],
      },
    };
  }
  return response;
}

function shouldAwaitDownloadObservation(step: PortalFlowStepResult): boolean {
  return (
    step.safeSignals.includes("filed-gstr3b-download-clicked") ||
    step.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous")
  );
}

function normaliseAmbiguousTriggerDownloadResult(
  triggerStep: PortalFlowStepResult,
  mergedStep: PortalFlowStepResult,
): PortalFlowStepResult {
  if (
    !triggerStep.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous") ||
    mergedStep.state !== "downloaded"
  ) {
    return mergedStep;
  }

  return {
    ...mergedStep,
    state: "download-unconfirmed",
    safeMessage:
      "Pack saw a matching GST PDF download, but could not confirm that Pack delivered the download click. It will not mark this target as downloaded without a confirmed click.",
    ...(triggerStep.userAction ? { userAction: triggerStep.userAction } : {}),
  };
}

function unverifiedPeriodResponse(): FlowStepResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: ["filed-return-detail-period-unverified"],
      safeMessage:
        "Pack could not verify which GSTR-3B period is open, so it did not click the download control.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open the filed GSTR-3B detail page for one period, then start Pack again.",
        canResume: true,
      },
    },
  };
}

export function observeFiledReturnDownload(
  context = { ...EXPECTED_FILED_RETURN_DOWNLOAD, armedAt: new Date() },
) {
  return observeNextBrowserDownload(browser.downloads, context);
}

function createActionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
