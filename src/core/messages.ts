import type {
  ArchiveManifest,
  FiledReturnsFlowSummary,
  FiledReturnsDownloadScope,
  PortalDownloadTriggerResult,
  PortalContext,
  PortalFlowStepResult,
  PortalNavigationResult,
  PortalObservation,
} from "./contracts";
import { isSupportedFiledReturnsScope } from "./filed-returns-scope";

export type PackMessage =
  | { type: "PACK_CONTENT_CONTEXT"; payload: PortalContext }
  | { type: "PACK_FILED_RETURNS_OBSERVATION"; payload: PortalObservation }
  | { type: "PACK_GET_CONTEXT" }
  | { type: "PACK_GET_FILED_RETURNS_OBSERVATION" }
  | { type: "PACK_GET_FILED_RETURNS_FLOW_SUMMARY" }
  | { type: "PACK_REFRESH_FILED_RETURNS_OBSERVATION" }
  | { type: "PACK_NAVIGATE_FILED_RETURNS" }
  | { type: "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD" }
  | { type: "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP"; payload: FiledReturnsDownloadScope }
  | { type: "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW"; payload: FiledReturnsDownloadScope }
  | { type: "PACK_START_SYNTHETIC_DEMO" }
  | { type: "PACK_CLEAR_LOCAL_DATA" }
  | { type: "PACK_GET_LAST_MANIFEST" };

export type PackMessageResponse =
  | { ok: true; context: PortalContext | null }
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
      flowStep: PortalFlowStepResult;
      flowSummary?: FiledReturnsFlowSummary;
      observation?: PortalObservation | null;
    }
  | { ok: true; flowSummary: FiledReturnsFlowSummary | null }
  | { ok: true; manifest: ArchiveManifest | null }
  | { ok: true; downloaded: number; manifest: ArchiveManifest }
  | { ok: true; cleared: true }
  | { ok: false; error: string };

export function isPackMessage(input: unknown): input is PackMessage {
  if (!isRecord(input) || typeof input.type !== "string") return false;

  switch (input.type) {
    case "PACK_CONTENT_CONTEXT":
      return isRecord(input.payload);
    case "PACK_FILED_RETURNS_OBSERVATION":
      return isPortalObservation(input.payload);
    case "PACK_GET_CONTEXT":
    case "PACK_GET_FILED_RETURNS_OBSERVATION":
    case "PACK_GET_FILED_RETURNS_FLOW_SUMMARY":
    case "PACK_REFRESH_FILED_RETURNS_OBSERVATION":
    case "PACK_NAVIGATE_FILED_RETURNS":
    case "PACK_TRIGGER_FILED_GSTR3B_DOWNLOAD":
      return true;
    case "PACK_RUN_FILED_RETURNS_DOWNLOAD_STEP":
    case "PACK_START_FILED_RETURNS_DOWNLOAD_FLOW":
      return isFiledReturnsDownloadScope(input.payload);
    case "PACK_START_SYNTHETIC_DEMO":
    case "PACK_CLEAR_LOCAL_DATA":
    case "PACK_GET_LAST_MANIFEST":
      return true;
    default:
      return false;
  }
}

function isFiledReturnsDownloadScope(input: unknown): input is FiledReturnsDownloadScope {
  if (!isRecord(input)) return false;
  if (typeof input.financialYear !== "string") return false;
  if (!/^20\d{2}-\d{2}$/.test(input.financialYear)) return false;
  if (typeof input.period !== "string" || input.period.length === 0 || input.period.length > 20) {
    return false;
  }
  if (input.returnType !== "GSTR-3B") return false;
  if (
    input.completedPeriods !== undefined &&
    (!Array.isArray(input.completedPeriods) ||
      !input.completedPeriods.every(
        (period) => typeof period === "string" && period.length > 0 && period.length <= 20,
      ))
  ) {
    return false;
  }

  const scope: FiledReturnsDownloadScope = {
    financialYear: input.financialYear,
    period: input.period,
    returnType: input.returnType,
    ...(input.completedPeriods ? { completedPeriods: input.completedPeriods } : {}),
  };
  return isSupportedFiledReturnsScope(scope);
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
