import { browser } from "wxt/browser";
import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  FiledReturnsFlowSummary,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import { buildAuthorizedFiledGstr3bDirectDownloadUrl } from "../connectors/gst/filed-returns-direct-download-authorization";
import type { FiledGstr3bDirectDownloadReady, PackMessageResponse } from "../connectors/gst/messages";
import { observeBrowserDownloadById } from "./download-observer";
import { withFiledReturnsDownloadDiagnostic } from "./filed-returns-download-diagnostics";
import { expectedDownloadForArtifact } from "./filed-returns-download-expectations";
import { targetReviewScope } from "./filed-returns-download-result";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { finalizeObservedSingleArtifactDownload } from "./filed-returns-single-artifact-download-completion";
import {
  clearFiledReturnsTargetDownloadAttempt,
  persistFiledReturnsTargetDownloadId,
  persistFiledReturnsTargetDownloadIntent,
} from "./filed-returns-target-download-attempt";
import { persistFiledReturnsTargetReview } from "./filed-returns-target-review";
import { beginLiveFiledReturnsDownloadObservation } from "./filed-returns-durable-download-reconciler";
import { PACK_LOCAL_STORAGE_KEYS } from "./storage-keys";

/**
 * Performs one browser-managed request after the content script has proved the
 * visible page matches the target. This deliberately does not probe/fetch the
 * endpoint first and does not assign a Pack filename.
 */
export async function startAuthorizedFiledGstr3bDirectDownload({
  activePeriod,
  artifactType,
  authorization,
  deps,
  scope,
  target,
}: {
  activePeriod: string | null;
  artifactType: FiledReturnsConcreteArtifactType;
  authorization: FiledGstr3bDirectDownloadReady;
  deps: FiledReturnsFlowMessagingDeps;
  scope: FiledReturnsDownloadScope;
  target: FiledReturnsDownloadTarget;
}): Promise<PackMessageResponse> {
  if (
    authorization.actionId !== target.actionId ||
    target.returnType !== "GSTR-3B" ||
    artifactType !== "PDF" ||
    target.artifactType !== "PDF"
  ) {
    return responseWithDiagnostic(
      directBlockedStep(
        ["filed-gstr3b-direct-download-action-mismatch"],
        "Pack rejected the direct download authorization because it did not match the active GSTR-3B PDF target.",
      ),
      target,
    );
  }

  const downloadUrl = buildAuthorizedFiledGstr3bDirectDownloadUrl(
    scope.financialYear,
    scope.period,
  );
  if (!downloadUrl) {
    return responseWithDiagnostic(
      directBlockedStep(
        ["filed-gstr3b-return-period-invalid"],
        "Pack could not derive the selected GSTR-3B return period, so it did not start a browser download.",
      ),
      target,
    );
  }

  const reviewScope = targetReviewScope(scope, artifactType);
  const checkpointEnabled = deps.persistTargetReview !== false;
  const checkpointDeps = {
    ...deps,
    storageKeys: {
      ...deps.storageKeys,
      targetReview: deps.storageKeys.targetReview ?? PACK_LOCAL_STORAGE_KEYS.targetReview,
    },
  };
  const requestedAt = deps.now?.() ?? new Date();
  const triggerStep = directTriggerStep(authorization, activePeriod);

  if (checkpointEnabled) {
    let intentPersisted = false;
    try {
      intentPersisted = await persistFiledReturnsTargetDownloadIntent(
        reviewScope,
        {
          actionId: target.actionId,
          artifactType,
          directDownload: true,
          kind: "single-artifact",
          phase: "download-intent-persisted",
          requestedAt: requestedAt.toISOString(),
        },
        checkpointDeps,
        triggerStep,
      );
    } catch {
      intentPersisted = false;
    }
    if (!intentPersisted) {
      return responseWithDiagnostic(
        directBlockedStep(
          [...triggerStep.safeSignals, "filed-return-download-state-persist-failed"],
          "Pack did not start the GSTR-3B browser download because it could not save a local recovery checkpoint.",
        ),
        target,
      );
    }
  }

  const startedDownload = await startBrowserDownload(downloadUrl);
  if (!startedDownload.ok) {
    if (checkpointEnabled) {
      try {
        await clearFiledReturnsTargetDownloadAttempt(reviewScope, checkpointDeps);
      } catch {
        // Retaining the intent-only checkpoint is safer than hiding uncertainty.
      }
    }
    return responseWithDiagnostic(
      directBlockedStep(
        [...triggerStep.safeSignals, "filed-gstr3b-direct-download-start-rejected"],
        "The browser rejected Pack's reviewed GSTR-3B download request. Allow downloads for Pack, then retry.",
      ),
      target,
    );
  }

  const endLiveObservation = beginLiveFiledReturnsDownloadObservation(startedDownload.id);
  if (checkpointEnabled) {
    let downloadIdPersisted = false;
    try {
      downloadIdPersisted = await persistFiledReturnsTargetDownloadId(
        reviewScope,
        startedDownload.id,
        checkpointDeps,
        triggerStep,
      );
    } catch {
      downloadIdPersisted = false;
    }
    if (!downloadIdPersisted) {
      endLiveObservation();
      const flowStep = withFiledReturnsDownloadDiagnostic({
        attemptClass: "extension-direct",
        flowStep: {
          ...triggerStep,
          state: "download-unconfirmed",
          safeSignals: [...triggerStep.safeSignals, "filed-return-download-id-persist-failed"],
          safeMessage:
            "Pack may have started the GSTR-3B browser download but could not save its exact browser download ID. Check browser Downloads before taking another action.",
          userAction: {
            type: "RETRY_PORTAL_GENERATION",
            message: "Check browser Downloads, then cancel this target before starting another download.",
            canResume: true,
          },
        },
        target,
      });
      let flowSummary: FiledReturnsFlowSummary | null = null;
      try {
        flowSummary = await persistFiledReturnsTargetReview(reviewScope, flowStep, checkpointDeps);
      } catch {
        // The intent checkpoint remains the fail-closed recovery source.
      }
      return { ok: true, flowStep, ...(flowSummary ? { flowSummary } : {}) };
    }
  }

  const observedDownload = await observeBrowserDownloadById(browser.downloads, startedDownload.id, {
    ...expectedDownloadForArtifact(artifactType),
    armedAt: requestedAt,
    requireExpectedMime: true,
    trustedDownloadIds: new Set([startedDownload.id]),
  }).finally(endLiveObservation);

  return finalizeObservedSingleArtifactDownload({
    activePeriod,
    artifactType,
    attemptClass: "extension-direct",
    deps,
    observedDownload,
    scope,
    target,
    triggerStep,
  });
}

async function startBrowserDownload(url: string): Promise<{ ok: true; id: number } | { ok: false }> {
  try {
    const id = await browser.downloads.download({
      conflictAction: "uniquify",
      saveAs: false,
      url,
    });
    return { ok: true, id };
  } catch {
    return { ok: false };
  }
}

function directTriggerStep(
  authorization: FiledGstr3bDirectDownloadReady,
  activePeriod: string | null,
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "clicked",
    safeSignals: [
      ...authorization.safeSignals,
      "filed-gstr3b-direct-download-started",
      ...(activePeriod ? [`filed-return-detail-period:${activePeriod}`] : []),
    ],
    safeMessage: "Pack started one browser-managed GSTR-3B PDF download for the verified target.",
  };
}

function directBlockedStep(safeSignals: string[], safeMessage: string): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId: "gst-filed-returns-gstr3b-pdf-private-v0",
    state: "blocked",
    safeSignals,
    safeMessage,
    userAction: {
      type: "RETRY_PORTAL_GENERATION",
      message: "Retry after checking the browser download permission and selected return page.",
      canResume: true,
    },
  };
}

function responseWithDiagnostic(
  flowStep: PortalFlowStepResult,
  target: FiledReturnsDownloadTarget,
): PackMessageResponse {
  return {
    ok: true,
    flowStep: withFiledReturnsDownloadDiagnostic({
      attemptClass: "extension-direct",
      flowStep,
      target,
    }),
  };
}
