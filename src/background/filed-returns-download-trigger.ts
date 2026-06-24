import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import {
  mergeFlowStepWithDownloadObservation,
  observeNextBrowserDownload,
} from "./download-observer";
import { unverifiedPeriodAfterDownloadStep } from "./filed-returns-flow-guards";
import {
  runDownloadTriggerOnce,
  type FiledReturnsFlowMessagingDeps,
} from "./filed-returns-flow-messaging";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
const EXPECTED_FILED_RETURN_DOWNLOAD = {
  expectedFileExtensions: [".pdf"],
  expectedMimeTypes: ["application/pdf"],
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

type FlowStepResponse = Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>;

export type TriggerAndObserveResult =
  | { continueFlow: true; response: FlowStepResponse }
  | { continueFlow: false; response: PackMessageResponse };

export async function triggerAndObserveFiledReturnDownload({
  activePeriod,
  completedPeriods,
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  completedPeriods: Set<string>;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<TriggerAndObserveResult> {
  const target = createDownloadTarget(scope, activePeriod);
  if (!target) return { continueFlow: false, response: unverifiedPeriodResponse() };

  const detailDownloadObservation = observeFiledReturnDownload();
  const triggerResponse = await runDownloadTriggerOnce(deps, tabId, target);
  const triggerFlowResponse = toTriggerFlowResponse(triggerResponse, activePeriod);
  if (!triggerFlowResponse.ok || !("flowStep" in triggerFlowResponse)) {
    detailDownloadObservation.stop();
    return { continueFlow: false, response: triggerFlowResponse };
  }

  if (!shouldAwaitDownloadObservation(triggerFlowResponse.flowStep)) {
    detailDownloadObservation.stop();
    return { continueFlow: false, response: triggerFlowResponse };
  }

  const observedDownload = await detailDownloadObservation.promise;
  const mergedResponse = {
    ...triggerFlowResponse,
    flowStep: normaliseAmbiguousTriggerDownloadResult(
      triggerFlowResponse.flowStep,
      mergeFlowStepWithDownloadObservation(triggerFlowResponse.flowStep, observedDownload),
    ),
  };
  if (!isEntireFinancialYearScope(scope)) return { continueFlow: false, response: mergedResponse };
  if (mergedResponse.flowStep.state !== "downloaded") {
    return { continueFlow: false, response: mergedResponse };
  }
  if (!activePeriod) {
    return {
      continueFlow: false,
      response: {
        ...mergedResponse,
        flowStep: unverifiedPeriodAfterDownloadStep(mergedResponse.flowStep),
      },
    };
  }

  completedPeriods.add(activePeriod);
  return { continueFlow: true, response: mergedResponse };
}

function createDownloadTarget(
  scope: FiledReturnsDownloadScope,
  activePeriod: string | null,
): FiledReturnsDownloadTarget | null {
  const period = isEntireFinancialYearScope(scope) ? activePeriod : scope.period;
  if (!period || period === "ALL") return null;
  return {
    actionId: createActionId(),
    financialYear: scope.financialYear,
    period,
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

export function observeFiledReturnDownload() {
  return observeNextBrowserDownload(browser.downloads, {
    ...EXPECTED_FILED_RETURN_DOWNLOAD,
    armedAt: new Date(),
  });
}

function createActionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isEntireFinancialYearScope(scope: FiledReturnsDownloadScope): boolean {
  return scope.period === "ALL";
}
