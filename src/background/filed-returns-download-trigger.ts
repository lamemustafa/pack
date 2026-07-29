import type {
  FiledReturnsDownloadScope,
  FiledReturnsDownloadDiagnostic,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import type { PackMessageResponse } from "../connectors/gst/messages";
import {
  artifactFailureMessage,
  type ArtifactFailureReason,
} from "../connectors/gst/artifact-source";
import { FULL_FISCAL_YEAR_PERIOD } from "../connectors/gst/filed-returns-scope";
import { type FiledReturnsConcreteArtifactType } from "../connectors/gst/filed-returns-artifacts";
import { filedReturnScopeId } from "../connectors/gst/filed-returns-return-descriptors";
import type { FiledReturnsFlowMessagingDeps } from "./filed-returns-flow-messaging";
import { acquireGstr3bPdfAfterPreflight } from "./gstr3b-artifact-acquisition";
import { acquirePageGeneratedArtifact } from "./gstr2b-artifact-acquisition";
import { toPortalReturnPeriod } from "../connectors/gst/filed-returns-return-period";
import { downloadAcquiredArtifact } from "./artifact-download";
import { stageOffscreenFiledReturn } from "./offscreen-blob-url";
import { safeFiledReturnZipEntryPath } from "./filed-returns-download-filename";
import {
  clearArtifactAcquisitionCheckpoint,
  persistArtifactAcquisitionDownloadId,
  persistArtifactAcquisitionIntent,
  persistArtifactAcquisitionUnconfirmedDownload,
} from "./artifact-acquisition-state";
import {
  gstr3bFullFiscalYearAcquisitionNotWiredStep,
  isGstr3bFullFiscalYearAcquisitionScope,
} from "./gstr3b-artifact-acquisition-block";

type FlowStepResponse = Extract<PackMessageResponse, { ok: true; flowStep: PortalFlowStepResult }>;

export enum Gstr2bArtifactDispatchFailureReason {
  ContentUnavailable = "gstr2b-artifact-content-unavailable",
  PeriodInvalid = "gstr2b-artifact-period-invalid",
  ResponseMissing = "gstr2b-artifact-response-missing",
  StateInvalid = "gstr2b-artifact-state-invalid",
}

export const GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES = {
  [Gstr2bArtifactDispatchFailureReason.ContentUnavailable]:
    "Pack could not start GSTR-2B acquisition from the active portal page. Retry from the same summary page.",
  [Gstr2bArtifactDispatchFailureReason.PeriodInvalid]:
    "Pack could not derive the requested GSTR-2B portal period, so it did not start acquisition.",
  [Gstr2bArtifactDispatchFailureReason.ResponseMissing]:
    "Pack did not receive a GSTR-2B acquisition result from the active portal page.",
  [Gstr2bArtifactDispatchFailureReason.StateInvalid]:
    "Pack received an unsupported GSTR-2B acquisition state and did not start a download.",
} satisfies Record<Gstr2bArtifactDispatchFailureReason, string>;

export enum Gstr1ArtifactDispatchFailureReason {
  ContentUnavailable = "gstr1-artifact-content-unavailable",
  PeriodInvalid = "gstr1-artifact-period-invalid",
  ResponseMissing = "gstr1-artifact-response-missing",
  StateInvalid = "gstr1-artifact-state-invalid",
}

export const GSTR1_ARTIFACT_DISPATCH_FAILURE_MESSAGES = {
  [Gstr1ArtifactDispatchFailureReason.ContentUnavailable]:
    "Pack could not start GSTR-1 acquisition from the active portal page. Retry from the matching summary or detail page.",
  [Gstr1ArtifactDispatchFailureReason.PeriodInvalid]:
    "Pack could not derive the requested GSTR-1 portal period, so it did not start acquisition.",
  [Gstr1ArtifactDispatchFailureReason.ResponseMissing]:
    "Pack did not receive a GSTR-1 acquisition result from the active portal page.",
  [Gstr1ArtifactDispatchFailureReason.StateInvalid]:
    "Pack received an unsupported GSTR-1 acquisition state and did not start a download.",
} satisfies Record<Gstr1ArtifactDispatchFailureReason, string>;

export async function triggerAndObserveFiledReturnDownload({
  activePeriod: _activePeriod,
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
  void _activePeriod;
  if (isGstr3bFullFiscalYearAcquisitionScope(scope)) {
    return { ok: true, flowStep: gstr3bFullFiscalYearAcquisitionNotWiredStep() };
  }
  if (
    scope.returnType === "GSTR-2B" &&
    (scope.period === "ALL" || scope.period === FULL_FISCAL_YEAR_PERIOD)
  ) {
    return {
      ok: true,
      flowStep: {
        connectorId: "gst",
        scopeId: filedReturnScopeId("GSTR-2B"),
        state: "blocked",
        safeSignals: ["gstr2b-full-fiscal-year-acquisition-not-wired"],
        safeMessage:
          "Pack supports GSTR-2B artifact acquisition for one selected period only; it did not start a legacy full-year capture.",
      },
    };
  }
  if (scope.returnType === "GSTR-2B" && scope.period !== "ALL") {
    return triggerGstr2bSinglePeriodArtifact(scope, artifactType, deps, tabId);
  }
  if (
    scope.returnType === "GSTR-1" &&
    (scope.period === "ALL" || scope.period === FULL_FISCAL_YEAR_PERIOD)
  ) {
    return gstr1ArtifactDispatchFailure(Gstr1ArtifactDispatchFailureReason.PeriodInvalid);
  }
  if (scope.returnType === "GSTR-1") {
    return triggerGstr1SinglePeriodArtifact(scope, artifactType, deps, tabId);
  }
  if (
    scope.returnType === "GSTR-3B" &&
    (artifactType === "PDF" || artifactType === "JSON") &&
    scope.period !== "ALL"
  ) {
    const returnPeriod = toPortalReturnPeriod(scope.period, scope.financialYear);
    if (returnPeriod) {
      const requestId = createActionId();
      const response = await deps.sendMessageToTabWithInjection(tabId, {
        type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34",
        payload: {
          artifactType,
          financialYear: scope.financialYear,
          period: scope.period,
          requestId,
          returnPeriod,
          returnType: "GSTR-3B",
        },
      });
      if (
        artifactType === "JSON" &&
        response.ok &&
        "artifact" in response &&
        response.artifact.ok &&
        response.artifact.state === "acquired"
      ) {
        const checkpointTarget = {
          artifactType,
          financialYear: scope.financialYear,
          period: scope.period,
          returnType: scope.returnType,
        };
        await persistArtifactAcquisitionIntent({ ...checkpointTarget, requestId });
        let checkpointHasDownloadId = false;
        let retainCheckpointForRecovery = false;
        try {
          const delivery = await downloadAcquiredArtifact({
            base64: response.artifact.base64,
            filename: artifactFilename(scope, "JSON"),
            mimeType: response.artifact.mimeType,
            requestId,
            onStarted: async (downloadId) => {
              await persistArtifactAcquisitionDownloadId({
                ...checkpointTarget,
                downloadId,
                requestId,
                state: "download-observing",
              });
              checkpointHasDownloadId = true;
            },
            onStartCheckpointFailed: async (downloadId) => {
              await persistArtifactAcquisitionUnconfirmedDownload({
                ...checkpointTarget,
                downloadId,
                requestId,
                state: "download-unconfirmed",
              });
            },
          });
          retainCheckpointForRecovery =
            !delivery.ok &&
            (delivery.reason === "checkpoint-failed" ||
              (delivery.reason === "timeout" && checkpointHasDownloadId));
          return delivery.ok
            ? {
                ok: true,
                flowStep: {
                  connectorId: "gst",
                  scopeId: filedReturnScopeId("GSTR-3B"),
                  state: "downloaded",
                  safeSignals: [
                    ...response.artifact.safeSignals,
                    ...delivery.safeSignals,
                    "extension-download-complete",
                  ],
                  safeMessage:
                    delivery.safeMessage ?? "Pack saved the portal-produced GSTR-3B data JSON.",
                },
              }
            : {
                ok: true,
                flowStep: {
                  connectorId: "gst",
                  scopeId: filedReturnScopeId("GSTR-3B"),
                  state: "blocked",
                  safeSignals: [
                    "artifact-acquisition-failed",
                    `artifact-${delivery.reason}`,
                    ...delivery.safeSignals,
                  ],
                  safeMessage: artifactFailureMessageForDelivery(delivery.reason),
                },
              };
        } finally {
          if (!retainCheckpointForRecovery) {
            await clearArtifactAcquisitionCheckpoint(checkpointTarget, requestId);
          }
        }
      }
      if (
        artifactType === "PDF" &&
        response.ok &&
        "artifact" in response &&
        response.artifact.ok &&
        response.artifact.state === "ready"
      ) {
        const checkpointTarget = {
          artifactType,
          financialYear: scope.financialYear,
          period: scope.period,
          returnType: scope.returnType,
        };
        await persistArtifactAcquisitionIntent({ ...checkpointTarget, requestId });
        let checkpointHasDownloadId = false;
        let retainCheckpointForRecovery = false;
        try {
          const acquired = await acquireGstr3bPdfAfterPreflight({
            filename: artifactFilename(scope, "PDF"),
            requestId,
            returnPeriod,
            tabId,
            onStarted: async (downloadId) => {
              await persistArtifactAcquisitionDownloadId({
                ...checkpointTarget,
                downloadId,
                requestId,
                state: "download-observing",
              });
              checkpointHasDownloadId = true;
            },
            onStartCheckpointFailed: async (downloadId) => {
              await persistArtifactAcquisitionUnconfirmedDownload({
                ...checkpointTarget,
                downloadId,
                requestId,
                state: "download-unconfirmed",
              });
            },
          });
          retainCheckpointForRecovery =
            !acquired.ok &&
            (acquired.reason === "checkpoint-failed" ||
              (acquired.reason === "timeout" && checkpointHasDownloadId));
          return acquired.ok
            ? {
                ok: true,
                flowStep: {
                  connectorId: "gst",
                  scopeId: filedReturnScopeId("GSTR-3B"),
                  state: "downloaded",
                  safeSignals: acquired.safeSignals,
                  safeMessage:
                    acquired.safeMessage ?? "Pack saved the portal-produced filed GSTR-3B PDF.",
                },
              }
            : {
                ok: true,
                flowStep: {
                  connectorId: "gst",
                  scopeId: filedReturnScopeId("GSTR-3B"),
                  state: "blocked",
                  safeSignals: [
                    "artifact-acquisition-failed",
                    `artifact-${acquired.reason}`,
                    ...acquired.safeSignals,
                  ],
                  safeMessage: artifactFailureMessageForDelivery(acquired.reason),
                },
              };
        } finally {
          if (!retainCheckpointForRecovery) {
            await clearArtifactAcquisitionCheckpoint(checkpointTarget, requestId);
          }
        }
      }
      if (response.ok && "artifact" in response && !response.artifact.ok) {
        return artifactFailureResponse(response.artifact.reason, response.artifact.safeSignals);
      }
      return artifactFailureResponse("response-missing", [], "GSTR-3B");
    }
  }
  return artifactFailureResponse("unsupported-target", [], "GSTR-3B");
}

function artifactFilename(
  scope: FiledReturnsDownloadScope,
  artifactType: "PDF" | "JSON" | "EXCEL",
): string {
  const suffix =
    artifactType === "JSON"
      ? "-data.json"
      : scope.returnType === "GSTR-1"
        ? artifactType === "PDF"
          ? "-summary.pdf"
          : "-details.xlsx"
        : scope.returnType === "GSTR-2B"
          ? artifactType === "PDF"
            ? "-summary.pdf"
            : "-details.xlsx"
          : artifactType === "PDF"
            ? "-return.pdf"
            : ".xlsx";
  const folder =
    scope.returnType === "GSTR-1" && artifactType === "EXCEL" ? "E-Invoice" : scope.returnType;
  return `ComplyEaze-Pack/${scope.financialYear}/${folder}/${scope.period}${suffix}`;
}

async function triggerGstr2bSinglePeriodArtifact(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
): Promise<PackMessageResponse> {
  return triggerPageGeneratedSinglePeriodArtifact(scope, artifactType, deps, tabId, "GSTR-2B");
}

async function triggerGstr1SinglePeriodArtifact(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
): Promise<PackMessageResponse> {
  return triggerPageGeneratedSinglePeriodArtifact(scope, artifactType, deps, tabId, "GSTR-1");
}

async function triggerPageGeneratedSinglePeriodArtifact(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
  deps: FiledReturnsFlowMessagingDeps,
  tabId: number,
  returnType: "GSTR-1" | "GSTR-2B",
): Promise<PackMessageResponse> {
  const returnPeriod = toPortalReturnPeriod(scope.period, scope.financialYear);
  if (!returnPeriod) {
    return pageGeneratedArtifactDispatchFailure(returnType, "PeriodInvalid");
  }
  const requestId = createActionId();
  const response = await deps.sendMessageToTabWithInjection(tabId, {
    type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34",
    payload: {
      artifactType,
      financialYear: scope.financialYear,
      period: scope.period,
      requestId,
      returnPeriod,
      returnType,
    },
  });
  if (response.ok && "artifact" in response && !response.artifact.ok) {
    return artifactFailureResponse(
      response.artifact.reason,
      response.artifact.safeSignals,
      returnType,
    );
  }
  if (!response.ok) {
    return pageGeneratedArtifactDispatchFailure(returnType, "ContentUnavailable");
  }
  if (!("artifact" in response)) {
    return pageGeneratedArtifactDispatchFailure(returnType, "ResponseMissing");
  }
  if (!response.artifact.ok) {
    return artifactFailureResponse(
      response.artifact.reason,
      response.artifact.safeSignals,
      returnType,
    );
  }
  const artifact = response.artifact;
  const checkpointTarget = {
    artifactType,
    financialYear: scope.financialYear,
    period: scope.period,
    returnType: scope.returnType,
  };
  await persistArtifactAcquisitionIntent({ ...checkpointTarget, requestId });
  let checkpointHasDownloadId = false;
  let retainCheckpointForRecovery = false;
  try {
    const callbacks = {
      onStarted: async (downloadId: number) => {
        await persistArtifactAcquisitionDownloadId({
          ...checkpointTarget,
          downloadId,
          requestId,
          state: "download-observing",
        });
        checkpointHasDownloadId = true;
      },
      onStartCheckpointFailed: async (downloadId: number) => {
        await persistArtifactAcquisitionUnconfirmedDownload({
          ...checkpointTarget,
          downloadId,
          requestId,
          state: "download-unconfirmed",
        });
      },
    };
    const acquired =
      returnType === "GSTR-2B" && artifact.state === "acquired"
        ? await deliverValidatedArtifact({
            artifactType,
            base64: artifact.base64,
            callbacks,
            deps,
            filename: artifactFilename(scope, "JSON"),
            mimeType: artifact.mimeType,
            requestId,
            returnType,
            scope,
          })
        : artifact.state === "ready" && (artifactType === "PDF" || artifactType === "EXCEL")
          ? await acquirePageGeneratedArtifact({
              artifactType,
              requestId,
              returnPeriod,
              returnType,
              tabId,
            }).then((captured) =>
              captured.ok
                ? deliverValidatedArtifact({
                    artifactType,
                    base64: bytesToBase64(captured.bytes),
                    callbacks,
                    deps,
                    filename: artifactFilename(scope, artifactType),
                    mimeType: captured.mimeType,
                    requestId,
                    returnType,
                    scope,
                    safeSignals: captured.safeSignals,
                  })
                : captured,
            )
          : null;
    if (!acquired) {
      return pageGeneratedArtifactDispatchFailure(returnType, "StateInvalid");
    }
    retainCheckpointForRecovery =
      !acquired.ok &&
      (acquired.reason === "checkpoint-failed" ||
        (acquired.reason === "timeout" && checkpointHasDownloadId));
    return acquired.ok
      ? {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnScopeId(returnType),
            state: "downloaded",
            safeSignals: [...artifact.safeSignals, ...acquired.safeSignals],
            safeMessage: acquired.safeMessage ?? artifactSuccessMessage(returnType, artifactType),
            ...(acquired.downloadDiagnostic
              ? { downloadDiagnostic: acquired.downloadDiagnostic }
              : {}),
          },
        }
      : {
          ok: true,
          flowStep: {
            connectorId: "gst",
            scopeId: filedReturnScopeId(returnType),
            state: "blocked",
            safeSignals: [
              "artifact-acquisition-failed",
              `artifact-${acquired.reason}`,
              ...acquired.safeSignals,
            ],
            safeMessage: artifactFailureMessageForDelivery(acquired.reason),
          },
        };
  } finally {
    if (!retainCheckpointForRecovery) {
      await clearArtifactAcquisitionCheckpoint(checkpointTarget, requestId);
    }
  }
}

async function deliverValidatedArtifact({
  artifactType,
  base64,
  callbacks,
  deps,
  filename,
  mimeType,
  requestId,
  returnType,
  scope,
  safeSignals = [],
}: {
  artifactType: FiledReturnsConcreteArtifactType;
  base64: string;
  callbacks: {
    onStarted: (downloadId: number) => Promise<void>;
    onStartCheckpointFailed: (downloadId: number) => Promise<void>;
  };
  deps: FiledReturnsFlowMessagingDeps;
  filename: string;
  mimeType: string;
  requestId: string;
  returnType: "GSTR-1" | "GSTR-2B";
  scope: FiledReturnsDownloadScope;
  safeSignals?: string[];
}): Promise<
  | {
      ok: true;
      downloadDiagnostic?: FiledReturnsDownloadDiagnostic;
      safeMessage?: string;
      safeSignals: string[];
    }
  | { ok: false; reason: string; safeSignals: string[] }
> {
  const staging = deps.stageCapturedDownloads;
  if (staging) {
    const result = await stageOffscreenFiledReturn({
      artifactType,
      dataUrl: `data:${mimeType};base64,${base64}`,
      ledgerId: staging.ledgerId,
      returnType,
      zipPath: safeFiledReturnZipEntryPath(scope, artifactType),
    });
    return result.status === "staged"
      ? {
          ok: true,
          safeSignals: [
            ...safeSignals,
            `${staging.bundleKind}-opfs-staged`,
            `${staging.bundleKind}-opfs-staged:${artifactType}`,
          ],
          downloadDiagnostic: stagedArtifactDiagnostic(scope, artifactType, mimeType, requestId),
        }
      : { ok: false, reason: result.errorCategory ?? "stage-failed", safeSignals };
  }
  const delivery = await downloadAcquiredArtifact({
    base64,
    filename,
    mimeType,
    requestId,
    ...callbacks,
  });
  return delivery.ok
    ? {
        ok: true,
        safeSignals: [...safeSignals, ...delivery.safeSignals, "extension-download-complete"],
        ...(delivery.safeMessage ? { safeMessage: delivery.safeMessage } : {}),
      }
    : {
        ok: false,
        reason: delivery.reason,
        safeSignals: [...safeSignals, ...delivery.safeSignals],
      };
}

function stagedArtifactDiagnostic(
  scope: FiledReturnsDownloadScope,
  artifactType: FiledReturnsConcreteArtifactType,
  mimeType: string,
  actionId: string,
): FiledReturnsDownloadDiagnostic {
  const mimeClass =
    mimeType === "application/pdf"
      ? "pdf"
      : mimeType === "application/json"
        ? "json"
        : "spreadsheet";
  const endpointClass =
    scope.returnType === "GSTR-2B"
      ? "gstr2b-portal-blob-captured-download"
      : artifactType === "EXCEL"
        ? "gstr1-excel-portal-blob-captured-download"
        : "gstr1-pdf-portal-blob-captured-download";
  return {
    actionId,
    artifactType,
    byteCountClass: "non-empty",
    downloadPathClass: "captured-portal-request-data",
    endpointClass,
    eventType: "filed-return-download-path",
    financialYear: scope.financialYear,
    mimeClass,
    period: scope.period,
    returnType: scope.returnType,
    schemaVersion: "1.0",
    status: "downloaded",
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function gstr2bArtifactDispatchFailure(
  reason: Gstr2bArtifactDispatchFailureReason,
): FlowStepResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-2B"),
      state: "blocked",
      safeSignals: [reason],
      safeMessage: GSTR2B_ARTIFACT_DISPATCH_FAILURE_MESSAGES[reason],
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Keep the selected GSTR-2B summary page open, then retry the artifact.",
        canResume: true,
      },
    },
  };
}

function gstr1ArtifactDispatchFailure(
  reason: Gstr1ArtifactDispatchFailureReason,
): FlowStepResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-1"),
      state: "blocked",
      safeSignals: [reason],
      safeMessage: GSTR1_ARTIFACT_DISPATCH_FAILURE_MESSAGES[reason],
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Keep the selected GSTR-1 page open, then retry the artifact.",
        canResume: true,
      },
    },
  };
}

function pageGeneratedArtifactDispatchFailure(
  returnType: "GSTR-1" | "GSTR-2B",
  reason: "ContentUnavailable" | "PeriodInvalid" | "ResponseMissing" | "StateInvalid",
): FlowStepResponse {
  return returnType === "GSTR-1"
    ? gstr1ArtifactDispatchFailure(Gstr1ArtifactDispatchFailureReason[reason])
    : gstr2bArtifactDispatchFailure(Gstr2bArtifactDispatchFailureReason[reason]);
}

function artifactFailureResponse(
  reason: ArtifactFailureReason,
  safeSignals: readonly string[],
  returnType: "GSTR-1" | "GSTR-3B" | "GSTR-2B" = "GSTR-3B",
): FlowStepResponse {
  return {
    ok: true,
    flowStep: {
      connectorId: "gst",
      scopeId: filedReturnScopeId(returnType),
      state: "blocked",
      safeSignals: ["artifact-acquisition-failed", `artifact-${reason}`, ...safeSignals],
      safeMessage: artifactFailureMessage(reason),
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: `Review the filed ${returnType} page, then retry this artifact.`,
        canResume: true,
      },
    },
  };
}

function artifactFailureMessageForDelivery(reason: string): string {
  return `Pack did not save the verified filed-return artifact: ${reason.replace(/-/g, " ")}.`;
}

function artifactSuccessMessage(
  returnType: "GSTR-1" | "GSTR-2B",
  artifactType: FiledReturnsConcreteArtifactType,
): string {
  if (returnType === "GSTR-1" && artifactType === "EXCEL") {
    return "Pack saved the portal-produced E-invoice details (Excel) workbook.";
  }
  if (returnType === "GSTR-1") return "Pack saved the portal-produced GSTR-1 Summary PDF.";
  return "Pack saved the portal-produced GSTR-2B artifact.";
}

function createActionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  return `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
