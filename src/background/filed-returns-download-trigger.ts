import { browser } from "wxt/browser";
import { GST_CONNECTOR_DESCRIPTOR } from "../connectors/gst/constants";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../core/contracts";
import type { PackMessageResponse } from "../core/messages";
import { FULL_FISCAL_YEAR_PERIOD } from "../core/filed-returns-scope";
import {
  filedReturnsConcreteArtifactLabel,
  filedReturnsArtifactMimeTypes,
  type FiledReturnsConcreteArtifactType,
} from "../core/filed-returns-artifacts";
import { filedReturnDescriptor } from "../connectors/gst/filed-returns-return-descriptors";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
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

const EXPECTED_FILED_RETURN_PDF_DOWNLOAD = {
  expectedFileExtensions: [".pdf"],
  expectedMimeTypes: ["application/pdf"],
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

const EXPECTED_FILED_RETURN_EXCEL_DOWNLOAD = {
  expectedFileExtensions: [".xlsx", ".xls"],
  expectedMimeTypes: filedReturnsArtifactMimeTypes("EXCEL"),
  expectedOrigins: GST_CONNECTOR_DESCRIPTOR.supportedOrigins,
};

type FlowStepResponse = Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>;

export async function triggerAndObserveFiledReturnDownload({
  activePeriod,
  artifactType = "PDF",
  deps,
  scope,
  tabId,
}: {
  activePeriod: string | null;
  artifactType?: FiledReturnsConcreteArtifactType;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  tabId: number;
}): Promise<PackMessageResponse> {
  const target = createDownloadTarget(scope, artifactType);
  if (!target) return unverifiedPeriodResponse(scope);

  if (
    artifactType === "PDF" &&
    deps.preferDirectDownload &&
    filedReturnDescriptor(scope.returnType).supportsDirectDownload
  ) {
    const directDownloadResponse = await triggerDirectFiledReturnDownload({
      activePeriod,
      deps,
      scope,
      tabId,
      target,
    });
    if (directDownloadResponse && !shouldFallBackToPortalClick(directDownloadResponse)) {
      return directDownloadResponse;
    }
  }

  const armedAt = new Date();
  const filename = safeFiledReturnDownloadFilename(scope, artifactType);
  const trustedDownloadIds = new Set<number>();
  const observationContext = {
    ...expectedFiledReturnDownload(artifactType),
    armedAt,
    expectedUrlSubstrings: [],
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
  const flowStep = withArtifactDownloadMessage(
    withDownloadedArtifactSignal(
      normaliseAmbiguousTriggerDownloadResult(
        triggerFlowResponse.flowStep,
        mergeFlowStepWithDownloadObservation(triggerFlowResponse.flowStep, observedDownload),
      ),
      artifactType,
    ),
    artifactType,
  );
  let flowSummary: FiledReturnsFlowSummary | null = null;
  if (deps.persistTargetReview !== false) {
    flowSummary = await persistFiledReturnsTargetReview(
      targetReviewScope(scope, artifactType),
      flowStep,
      deps,
    );
  }
  return {
    ...triggerFlowResponse,
    flowStep,
    ...(flowSummary ? { flowSummary } : {}),
  };
}

function createDownloadTarget(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsDownloadTarget | null {
  if (scope.period === "ALL" || scope.period === FULL_FISCAL_YEAR_PERIOD) return null;
  return {
    actionId: createActionId(),
    artifactType,
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
  };
}

function expectedFiledReturnDownload(artifactType: FiledReturnsConcreteArtifactType) {
  return artifactType === "EXCEL"
    ? EXPECTED_FILED_RETURN_EXCEL_DOWNLOAD
    : EXPECTED_FILED_RETURN_PDF_DOWNLOAD;
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
  if (step.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous")) return true;
  if (step.state !== "clicked") return false;
  return (
    step.safeSignals.includes("filed-return-download-clicked") ||
    step.safeSignals.includes("filed-gstr3b-download-clicked") ||
    step.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous")
  );
}

function shouldFallBackToPortalClick(response: PackMessageResponse): boolean {
  if (!response.ok || !("flowStep" in response)) return false;
  const signals = new Set(response.flowStep.safeSignals);
  return (
    signals.has("filed-gstr3b-download-trigger-ambiguous") ||
    signals.has("filed-gstr3b-direct-download-fetch-unavailable") ||
    signals.has("filed-gstr3b-direct-download-status-rejected") ||
    signals.has("filed-gstr3b-direct-download-non-pdf-response") ||
    signals.has("filed-gstr3b-direct-download-fetch-failed") ||
    signals.has("filed-gstr3b-direct-download-start-rejected")
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

function withDownloadedArtifactSignal(
  flowStep: PortalFlowStepResult,
  artifactType: FiledReturnsConcreteArtifactType,
): PortalFlowStepResult {
  if (flowStep.state !== "downloaded") return flowStep;
  return {
    ...flowStep,
    safeSignals: [
      ...flowStep.safeSignals,
      ...(flowStep.safeSignals.includes(`filed-return-artifact-downloaded:${artifactType}`)
        ? []
        : [`filed-return-artifact-downloaded:${artifactType}`]),
    ],
  };
}

function withArtifactDownloadMessage(
  flowStep: PortalFlowStepResult,
  artifactType: FiledReturnsConcreteArtifactType,
): PortalFlowStepResult {
  if (flowStep.state !== "downloaded") return withUnconfirmedArtifactSignal(flowStep, artifactType);
  const artifactLabel = filedReturnsConcreteArtifactLabel(artifactType);
  return {
    ...flowStep,
    safeMessage: `The browser reported that the filed-return ${artifactLabel} download completed. Check the local downloads folder for the GST Portal file.`,
  };
}

function withUnconfirmedArtifactSignal(
  flowStep: PortalFlowStepResult,
  artifactType: FiledReturnsConcreteArtifactType,
): PortalFlowStepResult {
  if (flowStep.state !== "download-unconfirmed" && flowStep.state !== "blocked") return flowStep;
  if (
    !flowStep.safeSignals.some((signal) =>
      [
        "browser-download-not-observed",
        "browser-download-size-unknown",
        "browser-download-interrupted",
      ].includes(signal),
    )
  ) {
    return flowStep;
  }

  const artifactLabel = filedReturnsConcreteArtifactLabel(artifactType);
  return {
    ...flowStep,
    safeSignals: [
      ...flowStep.safeSignals,
      ...(flowStep.safeSignals.includes(`filed-return-artifact-unconfirmed:${artifactType}`)
        ? []
        : [`filed-return-artifact-unconfirmed:${artifactType}`]),
    ],
    safeMessage:
      artifactType === "EXCEL"
        ? "Pack clicked the filed GSTR-1 e-invoice details Excel download control, but the browser did not report an Excel download. If Brave blocked multiple downloads, allow downloads for the GST Portal; if the portal shows no e-invoice file, retry after the file is available."
        : `Pack clicked the filed-return ${artifactLabel} download control, but the browser did not report a completed download. Allow downloads for the GST Portal, then retry.`,
  };
}

function targetReviewScope(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
): FiledReturnsDownloadScope {
  if (artifactType === "PDF") {
    const pdfScope = { ...scope };
    delete pdfScope.artifactType;
    return pdfScope;
  }
  return { ...scope, artifactType };
}

function unverifiedPeriodResponse(scope: FiledReturnsDownloadScope): FlowStepResponse {
  const descriptor = filedReturnDescriptor(scope.returnType);
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId(scope.returnType),
      state: "user-action-required",
      safeSignals: ["filed-return-detail-period-unverified"],
      safeMessage: `Pack could not verify which ${descriptor.label} period is open, so it did not click the download control.`,
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: `Open the filed ${descriptor.label} detail page for one period, then start Pack again.`,
        canResume: true,
      },
    },
  };
}

export function observeFiledReturnDownload(
  context = { ...EXPECTED_FILED_RETURN_PDF_DOWNLOAD, armedAt: new Date() },
) {
  return observeNextBrowserDownload(browser.downloads, context);
}

function createActionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
