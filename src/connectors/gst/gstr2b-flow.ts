import type {
  FiledReturnsDownloadScope,
  PortalDownloadTriggerResult,
  PortalFlowStepResult,
} from "../../core/contracts";
import {
  activateElement,
  delay,
  dispatchChange,
  getClickableElements,
  isHtmlElement,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { findKnownGstSelect, findLabelledSelects } from "./filed-returns-filter-fields";
import { acceptedFiledReturnsMonthTexts } from "./filed-returns-months";
import {
  clickBestReturnDashboardCandidate,
  dismissSafePostLoginDialogs,
  navigateToReturnDashboardPage,
} from "./filed-returns-navigator";
import { detectFiledReturnsPortalAvailabilityIssue } from "./filed-returns-portal-availability";
import { findMatchingActionableFiledReturnRows } from "./filed-returns-result-rows";
import { filedReturnScopeId } from "./filed-returns-return-descriptors";
import { selectFiledReturnsFiltersAndSearch } from "./filed-returns-filter-form";

const GSTR2B_SUMMARY_ROUTE = /\/gstr2b\/auth\/gstr2b\/summary\/?$/i;
const GSTR2B_AUTH_ROUTE = /\/gstr2b\/auth(?:\/|$)/i;
const FILED_RETURNS_ROUTE = /\/returns\/auth\/efiledReturns\/?$/i;
const DASHBOARD_FIELD_SETTLE_DELAY_MS = 500;
const DASHBOARD_DEPENDENT_FIELD_ATTEMPTS = 6;
const FINANCIAL_YEAR_LABEL = /financial\s+year/i;
const QUARTER_LABEL = /^quarter\b/i;
const PERIOD_LABEL = /^period\b|^tax\s+period\b|^month\b/i;

type ReturnDashboardControls = {
  year: HTMLSelectElement;
  quarter: HTMLSelectElement;
  period: HTMLSelectElement;
  search: HTMLElement;
};

export async function runGstr2bDownloadStep(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<PortalFlowStepResult> {
  const portalAvailabilityIssue = detectFiledReturnsPortalAvailabilityIssue(documentRef);
  if (portalAvailabilityIssue) return portalAvailabilityIssue;

  const scopeId = filedReturnScopeId("GSTR-2B");
  const safeSignals = await dismissSafePostLoginDialogs(documentRef);
  const text = readDocumentText(documentRef);
  const normalised = normaliseText(text);

  if (hasLoginEvidence(documentRef, normalised)) {
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
    const periodGuard = verifyVisibleGstr2bPeriod(normalised, scope);
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
    activateElement(viewControl);
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [...safeSignals, "gstr2b-dashboard-view-clicked"],
      safeMessage: "Pack opened the GSTR-2B summary page from the return dashboard.",
    };
  }

  const dashboardNavigation = clickBestReturnDashboardCandidate(
    documentRef,
    "gstr2b-wrong-page",
    safeSignals,
    scopeId,
  );
  if (dashboardNavigation) {
    return {
      ...dashboardNavigation,
      safeMessage:
        "Pack clicked the GST Return Dashboard entry. After the portal loads, click Start download again so Pack can open GSTR-2B from the dashboard row.",
    };
  }

  return {
    connectorId: "gst",
    scopeId,
    state: "user-action-required",
    safeSignals: ["gstr2b-summary-not-open"],
    safeMessage:
      "Open the GSTR-2B summary page for the requested month, or select the period on the GST return dashboard and click View for GSTR-2B.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Open the GSTR-2B summary page for the requested month.",
      canResume: true,
    },
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

export function verifyVisibleGstr2bSummaryScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): PortalDownloadTriggerResult | null {
  const normalised = normaliseText(readDocumentText(documentRef));
  if (!isGstr2bSummaryPage(documentRef, normalised)) return null;
  return verifyVisibleGstr2bPeriod(normalised, scope);
}

function verifyVisibleGstr2bPeriod(
  normalisedText: string,
  scope: FiledReturnsDownloadScope,
): PortalDownloadTriggerResult | null {
  const visiblePeriod = extractGstr2bLabelValue(normalisedText, "return period");
  const visibleFinancialYear = extractGstr2bLabelValue(normalisedText, "financial year");
  const monthMatches = visiblePeriod
    ? matchesAcceptedText(visiblePeriod, acceptedFiledReturnsMonthTexts(scope.period))
    : acceptedFiledReturnsMonthTexts(scope.period).some((period) =>
        matchesAcceptedText(normalisedText, [period]),
      );
  const yearMatches = visibleFinancialYear
    ? matchesAcceptedText(visibleFinancialYear, [scope.financialYear])
    : expectedCalendarYears(scope).some((year) => normalisedText.includes(year));
  if (monthMatches && yearMatches) return null;

  return {
    connectorId: "gst",
    scopeId: filedReturnScopeId("GSTR-2B"),
    state: "blocked",
    safeSignals: ["gstr2b-visible-period-mismatch"],
    safeMessage:
      "Pack found a GSTR-2B summary page, but could not verify that its visible period matches the requested scope.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: "Open the GSTR-2B summary page for the requested month and financial year.",
      canResume: true,
    },
  };
}

function extractGstr2bLabelValue(
  normalisedText: string,
  label: "financial year" | "return period",
): string | null {
  const pattern =
    label === "financial year"
      ? /\bfinancial\s+year\s*[-:]\s*([0-9]{4}\s*-\s*[0-9]{2})\b/
      : /\breturn\s+period\s*[-:]\s*([a-z]+)\b/;
  const match = normalisedText.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function returnFromMismatchedGstr2bSummary(
  documentRef: Document,
  scopeId: string,
  safeSignals: readonly string[],
): PortalFlowStepResult | null {
  const dashboardBackControl = findGstr2bSummaryDashboardBackControl(documentRef);
  if (dashboardBackControl) {
    activateElement(dashboardBackControl);
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: Array.from(
        new Set([
          ...safeSignals,
          "gstr2b-summary-period-mismatch",
          "gstr2b-summary-dashboard-back-clicked",
        ]),
      ),
      safeMessage:
        "Pack found a GSTR-2B summary for a different period and clicked Back to Dashboard so it can select the requested period.",
    };
  }

  const history = documentRef.defaultView?.history;
  if (history && typeof history.back === "function") {
    history.back();
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: Array.from(
        new Set([...safeSignals, "gstr2b-summary-period-mismatch", "gstr2b-summary-back-clicked"]),
      ),
      safeMessage:
        "Pack found a GSTR-2B summary for a different period and returned to the GST Return Dashboard so it can select the requested period.",
    };
  }

  const dashboardNavigation = clickBestReturnDashboardCandidate(
    documentRef,
    "gstr2b-summary-period-mismatch",
    safeSignals,
    scopeId,
  );
  if (!dashboardNavigation) return null;
  return {
    ...dashboardNavigation,
    safeMessage:
      "Pack found a GSTR-2B summary for a different period and opened the GST Return Dashboard so it can select the requested period.",
  };
}

async function selectGstr2bReturnDashboardFiltersAndSearch(
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

  if (!selectMatches(controls.quarter, acceptedQuarterOptions(scope.period))) {
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

function findReturnDashboardControls(documentRef: Document): ReturnDashboardControls | null {
  const root =
    findReturnDashboardFilterRoot(documentRef) ?? findNativeReturnDashboardRoot(documentRef);
  if (!root) return null;

  const body = documentRef.body ?? root;
  const year =
    findDashboardControlSelect(root, FINANCIAL_YEAR_LABEL, "financial-year") ??
    findDashboardControlSelect(body, FINANCIAL_YEAR_LABEL, "financial-year");
  const quarter =
    findDashboardControlSelect(root, QUARTER_LABEL, "quarter") ??
    findDashboardControlSelect(body, QUARTER_LABEL, "quarter");
  const period =
    findDashboardControlSelect(root, PERIOD_LABEL, "period") ??
    findDashboardControlSelect(body, PERIOD_LABEL, "period");
  const search = findSearchButton(root) ?? findSearchButton(body);
  if (!year || !quarter || !period || !search) return null;
  return { year, quarter, period, search };
}

function findDashboardControlSelect(
  root: HTMLElement,
  labelPattern: RegExp,
  role: "financial-year" | "quarter" | "period",
): HTMLSelectElement | null {
  const nativeDashboardSelects = findNativeDashboardSelects(root);
  const orderedFallbackSelects = findOrderedDashboardSelects(root);
  return (
    nativeDashboardSelects[role === "financial-year" ? "year" : role] ??
    findDashboardSelect(root, labelPattern, role) ??
    orderedFallbackSelects[role === "financial-year" ? "year" : role]
  );
}

function diagnoseReturnDashboardControls(documentRef: Document): string[] {
  const root =
    findReturnDashboardFilterRoot(documentRef) ?? findNativeReturnDashboardRoot(documentRef);
  const probeRoot = root ?? documentRef.body ?? documentRef;
  const nativeDashboardSelects = findNativeDashboardSelects(probeRoot);
  const orderedFallbackSelects = findOrderedDashboardSelects(probeRoot);
  const year =
    nativeDashboardSelects.year ??
    (root ? findDashboardSelect(root, FINANCIAL_YEAR_LABEL, "financial-year") : null) ??
    orderedFallbackSelects.year;
  const quarter =
    nativeDashboardSelects.quarter ??
    (root ? findDashboardSelect(root, QUARTER_LABEL, "quarter") : null) ??
    orderedFallbackSelects.quarter;
  const period =
    nativeDashboardSelects.period ??
    (root ? findDashboardSelect(root, PERIOD_LABEL, "period") : null) ??
    orderedFallbackSelects.period;
  const search = findSearchButton(probeRoot);

  return [
    "gstr2b-return-dashboard-route",
    root ? "gstr2b-dashboard-root-found" : "gstr2b-dashboard-root-missing",
    year ? "gstr2b-dashboard-year-select-found" : "gstr2b-dashboard-year-select-missing",
    quarter ? "gstr2b-dashboard-quarter-select-found" : "gstr2b-dashboard-quarter-select-missing",
    period ? "gstr2b-dashboard-period-select-found" : "gstr2b-dashboard-period-select-missing",
    search ? "gstr2b-dashboard-search-found" : "gstr2b-dashboard-search-missing",
    ...selectedDashboardFilterSignals({ year, quarter, period }),
  ];
}

function selectedDashboardFilterSignals(controls: {
  year: HTMLSelectElement | null;
  quarter: HTMLSelectElement | null;
  period: HTMLSelectElement | null;
}): string[] {
  return [
    selectedDashboardFilterSignal("year", controls.year),
    selectedDashboardFilterSignal("quarter", controls.quarter),
    selectedDashboardFilterSignal("period", controls.period),
  ].filter((signal): signal is string => Boolean(signal));
}

function selectedDashboardFilterSignal(
  role: "year" | "quarter" | "period",
  select: HTMLSelectElement | null,
): string | null {
  if (!select) return null;
  const label = sanitizeDiagnosticSignalValue(
    select.selectedOptions[0]?.textContent || select.value,
  );
  return label ? `gstr2b-dashboard-selected-${role}:${label}` : null;
}

function sanitizeDiagnosticSignalValue(value: string): string {
  return normaliseText(value)
    .replace(/[^a-z0-9 -]/gi, "")
    .slice(0, 40);
}

function expectedCalendarYears(scope: FiledReturnsDownloadScope): string[] {
  const match = /^(20\d{2})-\d{2}$/.exec(scope.financialYear);
  if (!match?.[1]) return [];
  const startYear = Number(match[1]);
  return scope.period === "January" || scope.period === "February" || scope.period === "March"
    ? [String(startYear + 1)]
    : [String(startYear)];
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

function isGstr2bSummaryPage(documentRef: Document, normalisedText: string): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return (
    GSTR2B_SUMMARY_ROUTE.test(pathname) ||
    (normalisedText.includes("gstr-2b") &&
      normalisedText.includes("download gstr-2b summary") &&
      normalisedText.includes("download gstr-2b details"))
  );
}

function isGstr2bAuthRoute(documentRef: Document): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return GSTR2B_AUTH_ROUTE.test(pathname);
}

function dashboardFiltersMatch(
  scope: FiledReturnsDownloadScope,
  yearSelect: HTMLSelectElement,
  quarterSelect: HTMLSelectElement,
  periodSelect: HTMLSelectElement,
): boolean {
  return (
    selectMatches(yearSelect, [scope.financialYear]) &&
    selectMatches(quarterSelect, acceptedQuarterOptions(scope.period)) &&
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

function findReturnDashboardFilterRoot(documentRef: Document): HTMLElement | null {
  const nativeDashboardForm = documentRef.querySelector("form[name='dashboard']");
  if (nativeDashboardForm && isHtmlElement(documentRef, nativeDashboardForm)) {
    return nativeDashboardForm;
  }

  const roots: Array<{ element: HTMLElement; score: number }> = [];
  for (const searchButton of findSearchButtons(documentRef)) {
    let current: HTMLElement | null = searchButton;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const text = normaliseText(current.innerText || current.textContent || "");
      if (/financial\s+year/.test(text) && /\bquarter\b/.test(text) && /\bperiod\b/.test(text)) {
        roots.push({ element: current, score: text.length });
        break;
      }
      current = current.parentElement;
    }
  }

  const nearestRoot = roots.sort((left, right) => left.score - right.score)[0]?.element ?? null;
  if (nearestRoot) return nearestRoot;

  const bodyText = normaliseText(
    documentRef.body?.innerText || documentRef.body?.textContent || "",
  );
  if (
    findSearchButtons(documentRef).length > 0 &&
    /financial\s+year/.test(bodyText) &&
    /\bquarter\b/.test(bodyText) &&
    /\bperiod\b/.test(bodyText)
  ) {
    return documentRef.body;
  }

  return null;
}

function findGstr2bSummaryDashboardBackControl(documentRef: Document): HTMLElement | null {
  return (
    getClickableElements(documentRef).find((element) => {
      const text = normaliseText(readElementText(element));
      return /^back\s+to\s+dashboard$/.test(text) || /^back$/.test(text);
    }) ?? null
  );
}

function findNativeReturnDashboardRoot(documentRef: Document): HTMLElement | null {
  const body = documentRef.body;
  if (!body) return null;
  const controls = findOrderedDashboardSelects(body);
  if (!controls.year || !controls.quarter || !controls.period) return null;
  if (!findSearchButton(body)) return null;
  return body;
}

function findDashboardSelect(
  root: HTMLElement,
  labelPattern: RegExp,
  role: "financial-year" | "quarter" | "period",
): HTMLSelectElement | null {
  return (
    findKnownGstSelect(root, labelPattern) ??
    findLabelledSelects(root, labelPattern)[0] ??
    findSelectByIdentity(root, role) ??
    findSelectByOptionText(root, acceptedRoleOptions(role)) ??
    null
  );
}

function findNativeDashboardSelects(root: ParentNode): {
  year: HTMLSelectElement | null;
  quarter: HTMLSelectElement | null;
  period: HTMLSelectElement | null;
} {
  return {
    year: findSelectBySelectors(root, [
      'select[name="fin"]',
      'select[data-ng-model="dropdownValues.finyr"]',
    ]),
    quarter: findSelectBySelectors(root, [
      'select[name="quarter"]',
      'select[ng-model="dropdownValues.quart"]',
      'select[data-ng-model="dropdownValues.quart"]',
      'select[ng-model="quart"]',
      'select[data-ng-model="quart"]',
    ]),
    period: findSelectBySelectors(root, [
      'select[name="mon"]',
      'select[data-ng-model="dropdownValues.reqmonth"]',
    ]),
  };
}

function findSelectBySelectors(
  root: ParentNode,
  selectors: readonly string[],
): HTMLSelectElement | null {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element && isSelectElement(element)) return element;
  }
  return null;
}

function findOrderedDashboardSelects(root: ParentNode): {
  year: HTMLSelectElement | null;
  quarter: HTMLSelectElement | null;
  period: HTMLSelectElement | null;
} {
  const selects = Array.from(root.querySelectorAll("select")).filter(isSelectElement);
  if (selects.length < 3) return { year: null, quarter: null, period: null };

  return {
    year: selects[0] ?? null,
    quarter: selects[1] ?? null,
    period: selects[2] ?? null,
  };
}

function findSelectByIdentity(
  root: ParentNode,
  role: "financial-year" | "quarter" | "period",
): HTMLSelectElement | null {
  return (
    Array.from(root.querySelectorAll("select")).find((select) => {
      if (!isSelectElement(select)) return false;
      const identity = normaliseText(
        [
          select.id,
          select.name,
          select.title,
          select.getAttribute("aria-label") ?? "",
          select.getAttribute("data-ng-model") ?? "",
          select.getAttribute("ng-model") ?? "",
        ].join(" "),
      );
      if (role === "financial-year") return /finyr|financial\s*year|financialyear/.test(identity);
      if (role === "quarter") return /\bquarter\b|\bquart\b|qtr/.test(identity);
      return /\bperiod\b|tax\s*period|\bmonth\b|mth/.test(identity);
    }) ?? null
  );
}

function findSelectByOptionText(
  root: ParentNode,
  acceptedTexts: readonly string[],
): HTMLSelectElement | null {
  return (
    Array.from(root.querySelectorAll("select")).find(
      (select) =>
        isSelectElement(select) &&
        Array.from(select.options).some((option) =>
          matchesAcceptedText(option.textContent || option.value, acceptedTexts),
        ),
    ) ?? null
  );
}

function isSelectElement(element: Element): element is HTMLSelectElement {
  return element.tagName.toLowerCase() === "select";
}

function acceptedRoleOptions(role: "financial-year" | "quarter" | "period"): string[] {
  if (role === "financial-year") return ["2026-27", "2025-26", "2024-25"];
  if (role === "quarter") return ["Quarter 1", "Quarter 2", "Q1", "Q2"];
  return [
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "January",
    "February",
    "March",
  ];
}

function findSearchButton(root: ParentNode): HTMLElement | null {
  return findSearchButtons(root)[0] ?? null;
}

function findSearchButtons(root: ParentNode): HTMLElement[] {
  const textMatches = getClickableElements(root).filter((element) =>
    /^search$/i.test(normaliseText(readElementText(element))),
  );
  const selectorMatches = Array.from(
    root.querySelectorAll(
      [
        "button",
        "input[type='button']",
        "input[type='submit']",
        "[role='button']",
        "[class*='srchbtn']",
        "[class*='search']",
        "[id*='search']",
      ].join(","),
    ),
  ).filter((element): element is HTMLElement => {
    if (!isClickableHtmlElement(element)) return false;
    const identity = normaliseText(
      [
        readElementText(element),
        element.id,
        element.className,
        element.getAttribute("name") ?? "",
        element.getAttribute("value") ?? "",
      ].join(" "),
    );
    return /\bsearch\b|srchbtn/.test(identity);
  });
  return [...new Set([...textMatches, ...selectorMatches])];
}

function isClickableHtmlElement(element: Element): element is HTMLElement {
  if (element.namespaceURI && element.namespaceURI !== "http://www.w3.org/1999/xhtml") {
    return false;
  }
  return typeof (element as Partial<HTMLElement>).click === "function";
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

function findGstr2bDashboardControl(documentRef: Document, intent: "view"): HTMLElement | null {
  const containers = Array.from(
    documentRef.querySelectorAll(
      [
        "tr",
        ".row",
        ".card",
        ".panel",
        "[class*='card']",
        "[class*='col-']",
        "[class*='tile']",
        "[data-ng-repeat]",
        "[ng-repeat]",
      ].join(","),
    ),
  ).sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0));
  for (const container of containers) {
    const text = normaliseText(container.textContent ?? "");
    if (!text.includes("gstr-2b") && !text.includes("gstr2b")) continue;
    const control = findMatchingGstr2bControl(container, intent);
    if (control) return control;
  }

  const gstr2bControls = getClickableElements(documentRef).filter((element) => {
    const text = normaliseText(readElementText(element));
    return text.includes("gstr-2b") || text.includes("gstr2b");
  });
  for (const gstr2bControl of gstr2bControls) {
    const control = findNearestGstr2bControl(gstr2bControl, intent);
    if (control) return control;
  }
  const nearbyIntentControl = findNearbyGstr2bIntentControl(documentRef, intent);
  if (nearbyIntentControl) return nearbyIntentControl;
  return null;
}

function findNearestGstr2bControl(element: HTMLElement, intent: "view"): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    if (!normaliseText(current.textContent ?? "").match(/gstr-?2b/)) continue;
    const control = findMatchingGstr2bControl(current, intent);
    if (control) return control;
  }
  return null;
}

function findMatchingGstr2bControl(container: Element, intent: "view"): HTMLElement | null {
  const candidates = getClickableElements(container).filter((element) =>
    matchesGstr2bIntentControl(element, intent),
  );
  return candidates.find(hasLocallyScopedGstr2bText) ?? null;
}

function findNearbyGstr2bIntentControl(documentRef: Document, intent: "view"): HTMLElement | null {
  return (
    getClickableElements(documentRef).find((element) => {
      if (!matchesGstr2bIntentControl(element, intent)) return false;
      return hasLocallyScopedGstr2bText(element);
    }) ?? null
  );
}

function matchesGstr2bIntentControl(element: HTMLElement, intent: "view"): boolean {
  const label = normaliseText(readElementText(element));
  if (intent === "view" && /^view$/.test(label)) return true;

  const action = normaliseText(
    [element.getAttribute("data-ng-click") ?? "", element.getAttribute("ng-click") ?? ""].join(" "),
  );
  return intent === "view" && action.includes("page_rtp") && !label.includes("download");
}

function hasLocallyScopedGstr2bText(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    const currentText = current.textContent ?? "";
    if (containsReturnTypeText(currentText)) return isSpecificGstr2bText(currentText);
    const previous = current.previousElementSibling;
    const next = current.nextElementSibling;
    if (previous && isSpecificGstr2bText(previous.textContent ?? "")) return true;
    if (next && isSpecificGstr2bText(next.textContent ?? "")) return true;
  }
  return false;
}

function containsReturnTypeText(text: string): boolean {
  return /gstr-?(?:1a?|2a|2b|3b)\b/.test(normaliseText(text));
}

function isSpecificGstr2bText(text: string): boolean {
  const normalised = normaliseText(text);
  if (!/gstr-?2b/.test(normalised)) return false;
  return !/gstr-?1a?\b|gstr-?2a\b|gstr-?3b\b/.test(normalised);
}

function isReturnDashboardRoute(documentRef: Document): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return /\/returns\/auth\/dashboard\/?$/i.test(pathname);
}

function isFiledReturnsRoute(documentRef: Document): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return FILED_RETURNS_ROUTE.test(pathname);
}

function isReturnDashboardStillRendering(documentRef: Document, documentText: string): boolean {
  if (normaliseText(documentText).length > 40) return false;
  return getClickableElements(documentRef).length === 0;
}

function hasLoginEvidence(documentRef: Document, normalisedText: string): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  if (/(?:\/services\/login|\/login)$/i.test(pathname)) return true;
  if (
    /session (?:is |has )?expired|please login again|invalid session|logged out/.test(
      normalisedText,
    )
  ) {
    return true;
  }
  return (
    /\blogin\b|\bsign in\b/.test(normalisedText) &&
    /\b(username|user id|captcha)\b/.test(normalisedText)
  );
}

function readDocumentText(documentRef: Document): string {
  return documentRef.body?.innerText || documentRef.body?.textContent || "";
}

function readElementText(element: HTMLElement): string {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  return [
    element.innerText || "",
    element.textContent || "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ].join(" ");
}
