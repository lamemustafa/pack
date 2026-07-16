import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  activateElement,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import type { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import { navigateToFiledReturnsPage } from "./filed-returns-navigator";
import { filedReturnDescriptor, filedReturnScopeId } from "./filed-returns-return-descriptors";

export function shouldReturnFromMismatchedDetail(
  detailIdentity: ReturnType<typeof extractFiledReturnsDetailIdentity>,
  scope: FiledReturnsDownloadScope,
): boolean {
  if (!detailIdentity.period || !detailIdentity.financialYear) return false;
  return !filedReturnDetailIdentityMatchesScope(detailIdentity, scope);
}

export function filedReturnDetailIdentityMatchesScope(
  detailIdentity: ReturnType<typeof extractFiledReturnsDetailIdentity>,
  scope: FiledReturnsDownloadScope,
): boolean {
  if (!detailIdentity.period || !detailIdentity.financialYear) return false;
  return (
    detailIdentity.returnType === scope.returnType &&
    matchesAcceptedText(detailIdentity.period, [scope.period]) &&
    matchesAcceptedText(detailIdentity.financialYear, [scope.financialYear])
  );
}

export async function returnFromMismatchedFiledGstr1Page(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  detailIdentity: ReturnType<typeof extractFiledReturnsDetailIdentity>,
): Promise<PortalFlowStepResult | null> {
  if (scope.returnType !== "GSTR-1") return null;
  if (!shouldReturnFromMismatchedDetail(detailIdentity, scope)) return null;

  const navigation = await navigateToFiledReturnsPage(documentRef);
  if (navigation.state !== "candidate-not-found") {
    return {
      ...navigation,
      scopeId: filedReturnScopeId("GSTR-1"),
      safeSignals: ["filed-gstr1-scope-switch-navigation", ...navigation.safeSignals],
      safeMessage:
        navigation.state === "clicked"
          ? "Pack used the GST Portal navigation to leave the prior filed GSTR-1 period before selecting the requested period."
          : navigation.safeMessage,
    };
  }

  return (
    returnFromMismatchedFiledGstr1Summary(documentRef, scope, detailIdentity) ??
    clickFiledReturnDetailBack(documentRef, scope)
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

export function waitForFiledGstr1ExcelControl(
  scope: FiledReturnsDownloadScope,
  safeSignals: readonly string[],
  isTargetBoundDetail: boolean,
): PortalFlowStepResult | null {
  if (scope.returnType !== "GSTR-1" || scope.artifactType !== "EXCEL") return null;
  if (!isTargetBoundDetail || safeSignals.includes("download-excel-gstr-1")) return null;
  if (safeSignals.includes("gstr-1-summary-route") || safeSignals.includes("download-pdf-gstr-1")) {
    return null;
  }

  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-1"),
    state: "clicked",
    safeSignals: ["filed-gstr1-target-bound-detail", "filed-gstr1-excel-control-pending"],
    safeMessage:
      "Pack verified the filed GSTR-1 period and is waiting for its e-invoice details Excel control.",
  };
}

export function returnFromMismatchedFiledGstr1Summary(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  detailIdentity: ReturnType<typeof extractFiledReturnsDetailIdentity>,
): PortalFlowStepResult | null {
  if (scope.returnType !== "GSTR-1") return null;
  if (!isGstr1SummaryRoute(documentRef)) return null;
  if (!shouldReturnFromMismatchedDetail(detailIdentity, scope)) return null;

  const view = documentRef.defaultView;
  if (!view) {
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-1"),
      state: "user-action-required",
      safeSignals: ["filed-gstr1-summary-period-mismatch", "filed-gstr1-summary-back-unavailable"],
      safeMessage:
        "Pack found a filed GSTR-1 summary for a different period, but could not return to the prior portal page.",
    };
  }

  view.history.back();
  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-1"),
    state: "clicked",
    safeSignals: ["filed-gstr1-summary-period-mismatch", "filed-gstr1-summary-back-clicked"],
    safeMessage:
      "Pack returned from the prior filed GSTR-1 summary before selecting the requested period.",
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
  if (!summaryControl) {
    return {
      connectorId: "gst",
      scopeId: filedReturnScopeId("GSTR-1"),
      state: "clicked",
      safeSignals: [
        safeSignals.includes("gstr-1-detail-route")
          ? "gstr-1-detail-route"
          : "filed-gstr1-target-bound-detail",
        "filed-gstr1-summary-view-pending",
      ],
      safeMessage: "Pack is waiting for the filed GSTR-1 View Summary control.",
    };
  }

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
  return /\/returns\/auth\/gstr1\/gstr1sum\/?$/i.test(
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
