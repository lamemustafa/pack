import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  activateElement,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
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
import { clearFiledReturnsSearchAttempt } from "./filed-returns-search-state";

const FILED_RETURNS_SCOPE_ID = "gst-filed-returns-gstr3b-pdf-private-v0";
export async function runFiledReturnsDownloadStep(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<PortalFlowStepResult> {
  const portalAvailabilityIssue = detectFiledReturnsPortalAvailabilityIssue(documentRef);
  if (portalAvailabilityIssue) {
    clearFiledReturnsSearchAttempt(documentRef);
    return portalAvailabilityIssue;
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
        scopeId: FILED_RETURNS_SCOPE_ID,
        state: "login-required",
        safeSignals: observation.safeSignals,
        safeMessage: observation.safeMessage,
      },
      observation.userAction,
    );
  }

  if (observation.state === "ready") {
    const detailIdentity = extractFiledReturnsDetailIdentity(documentRef);
    if (shouldReturnFromMismatchedDetail(detailIdentity, scope)) {
      return clickFiledReturnDetailBack(documentRef);
    }
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "ready",
      safeSignals: ["filed-gstr3b-download-ready", ...detailIdentity.safeSignals],
      safeMessage:
        "Pack found the filed GSTR-3B detail page and is ready to start the browser download.",
    };
  }

  if (isFiledReturnsSearchSurface(observation.safeSignals)) {
    const notFiledEvidence = detectPositiveNotFiledEvidence(
      documentRef,
      scope,
      FILED_RETURNS_SCOPE_ID,
    );
    if (notFiledEvidence) {
      return notFiledEvidence;
    }
  }

  if (observation.state === "filters-required") {
    const apiSearchResult = await openFiledReturnFromApiSearch(
      documentRef,
      scope,
      FILED_RETURNS_SCOPE_ID,
    );
    if (apiSearchResult) return apiSearchResult;

    const selectionResult = await selectFiledReturnsFiltersAndSearch(
      documentRef,
      scope,
      FILED_RETURNS_SCOPE_ID,
    );
    if (shouldTryApiSearchFallback(selectionResult)) {
      const apiSearchResult = await openFiledReturnFromApiSearch(
        documentRef,
        scope,
        FILED_RETURNS_SCOPE_ID,
      );
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
      scopeId: FILED_RETURNS_SCOPE_ID,
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
        scopeId: FILED_RETURNS_SCOPE_ID,
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
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: observation.safeSignals,
      safeMessage: observation.safeMessage,
    },
    observation.userAction,
  );
}

function openFiledReturnResultRow(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): PortalFlowStepResult {
  const actionableRows = findMatchingActionableFiledReturnRows(documentRef, scope);

  if (actionableRows.length > 1) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "blocked",
      safeSignals: ["filed-return-result-row-ambiguous"],
      safeMessage:
        "Pack found more than one filed GSTR-3B result row for the requested period. Open the correct row manually, then start Pack again.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open the exact filed GSTR-3B row for the requested period.",
        canResume: true,
      },
    };
  }

  const actionableRow = actionableRows[0];
  if (actionableRow) {
    activateElement(actionableRow.view);
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "clicked",
      safeSignals: [
        "filed-return-result-view-clicked",
        "result-row-gstr3b",
        ...(actionableRow.period ? [`filed-return-result-period:${actionableRow.period}`] : []),
      ],
      safeMessage: "Pack opened the filed GSTR-3B result row.",
    };
  }

  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "candidate-not-found",
    safeSignals: ["filed-return-result-row-not-found"],
    safeMessage:
      "Pack could not find a filed GSTR-3B result row for the selected period. Check the portal results and start Pack again.",
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

function clickFiledReturnDetailBack(documentRef: Document): PortalFlowStepResult {
  const backButton = getClickableElements(documentRef).find((element) => {
    const text = normaliseText(element.innerText || element.textContent || "");
    return text === "back";
  });

  if (!backButton) {
    return {
      connectorId: "gst",
      scopeId: FILED_RETURNS_SCOPE_ID,
      state: "user-action-required",
      safeSignals: ["filed-return-detail-back-not-found"],
      safeMessage:
        "Pack downloaded this filed GSTR-3B, but could not find the portal Back button to continue the financial year.",
    };
  }

  activateElement(backButton);
  return {
    connectorId: "gst",
    scopeId: FILED_RETURNS_SCOPE_ID,
    state: "clicked",
    safeSignals: ["filed-return-detail-back-clicked"],
    safeMessage: "Pack returned from the filed GSTR-3B detail page to continue the year.",
  };
}

function getBodyText(documentRef: Document): string {
  return documentRef.body?.innerText || documentRef.body?.textContent || "";
}

function withOptionalUserAction(
  result: Omit<PortalFlowStepResult, "userAction">,
  userAction: PortalFlowStepResult["userAction"],
): PortalFlowStepResult {
  return userAction ? { ...result, userAction } : result;
}
