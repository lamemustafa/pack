import type {
  ArchiveManifest,
  FiledReturnsCapturedDownloadRequest,
  FiledReturnsMainWorldCaptureRequest,
  FiledReturnsFlowSummary,
  FiledReturnsDirectDownloadRequest,
  FiledReturnsDownloadScope,
  FiledReturnsTargetBoundViewPoint,
  FiledReturnsDownloadTarget,
  PortalDownloadTriggerResult,
  PortalContext,
  PortalFlowStepResult,
  PortalNavigationResult,
  PortalObservation,
} from "./contracts";
import {
  FULL_FISCAL_YEAR_PERIOD,
  isSupportedFiledReturnsScope,
  isSupportedFiledReturnsStartScope,
} from "./filed-returns-scope";
import {
  isFiledReturnsArtifactType,
  isFiledReturnsConcreteArtifactType,
  supportsFiledReturnsArtifactType,
  type FiledReturnsArtifactType,
} from "./filed-returns-artifacts";
import {
  isFiledReturnsReturnType,
  type FiledReturnsReturnType,
} from "./filed-returns-return-types";

export const PACK_CONTENT_SCRIPT_PROTOCOL_VERSION = 29;

export interface MainWorldCaptureTransferPayload {
  actionId: string;
  transferId: string;
}

export interface DownloadPromptProbeResult {
  status: "started" | "start-rejected";
  safeSignals: string[];
  safeMessage: string;
  filenameClass: "synthetic-download-prompt-probe";
  saveAsFalse: true;
  sourceClass: "data-url" | "offscreen-blob-url";
  downloadId?: number;
}

export type PackMessage =
  | { type: "PACK_CONTENT_CONTEXT"; payload: PortalContext }
  | { type: "PACK_FILED_RETURNS_OBSERVATION"; payload: PortalObservation }
  | { type: "PACK_PING" }
  | { type: "PACK_CONTENT_PING_V2" }
  | { type: "PACK_CONTENT_REFRESH_CONTEXT_V3" }
  | { type: "PACK_GET_CONTEXT" }
  | { type: "PACK_GET_FILED_RETURNS_OBSERVATION" }
  | { type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }
  | { type: "PACK_GET_ACTIVE_FILED_RETURNS_RUN" }
  | { type: "PACK_ACKNOWLEDGE_INTERRUPTED_RUN" }
  | { type: "PACK_RETRY_FILED_RETURNS_TARGET"; payload: FiledReturnsDownloadScope }
  | {
      type: "PACK_RETRY_FULL_FISCAL_YEAR_TARGET";
      payload: FullFiscalYearTargetRecoveryPayload;
    }
  | {
      type: "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD";
      payload: {
        scope: FiledReturnsDownloadScope;
        resolution: "downloaded" | "cancelled";
      };
    }
  | {
      type: "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET";
      payload: FullFiscalYearTargetRecoveryPayload & {
        resolution: "manually-observed" | "cancelled";
      };
    }
  | { type: "PACK_REFRESH_FILED_RETURNS_OBSERVATION" }
  | { type: "PACK_NAVIGATE_FILED_RETURNS" }
  | { type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD"; payload: FiledReturnsDownloadTarget }
  | { type: "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP"; payload: FiledReturnsDownloadScope }
  | { type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW"; payload: FiledReturnsDownloadScope }
  | {
      type: "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW";
      payload: FiledReturnsFreshStartPayload;
    }
  | { type: "PACK_START_SYNTHETIC_DEMO"; payload?: { downloadArtifacts?: boolean } }
  | {
      type: "PACK_RUN_DOWNLOAD_PROMPT_PROBE";
      payload?: { sourceClass?: "data-url" | "offscreen-blob-url" };
    }
  | { type: "PACK_CLEAR_LOCAL_DATA" }
  | { type: "PACK_GET_LAST_MANIFEST" }
  | { type: "PACK_CONTENT_REFRESH_FILED_RETURNS_OBSERVATION_V3" }
  | { type: "PACK_CONTENT_NAVIGATE_FILED_RETURNS_V3" }
  | {
      type: "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3";
      payload: FiledReturnsDownloadTarget;
    }
  | {
      type: "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3";
      payload: FiledReturnsDownloadTarget;
    }
  | {
      type: "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3";
      payload: FiledReturnsDownloadScope;
    }
  | {
      type: "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3";
      payload: FiledReturnsDownloadScope;
    }
  | {
      type: "PACK_CONTENT_RESOLVE_GSTR1_VIEW_POINT_V3";
      payload: FiledReturnsDownloadScope;
    }
  | {
      type: "PACK_CONTENT_PREPARE_MAIN_WORLD_CAPTURE_V3";
      payload: MainWorldCaptureTransferPayload;
    }
  | {
      type: "PACK_CONTENT_TAKE_MAIN_WORLD_CAPTURE_CHUNK_V3";
      payload: MainWorldCaptureTransferPayload & { index: number };
    }
  | {
      type: "PACK_CONTENT_CLEAR_MAIN_WORLD_CAPTURE_V3";
      payload: MainWorldCaptureTransferPayload;
    };

export type PackMessageResponse =
  | { ok: true; context: PortalContext | null; contentScriptVersion?: number }
  | {
      ok: true;
      observation: PortalObservation | null;
    }
  | { ok: true; navigation: PortalNavigationResult }
  | {
      ok: true;
      downloadTrigger: PortalDownloadTriggerResult;
      observation?: PortalObservation | null;
    }
  | {
      ok: true;
      directDownloadRequest: FiledReturnsDirectDownloadRequest;
      observation?: PortalObservation | null;
    }
  | {
      ok: true;
      mainWorldCaptureRequest: FiledReturnsMainWorldCaptureRequest;
      downloadTrigger: PortalDownloadTriggerResult;
      observation?: PortalObservation | null;
    }
  | {
      ok: true;
      capturedDownloadRequest: FiledReturnsCapturedDownloadRequest;
      downloadTrigger: PortalDownloadTriggerResult;
      observation?: PortalObservation | null;
    }
  | {
      ok: true;
      flowStep: PortalFlowStepResult;
      flowSummary?: FiledReturnsFlowSummary;
      observation?: PortalObservation | null;
    }
  | { ok: true; flowSummary: FiledReturnsFlowSummary | null }
  | { ok: true; manifest: ArchiveManifest | null }
  | { ok: true; downloaded: number; manifest: ArchiveManifest }
  | { ok: true; downloadPromptProbe: DownloadPromptProbeResult }
  | { ok: true; mainWorldCapturePrepared: true }
  | { ok: true; mainWorldCaptureChunk: string }
  | { ok: true; mainWorldCaptureCleared: true }
  | { ok: true; gstr1ViewPoint: FiledReturnsTargetBoundViewPoint }
  | { ok: true; cleared: true }
  | { ok: false; error: string };

export interface FullFiscalYearTargetRecoveryPayload {
  ledgerId: string;
  targetId: string;
  expectedRevision: number;
}

export interface FiledReturnsFreshStartPayload {
  scope: FiledReturnsDownloadScope;
  recovery:
    | { kind: "target-review"; scope: FiledReturnsDownloadScope }
    | ({
        kind: "full-fiscal-year";
      } & FullFiscalYearTargetRecoveryPayload);
}

export function isPackMessage(input: unknown): input is PackMessage {
  if (!isRecord(input) || typeof input.type !== "string") return false;

  switch (input.type) {
    case "PACK_CONTENT_CONTEXT":
      return isRecord(input.payload);
    case "PACK_FILED_RETURNS_OBSERVATION":
      return isPortalObservation(input.payload);
    case "PACK_PING":
    case "PACK_CONTENT_PING_V2":
    case "PACK_GET_CONTEXT":
    case "PACK_RUN_DOWNLOAD_PROMPT_PROBE":
      return (
        input.payload === undefined ||
        (isRecord(input.payload) &&
          (input.payload.sourceClass === undefined ||
            input.payload.sourceClass === "data-url" ||
            input.payload.sourceClass === "offscreen-blob-url"))
      );
    case "PACK_GET_FILED_RETURNS_OBSERVATION":
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
    case "PACK_GET_ACTIVE_FILED_RETURNS_RUN":
    case "PACK_ACKNOWLEDGE_INTERRUPTED_RUN":
    case "PACK_REFRESH_FILED_RETURNS_OBSERVATION":
    case "PACK_NAVIGATE_FILED_RETURNS":
    case "PACK_CONTENT_REFRESH_CONTEXT_V3":
    case "PACK_CONTENT_REFRESH_FILED_RETURNS_OBSERVATION_V3":
    case "PACK_CONTENT_NAVIGATE_FILED_RETURNS_V3":
      return true;
    case "PACK_RETRY_FILED_RETURNS_TARGET":
      return (
        isFiledReturnsStartScope(input.payload) && input.payload.period !== FULL_FISCAL_YEAR_PERIOD
      );
    case "PACK_RETRY_FULL_FISCAL_YEAR_TARGET":
      return isFullFiscalYearTargetRecoveryPayload(input.payload);
    case "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD":
      return isUnconfirmedDownloadResolution(input.payload);
    case "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET":
      return isFullFiscalYearTargetResolution(input.payload);
    case "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD":
    case "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3":
    case "PACK_CONTENT_RESOLVE_FILED_GSTR3B_DIRECT_DOWNLOAD_V3":
      return isFiledReturnsDownloadTarget(input.payload);
    case "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP":
    case "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3":
    case "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3":
    case "PACK_CONTENT_RESOLVE_GSTR1_VIEW_POINT_V3":
      return isFiledReturnsDownloadScope(input.payload);
    case "PACK_CONTENT_PREPARE_MAIN_WORLD_CAPTURE_V3":
    case "PACK_CONTENT_CLEAR_MAIN_WORLD_CAPTURE_V3":
      return isMainWorldCaptureTransferPayload(input.payload);
    case "PACK_CONTENT_TAKE_MAIN_WORLD_CAPTURE_CHUNK_V3":
      if (!isMainWorldCaptureChunkPayload(input.payload)) return false;
      return (
        Number.isInteger(input.payload.index) &&
        input.payload.index >= 0 &&
        input.payload.index <= 200
      );
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return isFiledReturnsStartScope(input.payload);
    case "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW":
      return isFiledReturnsFreshStartPayload(input.payload);
    case "PACK_START_SYNTHETIC_DEMO":
      return (
        input.payload === undefined ||
        (isRecord(input.payload) &&
          (input.payload.downloadArtifacts === undefined ||
            typeof input.payload.downloadArtifacts === "boolean"))
      );
    case "PACK_CLEAR_LOCAL_DATA":
    case "PACK_GET_LAST_MANIFEST":
      return true;
    default:
      return false;
  }
}

function isMainWorldCaptureTransferPayload(
  input: unknown,
): input is MainWorldCaptureTransferPayload {
  if (!isRecord(input)) return false;
  return isBoundedString(input.actionId, 8, 120) && isBoundedString(input.transferId, 8, 120);
}

function isMainWorldCaptureChunkPayload(
  input: unknown,
): input is MainWorldCaptureTransferPayload & { index: number } {
  return (
    isRecord(input) && isMainWorldCaptureTransferPayload(input) && typeof input.index === "number"
  );
}

function isFullFiscalYearTargetRecoveryPayload(
  input: unknown,
): input is FullFiscalYearTargetRecoveryPayload {
  if (!isRecord(input)) return false;
  const expectedRevision = input.expectedRevision;
  return (
    isBoundedString(input.ledgerId, 1, 120) &&
    isBoundedString(input.targetId, 1, 120) &&
    typeof expectedRevision === "number" &&
    Number.isInteger(expectedRevision) &&
    expectedRevision >= 1
  );
}

function isFullFiscalYearTargetResolution(
  input: unknown,
): input is FullFiscalYearTargetRecoveryPayload & {
  resolution: "manually-observed" | "cancelled";
} {
  if (!isRecord(input)) return false;
  if (input.resolution !== "manually-observed" && input.resolution !== "cancelled") return false;
  return isFullFiscalYearTargetRecoveryPayload(input);
}

function isUnconfirmedDownloadResolution(input: unknown): input is {
  scope: FiledReturnsDownloadScope;
  resolution: "downloaded" | "cancelled";
} {
  if (!isRecord(input)) return false;
  if (input.resolution !== "downloaded" && input.resolution !== "cancelled") return false;
  return isFiledReturnsStartScope(input.scope) && input.scope.period !== FULL_FISCAL_YEAR_PERIOD;
}
function isFiledReturnsFreshStartPayload(input: unknown): input is FiledReturnsFreshStartPayload {
  if (!isRecord(input) || !isFiledReturnsStartScope(input.scope) || !isRecord(input.recovery)) {
    return false;
  }
  if (input.recovery.kind === "target-review") {
    return (
      isFiledReturnsStartScope(input.recovery.scope) &&
      input.recovery.scope.period !== FULL_FISCAL_YEAR_PERIOD
    );
  }
  return (
    input.recovery.kind === "full-fiscal-year" &&
    isFullFiscalYearTargetRecoveryPayload(input.recovery)
  );
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}

function isFiledReturnsDownloadTarget(input: unknown): input is FiledReturnsDownloadTarget {
  if (!isRecord(input)) return false;
  if (
    typeof input.actionId !== "string" ||
    input.actionId.length === 0 ||
    input.actionId.length > 80
  ) {
    return false;
  }
  if (!isFiledReturnsDownloadScope(input)) return false;
  if (input.period === "ALL" || input.period === FULL_FISCAL_YEAR_PERIOD) return false;
  if (input.artifactType !== undefined && !isFiledReturnsConcreteArtifactType(input.artifactType)) {
    return false;
  }
  if (input.forcePortalClick !== undefined && typeof input.forcePortalClick !== "boolean") {
    return false;
  }
  return true;
}

function isFiledReturnsDownloadScope(input: unknown): input is FiledReturnsDownloadScope {
  if (!isRecord(input)) return false;
  if (typeof input.financialYear !== "string") return false;
  if (!/^20\d{2}-\d{2}$/.test(input.financialYear)) return false;
  if (typeof input.period !== "string" || input.period.length === 0 || input.period.length > 20) {
    return false;
  }
  if (!isFiledReturnsReturnType(input.returnType)) return false;
  if (
    !isSupportedArtifactSelection({
      artifactType: input.artifactType,
      returnType: input.returnType,
    })
  ) {
    return false;
  }
  if (
    input.completedPeriods !== undefined &&
    (!Array.isArray(input.completedPeriods) ||
      !input.completedPeriods.every(
        (period) => typeof period === "string" && period.length > 0 && period.length <= 20,
      ))
  ) {
    return false;
  }

  const artifactType = isFiledReturnsArtifactType(input.artifactType)
    ? input.artifactType
    : undefined;
  const scope: FiledReturnsDownloadScope = {
    financialYear: input.financialYear,
    period: input.period,
    returnType: input.returnType,
    ...(artifactType ? { artifactType } : {}),
    ...(input.completedPeriods ? { completedPeriods: input.completedPeriods } : {}),
  };
  return isSupportedFiledReturnsScope(scope);
}

function isFiledReturnsStartScope(input: unknown): input is FiledReturnsDownloadScope {
  if (!isFiledReturnsScopeShape(input)) return false;
  return isSupportedFiledReturnsStartScope(toFiledReturnsScope(input));
}

function isFiledReturnsScopeShape(input: unknown): input is {
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsArtifactType;
  completedPeriods?: string[];
} {
  if (!isRecord(input)) return false;
  if (typeof input.financialYear !== "string") return false;
  if (!/^20\d{2}-\d{2}$/.test(input.financialYear)) return false;
  if (typeof input.period !== "string" || input.period.length === 0 || input.period.length > 24) {
    return false;
  }
  if (!isFiledReturnsReturnType(input.returnType)) return false;
  if (
    !isSupportedArtifactSelection({
      artifactType: input.artifactType,
      returnType: input.returnType,
    })
  ) {
    return false;
  }
  if (
    input.completedPeriods !== undefined &&
    (!Array.isArray(input.completedPeriods) ||
      !input.completedPeriods.every(
        (period) => typeof period === "string" && period.length > 0 && period.length <= 20,
      ))
  ) {
    return false;
  }
  return true;
}

function toFiledReturnsScope(input: {
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsArtifactType;
  completedPeriods?: string[];
}): FiledReturnsDownloadScope {
  return {
    financialYear: input.financialYear,
    period: input.period,
    returnType: input.returnType,
    ...(input.artifactType ? { artifactType: input.artifactType } : {}),
    ...(input.completedPeriods ? { completedPeriods: input.completedPeriods } : {}),
  };
}

function isSupportedArtifactSelection(input: {
  returnType: FiledReturnsReturnType;
  artifactType?: unknown;
}): boolean {
  const artifactType = input.artifactType ?? "PDF";
  return (
    isFiledReturnsArtifactType(artifactType) &&
    supportsFiledReturnsArtifactType(input.returnType, artifactType)
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isPortalObservation(input: unknown): input is PortalObservation {
  return (
    isRecord(input) &&
    typeof input.connectorId === "string" &&
    typeof input.pageKind === "string" &&
    typeof input.scopeId === "string" &&
    typeof input.state === "string" &&
    typeof input.safeMessage === "string" &&
    Array.isArray(input.safeSignals) &&
    input.safeSignals.every((signal) => typeof signal === "string")
  );
}
