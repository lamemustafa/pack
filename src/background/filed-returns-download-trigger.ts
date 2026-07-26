import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import { FULL_FISCAL_YEAR_PERIOD } from "../connectors/gst/filed-returns-scope";
import { type FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import { filedReturnDescriptor } from "../connectors/gst/filed-returns-return-descriptors";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import { startMainWorldCapturedFiledReturnDownload } from "./filed-returns-captured-download";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { targetReviewScope } from "./filed-returns-download-result";
import {
  runDownloadTriggerOnce,
  type FiledReturnsFlowMessagingDeps,
} from "./filed-returns-flow-messaging";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";
import { acquireGstr3bPdfAfterPreflight } from "./gstr3b-artifact-acquisition";
import { toPortalReturnPeriod } from "../connectors/gst/filed-returns-return-period";
import { downloadAcquiredArtifact } from "./artifact-download";
import { persistArtifactAcquisitionDownloadId, persistArtifactAcquisitionIntent } from "./artifact-acquisition-state";

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
  if (scope.returnType === "GSTR-3B" && (artifactType === "PDF" || artifactType === "JSON") && scope.period !== "ALL") {
    const returnPeriod = toPortalReturnPeriod(scope.period, scope.financialYear);
    if (returnPeriod) {
      const requestId = createActionId();
      const response = await deps.sendMessageToTabWithInjection(tabId, {
        type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34",
        payload: { artifactType, financialYear: scope.financialYear, period: scope.period, requestId, returnPeriod, returnType: "GSTR-3B" },
      });
      if (artifactType === "JSON" && response.ok && "artifact" in response && response.artifact.ok) {
        await persistArtifactAcquisitionIntent({ artifactType, requestId });
        const delivery = await downloadAcquiredArtifact({ base64: response.artifact.base64, filename: `Pack/${scope.financialYear}/${scope.period}/GSTR-3B-data.json`, mimeType: response.artifact.mimeType, requestId, onStarted: (downloadId) => persistArtifactAcquisitionDownloadId({ artifactType, downloadId, requestId, state: "download-observing" }) });
        return delivery.ok
          ? { ok: true, flowStep: { connectorId: "gst", scopeId: filedReturnScopeId("GSTR-3B"), state: "downloaded", safeSignals: [...response.artifact.safeSignals, "extension-download-complete"], safeMessage: "Pack saved the portal-produced GSTR-3B data JSON." } }
          : { ok: true, flowStep: { connectorId: "gst", scopeId: filedReturnScopeId("GSTR-3B"), state: "blocked", safeSignals: ["artifact-acquisition-failed", `artifact-${delivery.reason}`], safeMessage: "Pack did not save an unverified filed-return artifact." } };
      }
      if (artifactType === "PDF" && response.ok && "artifact" in response && !response.artifact.ok && response.artifact.safeSignals.includes("page-generated-pdf-ready")) {
        await persistArtifactAcquisitionIntent({ artifactType, requestId });
        const acquired = await acquireGstr3bPdfAfterPreflight({ filename: `Pack/${scope.financialYear}/${scope.period}/GSTR-3B.pdf`, requestId, returnPeriod, tabId, onStarted: (downloadId) => persistArtifactAcquisitionDownloadId({ artifactType, downloadId, requestId, state: "download-observing" }) });
        return acquired.ok
          ? { ok: true, flowStep: { connectorId: "gst", scopeId: filedReturnScopeId("GSTR-3B"), state: "downloaded", safeSignals: acquired.safeSignals, safeMessage: "Pack saved the portal-produced filed GSTR-3B PDF." } }
          : { ok: true, flowStep: { connectorId: "gst", scopeId: filedReturnScopeId("GSTR-3B"), state: "blocked", safeSignals: ["artifact-acquisition-failed", `artifact-${acquired.reason}`], safeMessage: "Pack did not save an unverified filed-return artifact." } };
      }
      return response;
    }
  }
  const target = createDownloadTarget(scope, artifactType);
  if (!target) return unverifiedPeriodResponse(scope);

  const triggerResponse = await runDownloadTriggerOnce(deps, tabId, target);
  if (triggerResponse.ok && "mainWorldCaptureRequest" in triggerResponse) {
    const armedAt = deps.now?.() ?? new Date();
    const captureResponse = await startMainWorldCapturedFiledReturnDownload({
      activePeriod,
      armedAt,
      artifactType,
      deps,
      mainWorldCaptureRequest: triggerResponse.mainWorldCaptureRequest,
      scope,
      tabId,
      target,
      triggerStep: triggerResponse.downloadTrigger,
    });
    const captureTimedOut =
      captureResponse.ok &&
      "flowStep" in captureResponse &&
      captureResponse.flowStep.safeSignals.some((signal) =>
        signal.endsWith("-main-world-capture-timeout"),
      );
    if (
      (!deps.stageCapturedDownloads ||
        (deps.stageCapturedDownloads.bundleKind === "single-period" && captureTimedOut)) &&
      deps.persistTargetReview !== false &&
      captureResponse.ok &&
      "flowStep" in captureResponse &&
      captureResponse.flowStep.state !== "downloaded"
    ) {
      const stagedSelectionTimedOut =
        deps.stageCapturedDownloads?.bundleKind === "single-period" && captureTimedOut;
      const reviewStep = stagedSelectionTimedOut
        ? {
            ...captureResponse.flowStep,
            safeSignals: [...captureResponse.flowStep.safeSignals, "single-period-zip-incomplete"],
          }
        : captureResponse.flowStep;
      const flowSummary = await persistFiledReturnsTargetReview(
        stagedSelectionTimedOut ? scope : targetReviewScope(scope, artifactType),
        reviewStep,
        deps,
      );
      if (flowSummary) return { ...captureResponse, flowSummary };
    }
    return captureResponse;
  }

  const triggerFlowResponse = toTriggerFlowResponse(triggerResponse, activePeriod);
  if (!triggerFlowResponse.ok || !("flowStep" in triggerFlowResponse)) {
    return triggerFlowResponse;
  }

  if (!requiresUntrustedPortalClickReview(triggerFlowResponse.flowStep)) {
    return {
      ...triggerFlowResponse,
      flowStep: withFiledReturnsDownloadDiagnostic({
        attemptClass: "portal-click",
        flowStep: triggerFlowResponse.flowStep,
        target,
      }),
    };
  }

  const flowStep = withFiledReturnsDownloadDiagnostic({
    attemptClass: "portal-click",
    flowStep: untrustedPortalClickReviewStep(triggerFlowResponse.flowStep, artifactType),
    target,
  });
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

function requiresUntrustedPortalClickReview(step: PortalFlowStepResult): boolean {
  if (step.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous")) return true;
  if (step.state !== "clicked") return false;
  return (
    step.safeSignals.includes("filed-return-download-clicked") ||
    step.safeSignals.includes("gstr2b-download-clicked") ||
    step.safeSignals.includes("filed-gstr3b-download-clicked") ||
    step.safeSignals.includes("filed-gstr3b-download-trigger-ambiguous")
  );
}

function untrustedPortalClickReviewStep(
  step: PortalFlowStepResult,
  artifactType: FiledReturnsConcreteArtifactType,
): PortalFlowStepResult {
  return {
    ...step,
    state: "download-unconfirmed",
    safeSignals: [
      ...step.safeSignals,
      "filed-return-portal-click-evidence-unavailable",
      `filed-return-artifact-unconfirmed:${artifactType}`,
    ],
    safeMessage:
      "Pack used the verified GST Portal download control, but the resulting browser download is not bound to this target. Pack did not mark it complete and will not click again automatically.",
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Review the target, then choose an explicit retry or cancellation.",
      canResume: true,
    },
  };
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

function createActionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
