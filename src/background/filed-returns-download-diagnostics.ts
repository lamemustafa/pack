import type {
  BrowserDownloadSafeEvidence,
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadEndpointClass,
  FiledReturnsDownloadPathClass,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../connectors/gst/filed-returns-contracts";
import { isValidFiledReturnsDownloadErrorCategory } from "./filed-returns-download-diagnostic-state";

export type DownloadAttemptClass =
  "captured-portal-request" | "extension-direct" | "portal-click" | "target-bound-portal-click";

export function withFiledReturnsDownloadDiagnostic({
  attemptClass,
  flowStep,
  safeEvidence,
  target,
}: {
  attemptClass: DownloadAttemptClass;
  flowStep: PortalFlowStepResult;
  safeEvidence?: BrowserDownloadSafeEvidence | undefined;
  target: FiledReturnsDownloadTarget;
}): PortalFlowStepResult {
  const category = errorCategory(flowStep);
  return {
    ...flowStep,
    downloadDiagnostic: {
      schemaVersion: "1.0",
      eventType: "filed-return-download-path",
      actionId: target.actionId,
      returnType: target.returnType,
      financialYear: target.financialYear,
      period: target.period,
      endpointClass: endpointClassForTarget(target, attemptClass),
      artifactType: target.artifactType ?? "PDF",
      downloadPathClass: downloadPathClass(attemptClass, safeEvidence),
      ...(safeEvidence?.downloadId !== undefined ? { downloadId: safeEvidence.downloadId } : {}),
      status: flowStep.state,
      ...(safeEvidence?.mimeClass ? { mimeClass: safeEvidence.mimeClass } : {}),
      ...(safeEvidence?.byteCountClass ? { byteCountClass: safeEvidence.byteCountClass } : {}),
      ...(category ? { errorCategory: category } : {}),
    } satisfies FiledReturnsDownloadDiagnostic,
  };
}

function endpointClassForTarget(
  target: FiledReturnsDownloadTarget,
  attemptClass: DownloadAttemptClass,
): FiledReturnsDownloadEndpointClass {
  if (target.returnType === "GSTR-3B" && attemptClass === "captured-portal-request") {
    return target.artifactType === "JSON"
      ? "gstr3b-main-world-json-captured-download"
      : "gstr3b-portal-blob-captured-download";
  }
  if (target.returnType === "GSTR-3B" && attemptClass === "extension-direct") {
    return "gstr3b-browser-managed-direct-download";
  }
  if (target.returnType === "GSTR-1" && attemptClass === "captured-portal-request") {
    return target.artifactType === "EXCEL"
      ? "gstr1-excel-portal-blob-captured-download"
      : "gstr1-pdf-portal-blob-captured-download";
  }
  if (target.returnType === "GSTR-2B" && attemptClass === "captured-portal-request") {
    return "gstr2b-portal-blob-captured-download";
  }
  if (target.returnType === "GSTR-3B") return "gstr3b-portal-rendered-download";
  if (target.returnType === "GSTR-1" && target.artifactType === "EXCEL") {
    return "gstr1-excel-portal-rendered-download";
  }
  if (target.returnType === "GSTR-1") return "gstr1-pdf-portal-rendered-download";
  return "filed-return-portal-rendered-download";
}

function downloadPathClass(
  attemptClass: DownloadAttemptClass,
  safeEvidence: BrowserDownloadSafeEvidence | undefined,
): FiledReturnsDownloadPathClass {
  if (attemptClass === "target-bound-portal-click") {
    return safeEvidence?.urlClass === "blob"
      ? "target-bound-portal-click-blob"
      : "portal-click-unknown";
  }
  const suffix = safeEvidence?.urlClass ?? "unknown";
  return `${attemptClass}-${suffix}` as FiledReturnsDownloadPathClass;
}

function errorCategory(flowStep: PortalFlowStepResult): string | null {
  if (flowStep.safeSignals.some((signal) => signal.startsWith("browser-download-error-"))) {
    return "browser-download-interrupted";
  }
  return flowStep.safeSignals.find(isValidFiledReturnsDownloadErrorCategory) ?? null;
}
