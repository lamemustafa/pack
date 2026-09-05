import type {
  ArchiveManifest,
  PortalContext,
  PortalDownloadTriggerResult,
  PortalNavigationResult,
  PortalObservation,
} from "../../core/contracts";
import type {
  FiledReturnsMainWorldCaptureRequest,
  FiledReturnsAllSupportedFullFiscalYearFlowSummary,
  FiledReturnsFlowSummary,
  FiledReturnsAllSupportedFullFiscalYearRequest,
  FiledReturnsDownloadScope,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "./filed-returns-contracts";
import {
  createAllSupportedFullFiscalYearRequest,
  isAllSupportedFullFiscalYearRequest,
  isAllSupportedFullFiscalYearRestartRequest,
} from "./filed-returns-all-supported-full-fiscal-year";
import type { ArtifactRequest, ArtifactFailureReason } from "./artifact-source";
import {
  FULL_FISCAL_YEAR_PERIOD,
  isStructurallySupportedFiledReturnsScope,
  isStructurallySupportedFiledReturnsStartScope as hasStructurallySupportedFiledReturnsStartScope,
  isSupportedFiledReturnsStartScope,
} from "./filed-returns-scope";
import { isCanonicalFullFiscalYearLedgerId } from "./filed-returns-ledger-id";
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

export const PACK_CONTENT_SCRIPT_PROTOCOL_VERSION = 34;
export const PACK_CONTENT_REQUEST_ENVELOPE_TYPE =
  `PACK_CONTENT_REQUEST_V${PACK_CONTENT_SCRIPT_PROTOCOL_VERSION}` as const;

export interface DownloadPromptProbeResult {
  status: "started" | "start-rejected";
  safeSignals: string[];
  safeMessage: string;
  filenameClass: "synthetic-download-prompt-probe";
  saveAsFalse: true;
  sourceClass: "data-url" | "offscreen-blob-url";
  downloadId?: number;
}

export interface FiledGstr3bDirectDownloadReady {
  actionId: string;
  safeSignals: string[];
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
        resolution: "manually-observed" | "cancelled";
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
      type: "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW";
      payload: FiledReturnsAllSupportedFullFiscalYearRequest;
    }
  | {
      type: "PACK_RESTART_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW";
      /** Names the reviewed ledger so a superseded root is refused, not removed. */
      payload: FiledReturnsAllSupportedFullFiscalYearRequest & { ledgerId: string };
    }
  | {
      type: "PACK_RETRY_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_TARGET";
      payload: AllSupportedFullFiscalYearTargetRecoveryPayload;
    }
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
  | { type: "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34"; payload: ArtifactRequest }
  | { type: "PACK_CONTENT_OPEN_RETURNS_DASHBOARD_V34"; payload?: undefined }
  | {
      type: "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3";
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
      type: "PACK_CONTENT_CLEAR_FILED_RETURNS_SEARCH_PENDING_V3";
      payload: FiledReturnsDownloadScope;
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
      mainWorldCaptureRequest: FiledReturnsMainWorldCaptureRequest;
      downloadTrigger: PortalDownloadTriggerResult;
      observation?: PortalObservation | null;
    }
  | {
      ok: true;
      directDownloadReady: FiledGstr3bDirectDownloadReady;
      observation?: PortalObservation | null;
    }
  | {
      ok: true;
      artifact:
        | { ok: true; state: "ready"; requestId: string; safeSignals: string[] }
        | { ok: false; requestId: string; reason: ArtifactFailureReason; safeSignals: string[] };
    }
  | {
      ok: true;
      returnsDashboardNavigation: "clicked" | "not-found" | "ambiguous";
    }
  | {
      ok: true;
      flowStep: PortalFlowStepResult;
      flowSummary?: FiledReturnsFlowSummary;
      observation?: PortalObservation | null;
    }
  | {
      ok: true;
      flowStep: PortalFlowStepResult;
      /** Present as `undefined` so existing atomic-flow readers can safely
       * discriminate this response without treating it as an atomic summary. */
      flowSummary?: never;
      allSupportedFullFiscalYearFlowSummary: FiledReturnsAllSupportedFullFiscalYearFlowSummary;
    }
  | { ok: true; flowSummary: FiledReturnsFlowSummary | null }
  | {
      ok: true;
      allSupportedFullFiscalYearFlowSummary: FiledReturnsAllSupportedFullFiscalYearFlowSummary | null;
    }
  | { ok: true; manifest: ArchiveManifest | null }
  | { ok: true; downloaded: number; manifest: ArchiveManifest }
  | { ok: true; downloadPromptProbe: DownloadPromptProbeResult }
  | { ok: true; cleared: true }
  | {
      ok: false;
      error: string;
      safeMessage?: string;
      safeSite?: `background-message-handler:${string}`;
    };

export type ContentScriptUnavailableReason = "empty-response" | "unreachable";

export function contentScriptUnavailableResponse(
  reason: ContentScriptUnavailableReason,
): Extract<PackMessageResponse, { ok: false }> {
  return {
    ok: false,
    error: "CONTENT_SCRIPT_UNAVAILABLE",
    safeMessage:
      reason === "empty-response"
        ? "The GST tab responded to Pack without a usable result. Reload the GST Portal tab, then try again."
        : "Pack could not safely reach the GST tab. Reload the GST Portal tab, then try again.",
  };
}

export interface FullFiscalYearTargetRecoveryPayload {
  ledgerId: string;
  targetId: string;
  expectedRevision: number;
}

/**
 * Bound to one immutable all-supported plan target. A retry is an explicit
 * reader action, never an inference from a prior ambiguous download.
 */
export interface AllSupportedFullFiscalYearTargetRecoveryPayload {
  financialYear: string;
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

export interface PackMessagePayloadValidators {
  portalContext?: (input: unknown) => boolean;
  portalObservation?: (input: unknown) => boolean;
}

export function isPackMessage(
  input: unknown,
  payloadValidators: PackMessagePayloadValidators = {},
): input is PackMessage {
  if (!isRecord(input) || typeof input.type !== "string") return false;
  if (!hasOnlyKeys(input, ["type", "payload"])) return false;

  switch (input.type) {
    case "PACK_CONTENT_CONTEXT":
      return payloadValidators.portalContext?.(input.payload) === true;
    case "PACK_FILED_RETURNS_OBSERVATION":
      return payloadValidators.portalObservation?.(input.payload) === true;
    case "PACK_PING":
    case "PACK_CONTENT_PING_V2":
    case "PACK_GET_CONTEXT":
      return input.payload === undefined;
    case "PACK_RUN_DOWNLOAD_PROMPT_PROBE":
      return (
        input.payload === undefined ||
        (isRecord(input.payload) &&
          hasOnlyKeys(input.payload, ["sourceClass"]) &&
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
    case "PACK_CONTENT_OPEN_RETURNS_DASHBOARD_V34":
      return input.payload === undefined;
    case "PACK_RETRY_FILED_RETURNS_TARGET":
      return isStructurallySupportedFiledReturnsStartScope(input.payload);
    case "PACK_RETRY_FULL_FISCAL_YEAR_TARGET":
      return isFullFiscalYearTargetRecoveryPayload(input.payload);
    case "PACK_RETRY_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_TARGET":
      return isAllSupportedFullFiscalYearTargetRecoveryPayload(input.payload);
    case "PACK_RESOLVE_UNCONFIRMED_DOWNLOAD":
      return isUnconfirmedDownloadResolution(input.payload);
    case "PACK_RESOLVE_FULL_FISCAL_YEAR_TARGET":
      return isFullFiscalYearTargetResolution(input.payload);
    case "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD":
    case "PACK_CONTENT_TRIGGER_FILED_GSTR3B_DOWNLOAD_V3":
    case "PACK_CONTENT_INSPECT_FILED_RETURN_POST_CLICK_V3":
      return isFiledReturnsDownloadTarget(input.payload);
    case "PACK_CONTENT_ACQUIRE_FILED_RETURN_ARTIFACT_V34":
      return isArtifactRequest(input.payload);
    case "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP":
    case "PACK_CONTENT_RUN_FILED_RETURNS_DOWNLOAD_STEP_V3":
    case "PACK_CONTENT_MARK_FILED_RETURNS_SEARCH_PENDING_V3":
    case "PACK_CONTENT_CLEAR_FILED_RETURNS_SEARCH_PENDING_V3":
      return isFiledReturnsDownloadScope(input.payload);
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return isFiledReturnsStartScope(input.payload);
    case "PACK_START_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW":
      // Deliberately not sharing the restart predicate: a start carries the
      // root identity and nothing else, and folding the two together would let
      // a bound ledger id through a message that has no use for one.
      return isAllSupportedFullFiscalYearRequest(input.payload);
    case "PACK_RESTART_ALL_SUPPORTED_FILED_RETURNS_FULL_FISCAL_YEAR_FLOW":
      return isAllSupportedFullFiscalYearRestartRequest(input.payload);
    case "PACK_START_FRESH_FILED_RETURNS_DOWNLOAD_FLOW":
      return isFiledReturnsFreshStartPayload(input.payload);
    case "PACK_START_SYNTHETIC_DEMO":
      return (
        input.payload === undefined ||
        (isRecord(input.payload) &&
          hasOnlyKeys(input.payload, ["downloadArtifacts"]) &&
          (input.payload.downloadArtifacts === undefined ||
            typeof input.payload.downloadArtifacts === "boolean"))
      );
    case "PACK_CLEAR_LOCAL_DATA":
    case "PACK_GET_LAST_MANIFEST":
      return input.payload === undefined;
    default:
      return false;
  }
}

function isArtifactRequest(input: unknown): input is ArtifactRequest {
  return (
    isRecord(input) &&
    hasOnlyKeys(input, [
      "returnType",
      "artifactType",
      "financialYear",
      "period",
      "returnPeriod",
      "requestId",
    ]) &&
    isFiledReturnsReturnType(input.returnType) &&
    isFiledReturnsConcreteArtifactType(input.artifactType) &&
    supportsFiledReturnsArtifactType(input.returnType, input.artifactType) &&
    isBoundedString(input.financialYear, 1, 20) &&
    isBoundedString(input.period, 1, 20) &&
    /^\d{6}$/.test(String(input.returnPeriod)) &&
    isBoundedString(input.requestId, 1, 120)
  );
}

function isFullFiscalYearTargetRecoveryPayload(
  input: unknown,
): input is FullFiscalYearTargetRecoveryPayload {
  if (!isRecord(input) || !hasOnlyKeys(input, ["ledgerId", "targetId", "expectedRevision"])) {
    return false;
  }
  return hasFullFiscalYearTargetRecoveryFields(input);
}

function isAllSupportedFullFiscalYearTargetRecoveryPayload(
  input: unknown,
): input is AllSupportedFullFiscalYearTargetRecoveryPayload {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["financialYear", "ledgerId", "targetId", "expectedRevision"])
  ) {
    return false;
  }
  return (
    typeof input.financialYear === "string" &&
    createAllSupportedFullFiscalYearRequest(input.financialYear) !== null &&
    isCanonicalFullFiscalYearLedgerId(input.ledgerId) &&
    isBoundedString(input.targetId, 1, 120) &&
    typeof input.expectedRevision === "number" &&
    Number.isInteger(input.expectedRevision) &&
    input.expectedRevision >= 1
  );
}

function hasFullFiscalYearTargetRecoveryFields(input: Record<string, unknown>): boolean {
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
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["ledgerId", "targetId", "expectedRevision", "resolution"])
  ) {
    return false;
  }
  if (input.resolution !== "manually-observed" && input.resolution !== "cancelled") return false;
  return hasFullFiscalYearTargetRecoveryFields(input);
}

function isUnconfirmedDownloadResolution(input: unknown): input is {
  scope: FiledReturnsDownloadScope;
  resolution: "manually-observed" | "cancelled";
} {
  if (!isRecord(input) || !hasOnlyKeys(input, ["scope", "resolution"])) return false;
  if (input.resolution !== "manually-observed" && input.resolution !== "cancelled") return false;
  return isStructurallySupportedFiledReturnsStartScope(input.scope);
}
function isFiledReturnsFreshStartPayload(input: unknown): input is FiledReturnsFreshStartPayload {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["scope", "recovery"]) ||
    !isFiledReturnsStartScope(input.scope) ||
    !isRecord(input.recovery)
  ) {
    return false;
  }
  if (input.recovery.kind === "target-review") {
    return (
      hasOnlyKeys(input.recovery, ["kind", "scope"]) &&
      isStructurallySupportedFiledReturnsStartScope(input.recovery.scope)
    );
  }
  return (
    input.recovery.kind === "full-fiscal-year" &&
    hasOnlyKeys(input.recovery, ["kind", "ledgerId", "targetId", "expectedRevision"]) &&
    hasFullFiscalYearTargetRecoveryFields(input.recovery)
  );
}

function isBoundedString(input: unknown, minLength: number, maxLength: number): input is string {
  return typeof input === "string" && input.length >= minLength && input.length <= maxLength;
}

function isFiledReturnsDownloadTarget(input: unknown): input is FiledReturnsDownloadTarget {
  if (!isRecord(input)) return false;
  if (!hasOnlyKeys(input, ["actionId", "financialYear", "period", "returnType", "artifactType"])) {
    return false;
  }
  if (
    typeof input.actionId !== "string" ||
    input.actionId.length === 0 ||
    input.actionId.length > 80
  ) {
    return false;
  }
  const scope = {
    financialYear: input.financialYear,
    period: input.period,
    returnType: input.returnType,
    artifactType: input.artifactType,
  };
  if (!isFiledReturnsDownloadScope(scope)) return false;
  if (scope.period === "ALL" || scope.period === FULL_FISCAL_YEAR_PERIOD) return false;
  if (scope.artifactType !== undefined && !isFiledReturnsConcreteArtifactType(scope.artifactType)) {
    return false;
  }
  return true;
}

function isFiledReturnsDownloadScope(input: unknown): input is FiledReturnsDownloadScope {
  if (!isRecord(input)) return false;
  if (
    !hasOnlyKeys(input, [
      "financialYear",
      "period",
      "returnType",
      "artifactType",
      "completedPeriods",
    ])
  ) {
    return false;
  }
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
  return isStructurallySupportedFiledReturnsScope(scope);
}

function isFiledReturnsStartScope(input: unknown): input is FiledReturnsDownloadScope {
  if (!isFiledReturnsScopeShape(input)) return false;
  return isSupportedFiledReturnsStartScope(toFiledReturnsScope(input));
}

function isStructurallySupportedFiledReturnsStartScope(
  input: unknown,
): input is FiledReturnsDownloadScope {
  return (
    isFiledReturnsScopeShape(input) &&
    hasStructurallySupportedFiledReturnsStartScope(toFiledReturnsScope(input))
  );
}

function isFiledReturnsScopeShape(input: unknown): input is {
  financialYear: string;
  period: string;
  returnType: FiledReturnsReturnType;
  artifactType?: FiledReturnsArtifactType;
  completedPeriods?: string[];
} {
  if (!isRecord(input)) return false;
  if (
    !hasOnlyKeys(input, [
      "financialYear",
      "period",
      "returnType",
      "artifactType",
      "completedPeriods",
    ])
  ) {
    return false;
  }
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

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}
