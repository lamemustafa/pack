import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "./filed-returns-contracts";
import { delay } from "../../core/time";
import {
  activateElement,
  dispatchChange,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import {
  FILED_RETURNS_QUARTER_MONTHS,
  acceptedFiledReturnsMonthTexts,
  canonicalFiledReturnsMonth,
} from "./filed-returns-months";
import { findReturnDashboardControl } from "./gstr2b-dashboard-view";
import { navigateToReturnDashboardPage } from "./filed-returns-navigator";
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
const DASHBOARD_SEARCH_COUNT_ATTRIBUTE = "data-pack-dashboard-search-count";
const DASHBOARD_REOPENED_SCOPE_ATTRIBUTE = "data-pack-dashboard-reopened-scope";
const DASHBOARD_SEARCHES_BEFORE_REOPEN = 2;
const DASHBOARD_NOT_OFFERED_SCOPE_ATTRIBUTE = "data-pack-dashboard-period-not-offered";
// The second look must come late enough that one list rebuild cannot span both, and soon enough
// that it cannot join a first look from an earlier, unrelated attempt on the same tab.
const DASHBOARD_NOT_OFFERED_MIN_GAP_MS = 2_000;
const DASHBOARD_NOT_OFFERED_MAX_GAP_MS = DASHBOARD_SEARCH_PENDING_MS;
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
  return selectReturnDashboardFiltersAndSearch(documentRef, scope, scopeId, safeSignals);
}

export async function selectReturnDashboardFiltersAndSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  safeSignals: readonly string[],
): Promise<PortalFlowStepResult | null> {
  const signalPrefix = dashboardSignalPrefix(scope);
  const diagnosticSignals = diagnoseReturnDashboardControls(
    documentRef,
    signalPrefix,
    scope.returnType !== "GSTR-1",
  );
  let controls = findReturnDashboardControls(documentRef);
  if (!controls) {
    const viewControl = findReturnDashboardControl(documentRef, scope.returnType, "view");
    if (viewControl && hasSettledDashboardSearchForScope(documentRef, scope, viewControl)) {
      return null;
    }
    if (viewControl && hasExpiredUnchangedDashboardSearch(documentRef, scope, viewControl)) {
      return unchangedDashboardViewRecovery(scope, scopeId, safeSignals, diagnosticSignals);
    }

    const searchPending = hasRecentDashboardSearch(documentRef, scope);

    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: uniqueSignals(
        safeSignals,
        diagnosticSignals,
        searchPending
          ? [`${signalPrefix}-return-dashboard-search-results-pending`]
          : viewControl
            ? [`${signalPrefix}-dashboard-view-unscoped`]
            : [],
      ),
      safeMessage:
        "Pack recognized the GST Return Dashboard and is waiting for target-bound dashboard controls to render. Diagnostic signals: " +
        diagnosticSignals.join(", "),
    };
  }

  const viewControl = findReturnDashboardControl(documentRef, scope.returnType, "view");
  if (
    viewControl &&
    hasSettledDashboardSearchForScope(documentRef, scope, viewControl) &&
    dashboardFiltersMatch(scope, controls.year, controls.quarter, controls.period)
  ) {
    return null;
  }

  if (!selectMatches(controls.year, [scope.financialYear])) {
    const yearSelected = selectOption(controls.year, [scope.financialYear]);
    if (yearSelected) {
      clearGstr2bDashboardSearchPending(documentRef);
      await delay(DASHBOARD_FIELD_SETTLE_DELAY_MS);
      controls = findReturnDashboardControls(documentRef) ?? controls;
      return dashboardSelectionInProgress(scope, scopeId, safeSignals, diagnosticSignals, [
        "financial-year-selected",
        ...dashboardFilterDiagnosticSignals(controls, signalPrefix),
      ]);
    }
  }

  const notOffered = dashboardPeriodNotOffered(
    documentRef,
    scope,
    scopeId,
    controls,
    uniqueSignals(safeSignals, diagnosticSignals),
  );
  if (notOffered) return notOffered;

  if (controls.quarter && !selectMatches(controls.quarter, acceptedQuarterOptions(scope.period))) {
    const quarterSelected = selectOption(controls.quarter, acceptedQuarterOptions(scope.period));
    if (quarterSelected) {
      clearGstr2bDashboardSearchPending(documentRef);
      controls = await waitForReturnDashboardPeriodOptions(documentRef, scope, controls);
      return dashboardSelectionInProgress(scope, scopeId, safeSignals, diagnosticSignals, [
        "quarter-selected",
        ...dashboardFilterDiagnosticSignals(controls, signalPrefix),
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
      return dashboardSelectionInProgress(scope, scopeId, safeSignals, diagnosticSignals, [
        "period-selected",
        ...dashboardFilterDiagnosticSignals(controls, signalPrefix),
      ]);
    }
  }

  if (!dashboardFiltersMatch(scope, controls.year, controls.quarter, controls.period)) {
    return dashboardSelectionInProgress(scope, scopeId, safeSignals, diagnosticSignals, [
      ...dashboardFilterDiagnosticSignals(controls, signalPrefix),
    ]);
  }

  if (viewControl && hasExpiredUnchangedDashboardSearch(documentRef, scope, viewControl)) {
    return unchangedDashboardViewRecovery(scope, scopeId, safeSignals, diagnosticSignals);
  }

  if (hasRecentDashboardSearch(documentRef, scope)) {
    return {
      connectorId: "gst",
      scopeId,
      state: "clicked",
      safeSignals: uniqueSignals(
        safeSignals,
        diagnosticSignals,
        [`${signalPrefix}-return-dashboard-filters-selected`],
        dashboardFilterDiagnosticSignals(controls, signalPrefix),
        [`${signalPrefix}-return-dashboard-search-results-pending`],
      ),
      safeMessage: `Pack already searched the ${scope.returnType} return dashboard for this period and is waiting for the GST Portal results to finish rendering.`,
    };
  }

  // A search that expires without a usable View is searched once more on the same page. Live, a
  // page the previous period had used then kept failing for the new one -- GSTR-2B June looped
  // for 11 attempts -- while a freshly opened dashboard found June's View at once. So the next
  // unsettled search reopens the dashboard through the portal's own menu, and one that still does
  // not settle after that stops with a named reason instead of looping.
  const searchesOnThisPage = dashboardSearchCount(documentRef, scope);
  const reopened = dashboardReopenedForScope(documentRef, scope);
  if (searchesOnThisPage >= (reopened ? 1 : DASHBOARD_SEARCHES_BEFORE_REOPEN)) {
    if (reopened) {
      return {
        connectorId: "gst",
        scopeId,
        state: "user-action-required",
        safeSignals: uniqueSignals(safeSignals, diagnosticSignals, [
          `${signalPrefix}-return-dashboard-search-unsettled-after-reopen`,
        ]),
        safeMessage: `The GST Portal did not show a usable ${scope.returnType} result for ${scope.period} even after Pack reopened the Returns Dashboard.`,
        userAction: {
          type: "NAVIGATE_TO_SUPPORTED_PAGE",
          message: `Open the Returns Dashboard, search ${scope.financialYear} ${scope.period} yourself, then retry.`,
          canResume: true,
        },
      };
    }
    clearGstr2bDashboardSearchPending(documentRef);
    documentRef.documentElement.setAttribute(
      DASHBOARD_REOPENED_SCOPE_ATTRIBUTE,
      dashboardSearchScope(scope),
    );
    const navigation = await navigateToReturnDashboardPage(documentRef, scopeId);
    return {
      ...navigation,
      scopeId,
      safeSignals: uniqueSignals(safeSignals, diagnosticSignals, navigation.safeSignals, [
        `${signalPrefix}-return-dashboard-reopened-after-unsettled-search`,
      ]),
      safeMessage: `The ${scope.returnType} dashboard search for ${scope.period} did not settle, so Pack reopened the Returns Dashboard to search it fresh.`,
    };
  }

  markDashboardSearchPending(documentRef, scope, viewControl);
  documentRef.documentElement.setAttribute(
    DASHBOARD_SEARCH_COUNT_ATTRIBUTE,
    `${dashboardSearchScope(scope)}|${searchesOnThisPage + 1}`,
  );
  activateElement(controls.search);
  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: uniqueSignals(
      safeSignals,
      diagnosticSignals,
      [`${signalPrefix}-return-dashboard-filters-selected`],
      dashboardFilterDiagnosticSignals(controls, signalPrefix),
      ["search-clicked"],
    ),
    safeMessage: `Pack selected the ${scope.returnType} return dashboard filters and clicked Search.`,
  };
}

function unchangedDashboardViewRecovery(
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  safeSignals: readonly string[],
  diagnosticSignals: readonly string[],
): PortalFlowStepResult {
  const signalPrefix = dashboardSignalPrefix(scope);
  return {
    connectorId: "gst",
    scopeId,
    state: "user-action-required",
    safeSignals: uniqueSignals(safeSignals, diagnosticSignals, [
      `${signalPrefix}-dashboard-view-unchanged-after-search`,
    ]),
    safeMessage: `The GST Portal did not refresh the visible ${scope.returnType} View result after Search, so Pack could not prove that it belongs to the selected period.`,
    userAction: {
      type: "NAVIGATE_TO_SUPPORTED_PAGE",
      message: `Open the selected ${scope.returnType} View manually, then start Pack again from that return page.`,
      canResume: true,
    },
  };
}

export function clearGstr2bDashboardSearchPending(documentRef: Document): void {
  documentRef.documentElement.removeAttribute(DASHBOARD_SEARCH_PENDING_ATTRIBUTE);
  documentRef.documentElement.removeAttribute(DASHBOARD_SEARCH_SCOPE_ATTRIBUTE);
  documentRef.documentElement.removeAttribute(DASHBOARD_SEARCH_COUNT_ATTRIBUTE);
  dashboardSearchAttempts.get(documentRef)?.observer?.disconnect();
  dashboardSearchAttempts.delete(documentRef);
}

export function isReturnDashboardRoute(documentRef: Document): boolean {
  const pathname = documentRef.defaultView?.location.pathname ?? "";
  return /\/returns\/auth\/dashboard\/?$/i.test(pathname);
}

/**
 * The Returns Dashboard lists only the periods a taxpayer can file for. Live on 2026-09-21, a
 * taxpayer whose returns start in July 2025 was offered Quarters 2-4 for 2025-26 and no Quarter 1,
 * so April had no option to select and the run waited out its step limit. A period missing from a
 * loaded list is the portal's own answer that nothing exists for it. The list must be loaded and
 * current: the year already selected, the quarter list recognisable, the month list belonging to
 * the selected quarter -- and the absence seen on two consecutive steps, so a list still being
 * rebuilt is never read as an answer.
 */
function dashboardPeriodNotOffered(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  controls: ReturnDashboardControls,
  safeSignals: readonly string[],
): PortalFlowStepResult | null {
  const root = documentRef.documentElement;
  const scopeKey = dashboardSearchScope(scope);
  const firstLookAt = notOfferedFirstLookAt(root, scopeKey);
  if (
    !selectMatches(controls.year, [scope.financialYear]) ||
    !periodMissingFromLoadedLists(scope, controls)
  ) {
    if (firstLookAt !== null) root.removeAttribute(DASHBOARD_NOT_OFFERED_SCOPE_ATTRIBUTE);
    return null;
  }

  const signalPrefix = dashboardSignalPrefix(scope);
  const sinceFirstLook = firstLookAt === null ? null : Date.now() - firstLookAt;
  const firstLookExpired =
    sinceFirstLook === null || sinceFirstLook > DASHBOARD_NOT_OFFERED_MAX_GAP_MS;
  if (firstLookExpired) {
    root.setAttribute(DASHBOARD_NOT_OFFERED_SCOPE_ATTRIBUTE, `${scopeKey}|${Date.now()}`);
  }
  if (firstLookExpired || sinceFirstLook < DASHBOARD_NOT_OFFERED_MIN_GAP_MS) {
    return dashboardSelectionInProgress(
      scope,
      scopeId,
      safeSignals,
      [],
      [`${signalPrefix}-return-dashboard-period-not-offered-pending`],
    );
  }

  root.removeAttribute(DASHBOARD_NOT_OFFERED_SCOPE_ATTRIBUTE);
  clearGstr2bDashboardSearchPending(documentRef);
  return {
    connectorId: "gst",
    scopeId,
    state: "candidate-not-found",
    safeSignals: uniqueSignals(safeSignals, [
      "filed-return-positively-not-filed",
      `${signalPrefix}-return-dashboard-period-not-offered`,
    ]),
    safeMessage: `The GST Portal's Returns Dashboard does not offer ${scope.period} ${scope.financialYear} for this taxpayer, so there is no ${scope.returnType} for that period.`,
  };
}

function notOfferedFirstLookAt(root: Element, scopeKey: string): number | null {
  const value = root.getAttribute(DASHBOARD_NOT_OFFERED_SCOPE_ATTRIBUTE);
  if (!value) return null;
  const separator = value.lastIndexOf("|");
  if (separator < 0 || value.slice(0, separator) !== scopeKey) return null;
  const at = Number(value.slice(separator + 1));
  return Number.isFinite(at) ? at : null;
}

function periodMissingFromLoadedLists(
  scope: FiledReturnsDownloadScope,
  controls: ReturnDashboardControls,
): boolean {
  if (controls.quarter && !selectMatches(controls.quarter, acceptedQuarterOptions(scope.period))) {
    const quarterList = Array.from(controls.quarter.options);
    const listIsLoaded = FILED_RETURNS_QUARTER_MONTHS.some((months) =>
      quarterList.some((option) =>
        matchesAcceptedText(
          option.textContent || option.value,
          acceptedQuarterOptions(months[0] ?? ""),
        ),
      ),
    );
    return (
      listIsLoaded &&
      !selectHasAcceptedOption(controls.quarter, acceptedQuarterOptions(scope.period))
    );
  }

  if (selectHasAcceptedOption(controls.period, acceptedFiledReturnsMonthTexts(scope.period))) {
    return false;
  }
  const quarterMonths = FILED_RETURNS_QUARTER_MONTHS.find((months) =>
    months.includes(canonicalFiledReturnsMonth(scope.period) ?? ""),
  );
  const listedMonths = Array.from(controls.period.options)
    .map((option) => canonicalFiledReturnsMonth(option.textContent || option.value))
    .filter((month): month is string => month !== null);
  return (
    quarterMonths !== undefined &&
    listedMonths.length > 0 &&
    listedMonths.every((month) => quarterMonths.includes(month))
  );
}

function dashboardSelectionInProgress(
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  safeSignals: readonly string[],
  diagnosticSignals: readonly string[],
  selectionSignals: readonly string[],
): PortalFlowStepResult {
  const signalPrefix = dashboardSignalPrefix(scope);
  const selectedSignalPrefix = `${signalPrefix}-dashboard-selected-`;
  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: uniqueSignals(
      safeSignals,
      diagnosticSignals.filter((signal) => !signal.startsWith(selectedSignalPrefix)),
      [`${signalPrefix}-return-dashboard-filter-selection-in-progress`],
      selectionSignals,
    ),
    safeMessage: `Pack selected part of the ${scope.returnType} return dashboard filters and is waiting for the GST portal to finish updating them.`,
  };
}

function dashboardSignalPrefix(scope: FiledReturnsDownloadScope): "gstr1" | "gstr2b" | "gstr3b" {
  if (scope.returnType === "GSTR-1") return "gstr1";
  if (scope.returnType === "GSTR-2B") return "gstr2b";
  return "gstr3b";
}

function dashboardFilterDiagnosticSignals(
  controls: ReturnDashboardControls,
  signalPrefix: "gstr1" | "gstr2b" | "gstr3b",
): string[] {
  return signalPrefix === "gstr1" ? [] : selectedDashboardFilterSignals(controls, signalPrefix);
}

function uniqueSignals(...groups: ReadonlyArray<readonly string[]>): string[] {
  return Array.from(new Set(groups.flat()));
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

/** Searches clicked for this scope on the current page; a different scope starts again at 0. */
function dashboardSearchCount(documentRef: Document, scope: FiledReturnsDownloadScope): number {
  const [countedScope, count] = (
    documentRef.documentElement.getAttribute(DASHBOARD_SEARCH_COUNT_ATTRIBUTE) ?? ""
  ).split("|");
  return countedScope === dashboardSearchScope(scope) ? Number(count) || 0 : 0;
}

function dashboardReopenedForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  return (
    documentRef.documentElement.getAttribute(DASHBOARD_REOPENED_SCOPE_ATTRIBUTE) ===
    dashboardSearchScope(scope)
  );
}

function dashboardSearchScope(scope: FiledReturnsDownloadScope): string {
  return `${normaliseText(scope.returnType)}:${normaliseText(scope.financialYear)}:${normaliseText(scope.period)}`;
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
    return ["Quarter 1", "Qtr 1", "Q1", "Apr-Jun", "Apr - Jun", "April-June", "April - June"];
  }
  if (["july", "august", "september"].includes(normalisedPeriod)) {
    return [
      "Quarter 2",
      "Qtr 2",
      "Q2",
      "Jul-Sep",
      "Jul - Sep",
      "July-September",
      "July - September",
    ];
  }
  if (["october", "november", "december"].includes(normalisedPeriod)) {
    return [
      "Quarter 3",
      "Qtr 3",
      "Q3",
      "Oct-Dec",
      "Oct - Dec",
      "October-December",
      "October - December",
    ];
  }
  return ["Quarter 4", "Qtr 4", "Q4", "Jan-Mar", "Jan - Mar", "January-March", "January - March"];
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
