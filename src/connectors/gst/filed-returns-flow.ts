import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import { runGstr2bDownloadStep } from "./gstr2b-flow";
import {
  activateElement,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import { resolveVisibleFiledReturnDownloadCandidates } from "./filed-returns-download-candidates";
import {
  dismissKnownFiledReturnsSummaryModal,
  navigateToFiledReturnsPage,
} from "./filed-returns-navigator";
import { openFiledReturnFromApiSearch } from "./filed-returns-api-search";
import { selectFiledReturnsFiltersAndSearch } from "./filed-returns-filter-form";
import { detectPositiveNotFiledEvidence } from "./filed-returns-not-filed-evidence";
import { observeFiledReturnsPageText } from "./filed-returns-observer";
import { detectFiledReturnsPortalAvailabilityIssue } from "./filed-returns-portal-availability";
import { findMatchingActionableFiledReturnRows } from "./filed-returns-result-rows";
import {
  filedReturnDescriptor,
  filedReturnScopedSignal,
  filedReturnScopeId,
} from "./filed-returns-return-descriptors";
import { clearFiledReturnsSearchAttempt } from "./filed-returns-search-state";

export async function runFiledReturnsDownloadStep(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<PortalFlowStepResult> {
  if (scope.returnType === "GSTR-2B") return runGstr2bDownloadStep(documentRef, scope);

  const descriptor = filedReturnDescriptor(scope.returnType);
  const scopeId = filedReturnScopeId(scope.returnType);
  const portalAvailabilityIssue = detectFiledReturnsPortalAvailabilityIssue(documentRef);
  if (portalAvailabilityIssue) {
    clearFiledReturnsSearchAttempt(documentRef);
    return portalAvailabilityIssue;
  }

  if (isGstr2bSummaryRoute(documentRef)) {
    clearFiledReturnsSearchAttempt(documentRef);
    const navigation = await navigateToFiledReturnsPage(documentRef);
    return withOptionalUserAction(
      {
        connectorId: "gst",
        scopeId,
        state: navigation.state,
        safeSignals: ["gstr2b-summary-route-mismatched-return", ...navigation.safeSignals],
        safeMessage:
          navigation.state === "clicked"
            ? `Pack left the GSTR-2B summary page to find the filed ${descriptor.label} return.`
            : navigation.safeMessage,
      },
      navigation.userAction,
    );
  }

  await dismissKnownFiledReturnsSummaryModal(documentRef);
  const observation = observeFiledReturnsPageText(getBodyText(documentRef), {
    ...(documentRef.defaultView?.location.pathname
      ? { pathname: documentRef.defaultView.location.pathname }
      : {}),
  });

  if (observation.state === "login-required") {
    clearFiledReturnsSearchAttempt(documentRef);
    return withOptionalUserAction(
      {
        connectorId: "gst",
        scopeId,
        state: "login-required",
        safeSignals: observation.safeSignals,
        safeMessage: observation.safeMessage,
      },
      observation.userAction,
    );
  }

  if (observation.state !== "ready") {
    const deadEndBackNavigation = returnFromFiledReturnDeadEndBack(
      documentRef,
      scope,
      observation.safeSignals,
    );
    if (deadEndBackNavigation) return deadEndBackNavigation;
  }

  if (observation.state === "ready") {
    const detailIdentity = extractFiledReturnsDetailIdentity(documentRef, scope.returnType);
    if (shouldReturnFromMismatchedDetail(detailIdentity, scope)) {
      return clickFiledReturnDetailBack(documentRef, scope);
    }
    const gstr1DetailNavigation = returnFromFiledGstr1SummaryForExcel(
      documentRef,
      scope,
      observation.safeSignals,
    );
    if (gstr1DetailNavigation) return gstr1DetailNavigation;
    const gstr1SummaryNavigation = clickFiledGstr1SummaryForPdf(
      documentRef,
      scope,
      observation.safeSignals,
    );
    if (gstr1SummaryNavigation) return gstr1SummaryNavigation;
    const deadEndBackNavigation = returnFromFiledReturnDeadEndBack(
      documentRef,
      scope,
      observation.safeSignals,
    );
    if (deadEndBackNavigation) return deadEndBackNavigation;
    return {
      connectorId: "gst",
      scopeId,
      state: "ready",
      safeSignals: [
        "filed-return-download-ready",
        filedReturnScopedSignal(scope.returnType, "download-ready"),
        ...detailIdentity.safeSignals,
      ],
      safeMessage: `Pack found the filed ${descriptor.label} detail page and is ready to start the browser download.`,
    };
  }

  if (isFiledReturnsSearchSurface(observation.safeSignals)) {
    const notFiledEvidence = detectPositiveNotFiledEvidence(documentRef, scope, scopeId);
    if (notFiledEvidence) {
      return notFiledEvidence;
    }
  }

  if (observation.state === "filters-required") {
    const apiSearchResult = await openFiledReturnFromApiSearch(documentRef, scope, scopeId);
    if (apiSearchResult) return apiSearchResult;

    const selectionResult = await selectFiledReturnsFiltersAndSearch(documentRef, scope, scopeId);
    if (shouldTryApiSearchFallback(selectionResult)) {
      const apiSearchResult = await openFiledReturnFromApiSearch(documentRef, scope, scopeId);
      if (apiSearchResult) return apiSearchResult;
    }
    return selectionResult;
  }

  if (observation.state === "filed-return-results-visible") {
    return openFiledReturnResultRow(documentRef, scope);
  }

  if (observation.state === "page-settling") {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [...observation.safeSignals, "filed-returns-page-settling"],
      safeMessage: observation.safeMessage,
    };
  }

  if (observation.state === "wrong-page") {
    clearFiledReturnsSearchAttempt(documentRef);
    const navigation = await navigateToFiledReturnsPage(documentRef);
    return withOptionalUserAction(
      {
        connectorId: "gst",
        scopeId,
        state: navigation.state,
        safeSignals: navigation.safeSignals,
        safeMessage: navigation.safeMessage,
      },
      navigation.userAction,
    );
  }

  return withOptionalUserAction(
    {
      connectorId: "gst",
      scopeId,
      state: "user-action-required",
      safeSignals: observation.safeSignals,
      safeMessage: observation.safeMessage,
    },
    observation.userAction,
  );
}

function returnFromFiledReturnDeadEndBack(
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

function openFiledReturnResultRow(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): PortalFlowStepResult {
  const descriptor = filedReturnDescriptor(scope.returnType);
  const scopeId = filedReturnScopeId(scope.returnType);
  const actionableRows = findMatchingActionableFiledReturnRows(documentRef, scope);

  if (actionableRows.length > 1) {
    return {
      connectorId: "gst",
      scopeId,
      state: "blocked",
      safeSignals: ["filed-return-result-row-ambiguous"],
      safeMessage: `Pack found more than one filed ${descriptor.label} result row for the requested period. Open the correct row manually, then start Pack again.`,
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: `Open the exact filed ${descriptor.label} row for the requested period.`,
        canResume: true,
      },
    };
  }

  const actionableRow = actionableRows[0];
  if (actionableRow) {
    activateElement(actionableRow.view);
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [
        "filed-return-result-view-clicked",
        `result-row-${descriptor.signalSlug}`,
        ...(actionableRow.period ? [`filed-return-result-period:${actionableRow.period}`] : []),
      ],
      safeMessage: `Pack opened the filed ${descriptor.label} result row.`,
    };
  }

  return {
    connectorId: "gst",
    scopeId,
    state: "candidate-not-found",
    safeSignals: ["filed-return-result-row-not-found"],
    safeMessage: `Pack could not find a filed ${descriptor.label} result row for the selected period. Check the portal results and start Pack again.`,
  };
}

function isFiledReturnsSearchSurface(safeSignals: readonly string[]): boolean {
  return (
    safeSignals.includes("filed-returns-heading") &&
    (safeSignals.includes("filter-form") ||
      safeSignals.includes("view-download-column") ||
      safeSignals.includes("search-action") ||
      safeSignals.includes("filed-returns-route"))
  );
}

function shouldReturnFromMismatchedDetail(
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

function shouldTryApiSearchFallback(step: PortalFlowStepResult): boolean {
  return (
    step.safeSignals.includes("filed-return-filter-selection-in-progress") ||
    step.safeSignals.includes("filed-return-filter-candidate-not-found")
  );
}

function clickFiledReturnDetailBack(
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

function returnFromFiledGstr1SummaryForExcel(
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

function clickFiledGstr1SummaryForPdf(
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

function scopeIncludesPdfArtifact(scope: FiledReturnsDownloadScope): boolean {
  return scope.artifactType !== "EXCEL";
}

function isGstr1SummaryRoute(documentRef: Document): boolean {
  return /\/returns\/auth\/gstr1\/gstr1sum$/i.test(
    documentRef.defaultView?.location.pathname ?? "",
  );
}

function isGstr2bSummaryRoute(documentRef: Document): boolean {
  return /\/gstr2b\/auth\/gstr2b\/summary\/?$/i.test(
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

function getBodyText(documentRef: Document): string {
  const body = documentRef.body;
  if (!body) return "";

  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  if (!HTMLElementConstructor) return body.innerText || body.textContent || "";

  return getVisibleText(body, HTMLElementConstructor);
}

function withOptionalUserAction(
  result: Omit<PortalFlowStepResult, "userAction">,
  userAction: PortalFlowStepResult["userAction"],
): PortalFlowStepResult {
  return userAction ? { ...result, userAction } : result;
}

function getVisibleText(element: HTMLElement, HTMLElementConstructor: typeof HTMLElement): string {
  if (!isTextVisible(element)) return "";

  const childText = Array.from(element.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElementConstructor)
    .map((child) => getVisibleText(child, HTMLElementConstructor))
    .filter(Boolean)
    .join(" ");

  const ownText = Array.from(element.childNodes)
    .filter((child) => child.nodeType === child.TEXT_NODE)
    .map((child) => child.textContent ?? "")
    .join(" ");

  return [ownText, childText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function isTextVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !(style?.display === "none" || style?.visibility === "hidden");
}
