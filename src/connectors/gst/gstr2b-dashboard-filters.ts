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

const DASHBOARD_FIELD_SETTLE_DELAY_MS = 150;
const DASHBOARD_DEPENDENT_FIELD_ATTEMPTS = 12;
const DASHBOARD_SEARCH_PENDING_MS = 12_000;
const DASHBOARD_SEARCH_PENDING_ATTRIBUTE = "data-pack-gstr2b-dashboard-search-pending-at";
const DASHBOARD_SEARCH_SCOPE_ATTRIBUTE = "data-pack-gstr2b-dashboard-search-scope";
interface DashboardSearchAttempt {
  candidateView: HTMLElement | null;
  candidateMutationVersion: number | null;
  lastMutationAt: number | null;
  mutationVersion: number;
  observer: MutationObserver | null;
  previousView: HTMLElement | null;
  scope: string;
  startedAt: number;
}
const dashboardSearchAttempts = new WeakMap<Document, DashboardSearchAttempt>();

export async function selectGstr2bReturnDashboardFiltersAndSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  safeSignals: readonly string[],
): Promise<PortalFlowStepResult | null> {
  const diagnosticSignals = diagnoseReturnDashboardControls(documentRef);
  let controls = findReturnDashboardControls(documentRef);
  if (!controls) {
    const viewControl = findGstr2bDashboardControl(documentRef, "view");
    if (viewControl && hasSettledDashboardSearchForScope(documentRef, scope, viewControl)) {
      return null;
    }
    if (viewControl && hasExpiredUnchangedDashboardSearch(documentRef, scope, viewControl)) {
      return unchangedDashboardViewRecovery(scopeId, safeSignals, diagnosticSignals);
    }

    const searchPending = hasRecentDashboardSearch(documentRef, scope);

    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [
        ...safeSignals,
        ...diagnosticSignals,
        ...(searchPending
          ? ["gstr2b-return-dashboard-search-results-pending"]
          : viewControl
            ? ["gstr2b-dashboard-view-unscoped"]
            : []),
      ],
      safeMessage:
        "Pack recognized the GST Return Dashboard and is waiting for target-bound dashboard controls to render. Diagnostic signals: " +
        diagnosticSignals.join(", "),
    };
  }

  const viewControl = findGstr2bDashboardControl(documentRef, "view");
  if (
    viewControl &&
    hasSettledDashboardSearchForScope(documentRef, scope, viewControl) &&
    (dashboardFiltersMatch(scope, controls.year, controls.quarter, controls.period) ||
      dashboardYearAndPeriodMatch(scope, controls.year, controls.period))
  ) {
    return null;
  }

  if (!selectMatches(controls.year, [scope.financialYear])) {
    const yearSelected = selectOption(controls.year, [scope.financialYear]);
    if (yearSelected) {
      clearGstr2bDashboardSearchPending(documentRef);
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
      clearGstr2bDashboardSearchPending(documentRef);
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
      clearGstr2bDashboardSearchPending(documentRef);
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

  if (viewControl && hasExpiredUnchangedDashboardSearch(documentRef, scope, viewControl)) {
    return unchangedDashboardViewRecovery(scopeId, safeSignals, diagnosticSignals);
  }

  if (hasRecentDashboardSearch(documentRef, scope)) {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: [
        ...safeSignals,
        ...diagnosticSignals,
        "gstr2b-return-dashboard-filters-selected",
        ...selectedDashboardFilterSignals(controls),
        "gstr2b-return-dashboard-search-results-pending",
      ],
      safeMessage:
        "Pack already searched the GSTR-2B return dashboard for this period and is waiting for the GST Portal results to finish rendering.",
    };
  }

  markDashboardSearchPending(documentRef, scope, viewControl);
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

function unchangedDashboardViewRecovery(
  scopeId: string,
  safeSignals: readonly string[],
  diagnosticSignals: readonly string[],
): PortalFlowStepResult {
  return {
    connectorId: "gst",
    scopeId,
    state: "user-action-required",
    safeSignals: [
      ...safeSignals,
      ...diagnosticSignals,
      "gstr2b-dashboard-view-unchanged-after-search",
    ],
    safeMessage:
      "The GST Portal did not refresh the visible GSTR-2B View result after Search, so Pack could not prove that it belongs to the selected period.",
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message:
        "Open the selected GSTR-2B View manually, then start Pack again from the GSTR-2B summary page.",
      canResume: true,
    },
  };
}

export function clearGstr2bDashboardSearchPending(documentRef: Document): void {
  documentRef.documentElement.removeAttribute(DASHBOARD_SEARCH_PENDING_ATTRIBUTE);
  documentRef.documentElement.removeAttribute(DASHBOARD_SEARCH_SCOPE_ATTRIBUTE);
  dashboardSearchAttempts.get(documentRef)?.observer?.disconnect();
  dashboardSearchAttempts.delete(documentRef);
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

function hasRecentDashboardSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  const pendingAt = Number(
    documentRef.documentElement.getAttribute(DASHBOARD_SEARCH_PENDING_ATTRIBUTE) ?? "",
  );
  const attempt = dashboardSearchAttempts.get(documentRef);
  const lastProgressAt =
    attempt?.scope === dashboardSearchScope(scope)
      ? (attempt.lastMutationAt ?? pendingAt)
      : pendingAt;
  return (
    Number.isFinite(pendingAt) &&
    hasDashboardSearchForScope(documentRef, scope) &&
    Date.now() - lastProgressAt < DASHBOARD_SEARCH_PENDING_MS
  );
}

function hasDashboardSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  return (
    documentRef.documentElement.getAttribute(DASHBOARD_SEARCH_SCOPE_ATTRIBUTE) ===
    dashboardSearchScope(scope)
  );
}

function hasSettledDashboardSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  viewControl: HTMLElement,
): boolean {
  if (!hasDashboardSearchForScope(documentRef, scope)) return false;
  const attempt = dashboardSearchAttempts.get(documentRef);
  if (!attempt || attempt.scope !== dashboardSearchScope(scope)) return false;
  if (attempt.previousView === viewControl) return false;
  if (
    attempt.candidateView !== viewControl ||
    attempt.candidateMutationVersion !== attempt.mutationVersion
  ) {
    attempt.candidateView = viewControl;
    attempt.candidateMutationVersion = attempt.mutationVersion;
    return false;
  }
  return true;
}

function hasExpiredUnchangedDashboardSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  viewControl: HTMLElement,
): boolean {
  const attempt = dashboardSearchAttempts.get(documentRef);
  return Boolean(
    attempt &&
    attempt.scope === dashboardSearchScope(scope) &&
    attempt.previousView === viewControl &&
    Date.now() - attempt.startedAt >= DASHBOARD_SEARCH_PENDING_MS,
  );
}

function markDashboardSearchPending(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  previousView: HTMLElement | null,
): void {
  const scopeSignature = dashboardSearchScope(scope);
  const startedAt = Date.now();
  dashboardSearchAttempts.get(documentRef)?.observer?.disconnect();
  const attempt: DashboardSearchAttempt = {
    candidateView: null,
    candidateMutationVersion: null,
    lastMutationAt: null,
    mutationVersion: 0,
    observer: null,
    previousView,
    scope: scopeSignature,
    startedAt,
  };
  const resultRoot = previousView ? findDashboardResultRoot(previousView) : null;
  const MutationObserverConstructor = documentRef.defaultView?.MutationObserver;
  if (resultRoot && MutationObserverConstructor) {
    attempt.observer = new MutationObserverConstructor(() => {
      attempt.mutationVersion += 1;
      attempt.lastMutationAt = Date.now();
    });
    attempt.observer.observe(resultRoot, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
  documentRef.documentElement.setAttribute(DASHBOARD_SEARCH_PENDING_ATTRIBUTE, String(startedAt));
  documentRef.documentElement.setAttribute(DASHBOARD_SEARCH_SCOPE_ATTRIBUTE, scopeSignature);
  dashboardSearchAttempts.set(documentRef, attempt);
}

function findDashboardResultRoot(viewControl: HTMLElement): HTMLElement {
  let current = viewControl.parentElement;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    if (/gstr-?2b/.test(normaliseText(current.textContent ?? ""))) return current;
  }
  return viewControl.parentElement ?? viewControl;
}

function dashboardSearchScope(scope: FiledReturnsDownloadScope): string {
  return `${normaliseText(scope.financialYear)}:${normaliseText(scope.period)}`;
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
