import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import { activateElement, matchesAcceptedText, normaliseText } from "./filed-returns-dom";
import {
  dismissSafePostLoginDialogs,
  hasVisibleSafePostLoginDialog,
} from "./filed-returns-dialogs";
import { navigateToReturnDashboardPage } from "./filed-returns-navigator";
import { detectFiledReturnsPortalAvailabilityIssue } from "./filed-returns-portal-availability";
import { findMatchingActionableFiledReturnRows } from "./filed-returns-result-rows";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import { selectFiledReturnsFiltersAndSearch } from "./filed-returns-filter-form";
import {
  hasGstr2bLoginEvidence,
  isGstr2bAuthRoute,
  isGstr2bSummaryPage,
  readDocumentText,
  returnFromMismatchedGstr2bSummary,
  verifyVisibleGstr2bPeriod,
} from "./gstr2b-summary";
import { findGstr2bDashboardControl } from "./gstr2b-dashboard-view";
import {
  clearGstr2bDashboardSearchPending,
  isReturnDashboardRoute,
  isReturnDashboardStillRendering,
  selectGstr2bReturnDashboardFiltersAndSearch,
} from "./gstr2b-dashboard-filters";

const FILED_RETURNS_ROUTE = /\/returns\/auth\/efiledReturns\/?$/i;

export async function runGstr2bDownloadStep(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<PortalFlowStepResult> {
  const portalAvailabilityIssue = detectFiledReturnsPortalAvailabilityIssue(documentRef);
  if (portalAvailabilityIssue) return portalAvailabilityIssue;

  const scopeId = filedReturnScopeId("GSTR-2B");
  const safeSignals = await dismissSafePostLoginDialogs(documentRef);
  if (hasVisibleSafePostLoginDialog(documentRef)) {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [...safeSignals, "safe-dialog-still-visible", "gstr2b-dialog-dismissal-waiting"],
      safeMessage:
        "Pack clicked the safe GST Portal dialog action and is waiting for the portal overlay to close before continuing.",
    };
  }

  const text = readDocumentText(documentRef);
  const normalised = normaliseText(text);

  if (hasGstr2bLoginEvidence(documentRef, normalised)) {
    return {
      connectorId: "gst",
      scopeId,
      state: "login-required",
      safeSignals: ["login"],
      safeMessage: "Sign in to the GST Portal, then reopen Pack.",
      userAction: {
        type: "LOGIN",
        message: "Sign in to the GST Portal in this browser tab, then reopen Pack.",
        canResume: true,
      },
    };
  }

  if (isGstr2bSummaryPage(documentRef, normalised)) {
    const periodGuard = verifyVisibleGstr2bPeriod(documentRef, normalised, scope);
    if (periodGuard) {
      const recovery = returnFromMismatchedGstr2bSummary(documentRef, scopeId, [
        ...safeSignals,
        ...periodGuard.safeSignals,
      ]);
      if (recovery) return recovery;
      return periodGuard;
    }
    return {
      connectorId: "gst",
      scopeId,
      state: "ready",
      safeSignals: [
        ...safeSignals,
        "gstr2b-summary-route",
        "gstr2b-visible-period-verified",
        "gstr2b-download-ready",
        "filed-return-download-ready",
      ],
      safeMessage:
        "Pack found the GSTR-2B summary page and is ready to capture the GST Portal's generated file.",
    };
  }

  if (isGstr2bAuthRoute(documentRef)) {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [...safeSignals, "gstr2b-auth-route", "gstr2b-summary-loading"],
      safeMessage:
        "Pack opened the GST GSTR-2B app and is waiting for the summary download controls to render.",
    };
  }

  if (isReturnDashboardRoute(documentRef)) {
    if (isReturnDashboardStillRendering(documentRef, text)) {
      return {
        connectorId: "gst",
        scopeId,
        state: "clicked",
        safeSignals: [...safeSignals, "gstr2b-return-dashboard-loading"],
        safeMessage:
          "Pack opened the GST Return Dashboard and is waiting for the portal controls to render.",
      };
    }

    const dashboardSelection = await selectGstr2bReturnDashboardFiltersAndSearch(
      documentRef,
      scope,
      scopeId,
      safeSignals,
    );
    if (dashboardSelection) return dashboardSelection;
  }

  if (isFiledReturnsRoute(documentRef)) {
    const filedReturnsSelection = await selectGstr2bFiledReturnsFiltersOrResult(
      documentRef,
      scope,
      scopeId,
    );
    if (filedReturnsSelection) return filedReturnsSelection;
  }

  const viewControl = findGstr2bDashboardControl(documentRef, "view");
  if (viewControl) {
    clearGstr2bDashboardSearchPending(documentRef);
    activateElement(viewControl);
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [...safeSignals, "gstr2b-dashboard-view-clicked"],
      safeMessage: "Pack opened the GSTR-2B summary page from the return dashboard.",
    };
  }

  const dashboardNavigation = await navigateToReturnDashboardPage(documentRef, scopeId);
  return {
    ...dashboardNavigation,
    safeSignals: ["gstr2b-wrong-page", ...dashboardNavigation.safeSignals],
    safeMessage:
      dashboardNavigation.state === "clicked"
        ? "Pack clicked the GST Return Dashboard entry. After the portal loads, click Start download again so Pack can open GSTR-2B from the dashboard row."
        : dashboardNavigation.safeMessage,
  };
}

async function selectGstr2bFiledReturnsFiltersOrResult(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): Promise<PortalFlowStepResult | null> {
  const actionableRows = findMatchingActionableFiledReturnRows(documentRef, scope);
  if (actionableRows.length > 1) {
    return {
      connectorId: "gst",
      scopeId,
      state: "blocked",
      safeSignals: ["gstr2b-filed-return-result-row-ambiguous"],
      safeMessage:
        "Pack found more than one filed GSTR-2B result row for the requested period. Open the correct row manually, then start Pack again.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: "Open the exact filed GSTR-2B row for the requested period.",
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
        "gstr2b-filed-return-result-view-clicked",
        ...(actionableRow.period ? [`filed-return-result-period:${actionableRow.period}`] : []),
      ],
      safeMessage: "Pack opened the filed GSTR-2B result row.",
    };
  }

  if (!filedReturnsPageOffersGstr2b(documentRef)) {
    const navigation = await navigateToReturnDashboardPage(documentRef, scopeId);
    return {
      ...navigation,
      safeSignals: ["gstr2b-filed-returns-no-gstr2b-option", ...navigation.safeSignals],
      safeMessage:
        navigation.state === "clicked"
          ? "Pack left View Filed Returns for the GST Return Dashboard because this portal page does not offer GSTR-2B in its return-type list."
          : navigation.safeMessage,
    };
  }

  return selectFiledReturnsFiltersAndSearch(documentRef, scope, scopeId);
}

function filedReturnsPageOffersGstr2b(documentRef: Document): boolean {
  return Array.from(documentRef.querySelectorAll("option")).some((option) =>
    matchesAcceptedText(option.textContent || option.value, ["GSTR-2B"]),
  );
}

function isFiledReturnsRoute(documentRef: Document): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return FILED_RETURNS_ROUTE.test(pathname);
}
