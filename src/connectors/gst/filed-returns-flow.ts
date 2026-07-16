import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import { runGstr2bDownloadStep } from "./gstr2b-flow";
import { extractFiledReturnsDetailIdentity } from "./filed-returns-detail-identity";
import {
  dismissKnownFiledReturnsSummaryModal,
  isFiledReturnsSummaryModalDismissalBlocked,
} from "./filed-returns-dialogs";
import { navigateToFiledReturnsPage } from "./filed-returns-navigator";
import { openFiledReturnFromApiSearch } from "./filed-returns-api-search";
import { selectFiledReturnsFiltersAndSearch } from "./filed-returns-filter-form";
import { detectPositiveNotFiledEvidence } from "./filed-returns-not-filed-evidence";
import { observeFiledReturnsPageText } from "./filed-returns-observer";
import {
  clickFiledGstr1SummaryForPdf,
  clickFiledReturnDetailBack,
  filedReturnDetailIdentityMatchesScope,
  isGstr2bSummaryRoute,
  returnFromFiledGstr1SummaryForExcel,
  returnFromMismatchedFiledGstr1Page,
  shouldReturnFromMismatchedDetail,
  waitForFiledGstr1ExcelControl,
} from "./filed-returns-detail-navigation";
import { getBodyText } from "./filed-returns-page-text";
import { detectFiledReturnsPortalAvailabilityIssue } from "./filed-returns-portal-availability";
import { openFiledReturnResultRow } from "./filed-returns-result-row-navigation";
import {
  filedReturnDescriptor,
  filedReturnScopedSignal,
  filedReturnScopeId,
} from "./filed-returns-return-descriptors";
import {
  clearFiledReturnsSearchAttempt,
  clearFiledReturnsSearchAttemptForScope,
  hasPendingFiledReturnsSearchForScope,
  hasSettledFiledReturnsSearchForScope,
  hasUnchangedFiledReturnsSearchForScope,
} from "./filed-returns-search-state";

export async function runFiledReturnsDownloadStep(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<PortalFlowStepResult> {
  if (scope.returnType === "GSTR-2B") return runGstr2bDownloadStep(documentRef, scope);

  const descriptor = filedReturnDescriptor(scope.returnType);
  const scopeId = filedReturnScopeId(scope.returnType);
  const portalAvailabilityIssue = detectFiledReturnsPortalAvailabilityIssue(documentRef, scopeId);
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

  const summaryModalSignals = await dismissKnownFiledReturnsSummaryModal(documentRef);
  const observation = observeFiledReturnsPageText(getBodyText(documentRef), {
    ...(documentRef.defaultView?.location.pathname
      ? { pathname: documentRef.defaultView.location.pathname }
      : {}),
  });
  const searchSettled = hasSettledFiledReturnsSearchForScope(documentRef, scope);

  if (
    observation.state === "detail-summary-modal-open" &&
    isFiledReturnsSummaryModalDismissalBlocked(summaryModalSignals)
  ) {
    return summaryModalBlockedResult(scopeId, [...summaryModalSignals, ...observation.safeSignals]);
  }

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

  if (scope.returnType === "GSTR-1") {
    const detailIdentity = extractFiledReturnsDetailIdentity(documentRef, scope.returnType);
    const mismatchedPageNavigation = await returnFromMismatchedFiledGstr1Page(
      documentRef,
      scope,
      detailIdentity,
    );
    if (mismatchedPageNavigation) return mismatchedPageNavigation;
    const isTargetBoundDetail = filedReturnDetailIdentityMatchesScope(detailIdentity, scope);
    if (observation.safeSignals.includes("gstr-1-detail-route") || isTargetBoundDetail) {
      if (shouldReturnFromMismatchedDetail(detailIdentity, scope)) {
        return clickFiledReturnDetailBack(documentRef, scope);
      }
      const gstr1SummaryNavigation = clickFiledGstr1SummaryForPdf(
        documentRef,
        scope,
        observation.safeSignals,
      );
      if (gstr1SummaryNavigation) return gstr1SummaryNavigation;
      const gstr1ExcelControlWait = waitForFiledGstr1ExcelControl(
        scope,
        observation.safeSignals,
        isTargetBoundDetail,
      );
      if (gstr1ExcelControlWait) return gstr1ExcelControlWait;
    }
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

  if (hasUnchangedFiledReturnsSearchForScope(documentRef, scope)) {
    clearFiledReturnsSearchAttemptForScope(documentRef, scope);
    return {
      connectorId: "gst",
      scopeId,
      state: "candidate-not-found",
      safeSignals: ["filed-return-search-results-unchanged"],
      safeMessage:
        "The GST Portal left the previous filed-return results unchanged after Search. Retry this period instead of using the stale result.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Retry the selected filed-return period after the GST Portal results refresh.",
        canResume: true,
      },
    };
  }

  if (isFiledReturnsSearchSurface(observation.safeSignals)) {
    const notFiledEvidence = detectPositiveNotFiledEvidence(
      documentRef,
      scope,
      scopeId,
      searchSettled,
    );
    if (notFiledEvidence) {
      return notFiledEvidence;
    }
  }

  if (
    (observation.state === "filters-required" ||
      observation.state === "filed-return-results-visible") &&
    hasPendingFiledReturnsSearchForScope(documentRef, scope)
  ) {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: ["filed-return-search-results-pending"],
      safeMessage: "Pack is waiting for the GST Portal's filed-return search results.",
    };
  }

  if (observation.state === "filters-required") {
    const apiSearchResult = await openFiledReturnFromApiSearch(documentRef, scope, scopeId);
    if (apiSearchResult && !shouldFallBackToPortalFilterSelection(apiSearchResult)) {
      return apiSearchResult;
    }

    const selectionResult = await selectFiledReturnsFiltersAndSearch(documentRef, scope, scopeId);
    if (shouldTryApiSearchFallback(selectionResult)) {
      const apiSearchResult = await openFiledReturnFromApiSearch(documentRef, scope, scopeId);
      if (apiSearchResult && !shouldFallBackToPortalFilterSelection(apiSearchResult)) {
        return apiSearchResult;
      }
    }
    return selectionResult;
  }

  if (observation.state === "filed-return-results-visible") {
    const resultRow = openFiledReturnResultRow(documentRef, scope, searchSettled);
    if (
      scope.returnType === "GSTR-1" &&
      resultRow.safeSignals.includes("filed-return-result-row-not-found") &&
      !searchSettled
    ) {
      return selectFiledReturnsFiltersAndSearch(documentRef, scope, scopeId);
    }
    return resultRow;
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

  if (
    scope.returnType === "GSTR-1" &&
    (observation.state === "download-not-visible" || observation.state === "wrong-page") &&
    observation.safeSignals.includes("gstr-1") &&
    isAuthenticatedGstr1Route(documentRef)
  ) {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [...observation.safeSignals, "filed-gstr1-controls-pending"],
      safeMessage:
        "Pack is waiting for the authenticated GSTR-1 page to expose its target identity and download controls.",
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

function isAuthenticatedGstr1Route(documentRef: Document): boolean {
  return /^\/returns\/auth\/gstr1(?:\/|$)/i.test(documentRef.defaultView?.location.pathname ?? "");
}

function summaryModalBlockedResult(scopeId: string, safeSignals: string[]): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId,
    state: "blocked",
    safeSignals: [...new Set(safeSignals)],
    safeMessage:
      "Pack could not confirm that the GST Portal dismissed its GSTR-3B summary overlay. Wait for the portal to settle, then retry.",
    userAction: {
      type: "WAIT_FOR_PORTAL_AVAILABILITY",
      message:
        "Wait for the GST Portal overlay to finish closing. If it remains open, use its Close control, then retry Pack.",
      canResume: true,
    },
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

function shouldFallBackToPortalFilterSelection(step: PortalFlowStepResult): boolean {
  return step.safeSignals.includes("filed-return-api-result-role-status-unavailable");
}

function withOptionalUserAction(
  result: Omit<PortalFlowStepResult, "userAction">,
  userAction: PortalFlowStepResult["userAction"],
): PortalFlowStepResult {
  return userAction ? { ...result, userAction } : result;
}
