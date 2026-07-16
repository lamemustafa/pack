import type { FiledReturnsDownloadTarget } from "../../core/contracts";
import type { FiledReturnsConcreteArtifactType } from "../../core/filed-returns-artifacts";
import { filedReturnDescriptor } from "./filed-returns-return-descriptors";

export function detectFiledReturnDetailPage(
  documentRef: Document,
  returnType: FiledReturnsDownloadTarget["returnType"],
  artifactType: FiledReturnsConcreteArtifactType,
): {
  isDetailPage: boolean;
  safeSignals: string[];
} {
  const descriptor = filedReturnDescriptor(returnType);
  const path = documentRef.defaultView?.location.pathname ?? "";
  const text = documentRef.body?.innerText ?? documentRef.body?.textContent ?? "";
  const normalised = text.replace(/\s+/g, " ").trim();
  const safeSignals: string[] = [];

  if (descriptor.detailRoutePattern.test(path)) {
    safeSignals.push(`${descriptor.signalSlug}-detail-route`);
  }
  if (descriptor.detailHeadingPattern.test(normalised)) {
    safeSignals.push(`${descriptor.signalSlug}-detail-heading`);
  }
  if (/\bstatus\s*-\s*filed\b|\bstatus\s+filed\b/i.test(normalised)) {
    safeSignals.push("status-filed");
  }
  if (descriptor.explicitDownloadPattern.test(normalised)) {
    safeSignals.push(`download-filed-${descriptor.signalSlug}-visible`);
  }
  if (descriptor.excelDownloadPattern?.test(normalised)) {
    safeSignals.push(`download-excel-${descriptor.signalSlug}-visible`);
  }
  if (descriptor.secondaryDownloadPattern?.test(normalised)) {
    safeSignals.push(`download-pdf-${descriptor.signalSlug}-visible`);
  }
  if (/\bno\s+files?\s+available\s+for\s+download\b/i.test(normalised)) {
    safeSignals.push("no-files-available-for-download");
  }
  if (
    artifactType === "EXCEL" &&
    returnType === "GSTR-1" &&
    !safeSignals.includes("status-filed")
  ) {
    safeSignals.push("filed-gstr1-download-status-not-filed");
  }

  const hasRequestedDownload =
    artifactType === "EXCEL"
      ? safeSignals.includes(`download-excel-${descriptor.signalSlug}-visible`)
      : safeSignals.includes(`download-filed-${descriptor.signalSlug}-visible`) ||
        safeSignals.includes(`download-pdf-${descriptor.signalSlug}-visible`);
  const hasRequiredFilingStatus =
    artifactType !== "EXCEL" || returnType !== "GSTR-1" || safeSignals.includes("status-filed");

  return {
    isDetailPage:
      hasRequiredFilingStatus &&
      (safeSignals.includes(`${descriptor.signalSlug}-detail-route`) ||
        (safeSignals.includes(`${descriptor.signalSlug}-detail-heading`) &&
          safeSignals.includes("status-filed"))) &&
      (hasRequestedDownload ||
        safeSignals.includes("status-filed") ||
        safeSignals.includes("no-files-available-for-download")),
    safeSignals,
  };
}
