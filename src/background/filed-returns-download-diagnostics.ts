import type {
  BrowserDownloadSafeEvidence,
  FiledReturnsDownloadDiagnostic,
  FiledReturnsDownloadEndpointClass,
  FiledReturnsDownloadPathClass,
  FiledReturnsDownloadTarget,
  PortalFlowStepResult,
} from "../core/contracts";

type DownloadAttemptClass =
  | "extension-direct"
  | "portal-click"
  | "portal-click-after-direct-fallback"
  | "captured-portal-request";

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
      ...(safeEvidence?.downloadId ? { downloadId: safeEvidence.downloadId } : {}),
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
  if (attemptClass === "extension-direct" && target.returnType === "GSTR-3B") {
    return "gstr3b-getgenpdf";
  }
  if (target.returnType === "GSTR-3B" && attemptClass === "captured-portal-request") {
    return "gstr3b-portal-blob-captured-download";
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
  const suffix = safeEvidence?.urlClass ?? "unknown";
  return `${attemptClass}-${suffix}` as FiledReturnsDownloadPathClass;
}

function errorCategory(flowStep: PortalFlowStepResult): string | null {
  const directFailure = flowStep.safeSignals.find((signal) =>
    signal.startsWith("filed-gstr3b-direct-download-"),
  );
  if (directFailure && flowStep.state !== "downloaded") return directFailure;

  const browserFailure = flowStep.safeSignals.find((signal) =>
    signal.startsWith("browser-download-error-"),
  );
  if (browserFailure) return browserFailure;

  const gstr2bCaptureFailure = flowStep.safeSignals.find((signal) =>
    signal.startsWith("gstr2b-captured-download-"),
  );
  if (gstr2bCaptureFailure) return gstr2bCaptureFailure;

  const capturedDownloadFailure = flowStep.safeSignals.find(isCapturedDownloadFailureSignal);
  if (capturedDownloadFailure) {
    return capturedDownloadFailure;
  }

  if (flowStep.safeSignals.includes("browser-download-zero-bytes")) {
    return "browser-download-zero-bytes";
  }
  if (flowStep.safeSignals.includes("browser-download-size-unknown")) {
    return "browser-download-size-unknown";
  }
  if (flowStep.safeSignals.includes("browser-download-correlation-rejected")) {
    return "browser-download-correlation-rejected";
  }
  if (flowStep.safeSignals.includes("browser-download-not-observed")) {
    return "browser-download-not-observed";
  }
  return null;
}

function isCapturedDownloadFailureSignal(signal: string): boolean {
  return (
    signal === "filed-return-offscreen-blob-url-rejected" ||
    signal.endsWith("-blob-capture-failed") ||
    signal.endsWith("-captured-download-data-url-rejected") ||
    signal.endsWith("-extension-download-start-rejected")
  );
}
