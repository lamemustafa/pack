import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  activateElement,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import type { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import { resolveVisibleFiledReturnDownloadCandidates } from "./filed-returns-download-candidates";
import {
  filedReturnDescriptor,
  filedReturnScopedSignal,
  filedReturnScopeId,
} from "./filed-returns-return-descriptors";

export function returnFromFiledReturnDeadEndBack(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  safeSignals: readonly string[],
): PortalFlowStepResult | null {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  if (!filedReturnDescriptor(scope.returnType).detailRoutePattern.test(pathname)) return null;

  const hasDownloadControl =
    resolveVisibleFiledReturnDownloadCandidates(documentRef, scope.returnType, "PDF").length > 0 ||
    resolveVisibleFiledReturnDownloadCandidates(documentRef, scope.returnType, "EXCEL").length > 0;
  if (hasDownloadControl) return null;

  const backControl = getClickableElements(documentRef).find((element) => {
    const text = normaliseText(element.innerText || element.textContent || "");
    return text === "back" || text === "[go back]" || text === "go back";
  });
  if (!backControl) return null;

  activateElement(backControl);
  const descriptor = filedReturnDescriptor(scope.returnType);
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId(scope.returnType),
    state: "clicked",
    safeSignals: [
      ...safeSignals,
      filedReturnScopedSignal(scope.returnType, "detail-dead-end-back-clicked"),
    ],
    safeMessage: `Pack found a filed ${descriptor.label} page without download controls and clicked Back so it can reopen the requested period from the dashboard.`,
  };
}

export function shouldReturnFromMismatchedDetail(
  detailIdentity: ReturnType<typeof extractFiledReturnsDetailIdentity>,
  scope: FiledReturnsDownloadScope,
): boolean {
  if (!detailIdentity.period || !detailIdentity.financialYear) return false;
  return (
    detailIdentity.returnType !== scope.returnType ||
    !matchesAcceptedText(detailIdentity.period, [scope.period]) ||
    !matchesAcceptedText(detailIdentity.financialYear, [scope.financialYear])
  );
}

export function clickFiledReturnDetailBack(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): PortalFlowStepResult {
  const descriptor = filedReturnDescriptor(scope.returnType);
  const scopeId = filedReturnScopeId(scope.returnType);
  const backButton = getClickableElements(documentRef).find((element) => {
    const text = normaliseText(element.innerText || element.textContent || "");
    return text === "back";
  });

  if (!backButton) {
    return {
      connectorId: "gst",
      scopeId,
      state: "user-action-required",
      safeSignals: ["filed-return-detail-back-not-found"],
      safeMessage: `Pack downloaded this filed ${descriptor.label}, but could not find the portal Back button to continue the run.`,
    };
  }

  activateElement(backButton);
  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: ["filed-return-detail-back-clicked"],
    safeMessage: `Pack returned from the filed ${descriptor.label} detail page to continue.`,
  };
}

export function returnFromFiledGstr1SummaryForExcel(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  safeSignals: readonly string[],
): PortalFlowStepResult | null {
  if (scope.returnType !== "GSTR-1") return null;
  if (scope.artifactType !== "EXCEL") return null;
  if (safeSignals.includes("download-excel-gstr-1")) return null;
  if (
    !safeSignals.includes("gstr-1-summary-route") &&
    !safeSignals.includes("download-pdf-gstr-1")
  ) {
    return null;
  }

  const view = documentRef.defaultView;
  if (!view) {
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-1"),
      state: "user-action-required",
      safeSignals: ["filed-gstr1-summary-back-unavailable"],
      safeMessage:
        "Pack downloaded the filed GSTR-1 summary PDF, but could not return to the detail page for the e-invoice details Excel download.",
    };
  }

  view.history.back();
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-1"),
    state: "clicked",
    safeSignals: ["filed-gstr1-summary-back-clicked"],
    safeMessage:
      "Pack returned from the filed GSTR-1 View Summary page before downloading the e-invoice details Excel file.",
  };
}

export function clickFiledGstr1SummaryForPdf(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  safeSignals: readonly string[],
): PortalFlowStepResult | null {
  if (scope.returnType !== "GSTR-1") return null;
  if (!scopeIncludesPdfArtifact(scope)) return null;
  if (safeSignals.includes("download-pdf-gstr-1")) return null;
  if (isGstr1SummaryRoute(documentRef)) return null;

  const summaryControl = findGstr1ViewSummaryControl(documentRef);
  if (!summaryControl) return null;

  activateElement(summaryControl);
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-1"),
    state: "clicked",
    safeSignals: ["filed-gstr1-summary-view-clicked"],
    safeMessage:
      "Pack opened the filed GSTR-1 View Summary page before downloading the summary PDF.",
  };
}

export function isGstr2bSummaryRoute(documentRef: Document): boolean {
  return /\/gstr2b\/auth\/gstr2b\/summary\/?$/i.test(
    documentRef.defaultView?.location.pathname ?? "",
  );
}

function scopeIncludesPdfArtifact(scope: FiledReturnsDownloadScope): boolean {
  return scope.artifactType !== "EXCEL";
}

function isGstr1SummaryRoute(documentRef: Document): boolean {
  return /\/returns\/auth\/gstr1\/gstr1sum$/i.test(
    documentRef.defaultView?.location.pathname ?? "",
  );
}

function findGstr1ViewSummaryControl(documentRef: Document): HTMLElement | null {
  return (
    getClickableElements(documentRef).find((element) => {
      if (isSemanticallyHidden(element)) return false;
      const text = normaliseText(readClickableText(element));
      if (!/\bview\s+summary\b/.test(text)) return false;
      if (/\b(?:download|excel|pdf|save|submit|search|back|logout)\b/.test(text)) return false;
      return !/\b(?:file|proceed|continue)\b/.test(text) || /^view\s+summary\b/.test(text);
    }) ?? null
  );
}

function readClickableText(element: HTMLElement): string {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  const seenTexts = new Set<string>();
  return [
    "innerText" in element ? element.innerText : "",
    element.textContent ?? "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ]
    .filter((text) => {
      const comparable = normaliseText(text);
      if (!comparable || seenTexts.has(comparable)) return false;
      seenTexts.add(comparable);
      return true;
    })
    .join(" ");
}

function isSemanticallyHidden(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return Boolean(style && (style.display === "none" || style.visibility === "hidden"));
}
