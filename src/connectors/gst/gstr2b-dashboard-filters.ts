import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  activateElement,
  delay,
  dispatchChange,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { acceptedFiledReturnsMonthTexts } from "./filed-returns-months";
import { findGstr2bDashboardControl } from "./gstr2b-dashboard-view";
import {
  diagnoseReturnDashboardControls,
  findReturnDashboardControls,
  selectedDashboardFilterSignals,
  type ReturnDashboardControls,
} from "./gstr2b-dashboard-selectors";

export { isReturnDashboardStillRendering } from "./gstr2b-dashboard-selectors";

const DASHBOARD_FIELD_SETTLE_DELAY_MS = 500;
const DASHBOARD_DEPENDENT_FIELD_ATTEMPTS = 6;

export async function selectGstr2bReturnDashboardFiltersAndSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  safeSignals: readonly string[],
): Promise<PortalFlowStepResult | null> {
  const diagnosticSignals = diagnoseReturnDashboardControls(documentRef);
  let controls = findReturnDashboardControls(documentRef);
  if (!controls) {
    if (findGstr2bDashboardControl(documentRef, "view")) return null;

    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [...safeSignals, ...diagnosticSignals],
      safeMessage:
        "Pack recognized the GST Return Dashboard and is waiting for the remaining dashboard controls to render. Diagnostic signals: " +
        diagnosticSignals.join(", "),
    };
  }

  const viewControl = findGstr2bDashboardControl(documentRef, "view");
  if (viewControl) {
    if (dashboardFiltersMatch(scope, controls.year, controls.quarter, controls.period)) return null;
    if (dashboardYearAndPeriodMatch(scope, controls.year, controls.period)) return null;
  }

  if (!selectMatches(controls.year, [scope.financialYear])) {
    const yearSelected = selectOption(controls.year, [scope.financialYear]);
    if (yearSelected) {
      await delay(DASHBOARD_FIELD_SETTLE_DELAY_MS);
      controls = findReturnDashboardControls(documentRef) ?? controls;
      return gstr2bDashboardSelectionInProgress(scopeId, safeSignals, diagnosticSignals, [
        "financial-year-selected",
        ...selectedDashboardFilterSignals(controls),
      ]);
    }
  }

  if (controls.quarter && !selectMatches(controls.quarter, acceptedQuarterOptions(scope.period))) {
    const quarterSelected = selectOption(controls.quarter, acceptedQuarterOptions(scope.period));
    if (quarterSelected) {
      controls = await waitForReturnDashboardPeriodOptions(documentRef, scope, controls);
      return gstr2bDashboardSelectionInProgress(scopeId, safeSignals, diagnosticSignals, [
        "quarter-selected",
        ...selectedDashboardFilterSignals(controls),
      ]);
    }
  }

  if (!selectMatches(controls.period, acceptedFiledReturnsMonthTexts(scope.period))) {
    const periodSelected = selectOption(
      controls.period,
      acceptedFiledReturnsMonthTexts(scope.period),
    );
    if (periodSelected) {
      await delay(DASHBOARD_FIELD_SETTLE_DELAY_MS);
      controls = findReturnDashboardControls(documentRef) ?? controls;
      return gstr2bDashboardSelectionInProgress(scopeId, safeSignals, diagnosticSignals, [
        "period-selected",
        ...selectedDashboardFilterSignals(controls),
      ]);
    }
  }

  if (!dashboardFiltersMatch(scope, controls.year, controls.quarter, controls.period)) {
    return gstr2bDashboardSelectionInProgress(scopeId, safeSignals, diagnosticSignals, [
      ...selectedDashboardFilterSignals(controls),
    ]);
  }

  activateElement(controls.search);
  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: [
      ...safeSignals,
      ...diagnosticSignals,
      "gstr2b-return-dashboard-filters-selected",
      ...selectedDashboardFilterSignals(controls),
      "search-clicked",
    ],
    safeMessage: "Pack selected the GSTR-2B return dashboard filters and clicked Search.",
  };
}

export function isReturnDashboardRoute(documentRef: Document): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return /\/returns\/auth\/dashboard\/?$/i.test(pathname);
}

function gstr2bDashboardSelectionInProgress(
  scopeId: string,
  safeSignals: readonly string[],
  diagnosticSignals: readonly string[],
  selectionSignals: readonly string[],
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: [
      ...safeSignals,
      ...diagnosticSignals,
      "gstr2b-return-dashboard-filter-selection-in-progress",
      ...selectionSignals,
    ],
    safeMessage:
      "Pack selected part of the GSTR-2B return dashboard filters and is waiting for the GST portal to finish updating them.",
  };
}

async function waitForReturnDashboardPeriodOptions(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  fallbackControls: ReturnDashboardControls,
): Promise<ReturnDashboardControls> {
  for (let attempt = 0; attempt < DASHBOARD_DEPENDENT_FIELD_ATTEMPTS; attempt += 1) {
    await delay(DASHBOARD_FIELD_SETTLE_DELAY_MS);
    const controls = findReturnDashboardControls(documentRef) ?? fallbackControls;
    if (selectHasAcceptedOption(controls.period, acceptedFiledReturnsMonthTexts(scope.period))) {
      return controls;
    }
    fallbackControls = controls;
  }

  return fallbackControls;
}

function acceptedQuarterOptions(period: string): string[] {
  const normalisedPeriod = normaliseText(period);
  if (["april", "may", "june"].includes(normalisedPeriod)) {
    return ["Quarter 1", "Q1", "Apr-Jun", "Apr - Jun", "April-June", "April - June"];
  }
  if (["july", "august", "september"].includes(normalisedPeriod)) {
    return ["Quarter 2", "Q2", "Jul-Sep", "Jul - Sep", "July-September", "July - September"];
  }
  if (["october", "november", "december"].includes(normalisedPeriod)) {
    return ["Quarter 3", "Q3", "Oct-Dec", "Oct - Dec", "October-December", "October - December"];
  }
  return ["Quarter 4", "Q4", "Jan-Mar", "Jan - Mar", "January-March", "January - March"];
}

function dashboardFiltersMatch(
  scope: FiledReturnsDownloadScope,
  yearSelect: HTMLSelectElement,
  quarterSelect: HTMLSelectElement | null,
  periodSelect: HTMLSelectElement,
): boolean {
  return (
    selectMatches(yearSelect, [scope.financialYear]) &&
    (!quarterSelect || selectMatches(quarterSelect, acceptedQuarterOptions(scope.period))) &&
    selectMatches(periodSelect, acceptedFiledReturnsMonthTexts(scope.period))
  );
}

function dashboardYearAndPeriodMatch(
  scope: FiledReturnsDownloadScope,
  yearSelect: HTMLSelectElement,
  periodSelect: HTMLSelectElement,
): boolean {
  return (
    selectMatches(yearSelect, [scope.financialYear]) &&
    selectMatches(periodSelect, acceptedFiledReturnsMonthTexts(scope.period))
  );
}

function selectOption(select: HTMLSelectElement, acceptedTexts: readonly string[]): boolean {
  if (selectMatches(select, acceptedTexts)) return true;

  const option = findAcceptedOption(select, acceptedTexts);
  if (!option) return false;

  select.focus();
  select.value = option.value;
  select.selectedIndex = option.index;
  option.selected = true;
  dispatchChange(select);
  return true;
}

function selectMatches(select: HTMLSelectElement, acceptedTexts: readonly string[]): boolean {
  return matchesAcceptedText(select.selectedOptions[0]?.textContent || select.value, acceptedTexts);
}

function selectHasAcceptedOption(
  select: HTMLSelectElement,
  acceptedTexts: readonly string[],
): boolean {
  return Boolean(findAcceptedOption(select, acceptedTexts));
}

function findAcceptedOption(
  select: HTMLSelectElement,
  acceptedTexts: readonly string[],
): HTMLOptionElement | null {
  return (
    Array.from(select.options).find((candidate) =>
      matchesAcceptedText(candidate.textContent || candidate.value, acceptedTexts),
    ) ?? null
  );
}
