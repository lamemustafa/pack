import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import { runGstr2bDownloadStep } from "./gstr2b-flow";
import { activateElement } from "./filed-returns-dom";
import { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import { dismissKnownFiledReturnsSummaryModal } from "./filed-returns-dialogs";
import { navigateToFiledReturnsPage } from "./filed-returns-navigator";
import { openFiledReturnFromApiSearch } from "./filed-returns-api-search";
import { selectFiledReturnsFiltersAndSearch } from "./filed-returns-filter-form";
import { detectPositiveNotFiledEvidence } from "./filed-returns-not-filed-evidence";
import { observeFiledReturnsPageText } from "./filed-returns-observer";
import {
  clickFiledGstr1SummaryForPdf,
  clickFiledReturnDetailBack,
  isGstr2bSummaryRoute,
  returnFromFiledGstr1SummaryForExcel,
  returnFromFiledReturnDeadEndBack,
  shouldReturnFromMismatchedDetail,
} from "./filed-returns-detail-navigation";
import { getBodyText } from "./filed-returns-page-text";
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

function shouldTryApiSearchFallback(step: PortalFlowStepResult): boolean {
  return (
    step.safeSignals.includes("filed-return-filter-selection-in-progress") ||
    step.safeSignals.includes("filed-return-filter-candidate-not-found")
  );
}

function withOptionalUserAction(
  result: Omit<PortalFlowStepResult, "userAction">,
  userAction: PortalFlowStepResult["userAction"],
): PortalFlowStepResult {
  return userAction ? { ...result, userAction } : result;
}
