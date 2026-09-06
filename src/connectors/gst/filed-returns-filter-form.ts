import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "./filed-returns-contracts";
import { delay } from "../../core/time";
import {
  createFiledReturnsAcquisitionDeadline,
  hasFiledReturnsAcquisitionDeadlineExpired,
  remainingFiledReturnsAcquisitionTime,
} from "./filed-returns-acquisition-deadline";
import { findFiledReturnsFilterRoot } from "./filed-returns-custom-dropdown";
import { filedReturnsFilterFieldMatches } from "./filed-returns-filter-fields";
import {
  acceptedFilingPeriodOptions,
  acceptedMonthOptions,
  acceptedReturnTypeOptions,
  acceptedUnselectedFilingPeriodOptions,
  type FilterSelectionState,
  FINANCIAL_YEAR_LABEL,
  FILING_PERIOD_LABEL,
  hasFieldControl,
  isFilterSelectionComplete,
  MONTH_LABEL,
  readFilterSelectionState,
  RETURN_TYPE_LABEL,
  selectFieldOption,
  shouldLeaveFilingPeriodUnselected,
  waitForFieldSelection,
} from "./filed-returns-filter-selection";
import { activateElement, findUniqueActionableExactSearchControl } from "./filed-returns-dom";
import {
  clearFiledReturnsSearchAttemptForScope,
  markFiledReturnsSearchPending,
} from "./filed-returns-search-state";
import { filedReturnDescriptor } from "./filed-returns-return-descriptors";
import { filedReturnsFilterActionRequiredMessage } from "./filed-returns-filter-status";

const FIELD_SETTLE_DELAY_MS = 500;
const FIELD_STABILITY_DELAY_MS = 1_000;
const FIELD_CONVERGENCE_ATTEMPTS = 4;

export async function selectFiledReturnsFiltersAndSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
  deadline = createFiledReturnsAcquisitionDeadline(),
): Promise<PortalFlowStepResult> {
  const descriptor = filedReturnDescriptor(scope.returnType);
  const selectSignals: string[] = [];
  const leaveFilingPeriodUnselected = shouldLeaveFilingPeriodUnselected(
    documentRef,
    scope.returnType,
  );
  let financialYearSelected = await selectFieldOption(
    documentRef,
    FINANCIAL_YEAR_LABEL,
    [scope.financialYear],
    deadline,
  );
  if (financialYearSelected) {
    await waitForFieldSelection(documentRef, FINANCIAL_YEAR_LABEL, [scope.financialYear], deadline);
  }

  let periodSelected = await selectFieldOption(
    documentRef,
    FILING_PERIOD_LABEL,
    leaveFilingPeriodUnselected
      ? acceptedUnselectedFilingPeriodOptions()
      : acceptedFilingPeriodOptions(scope),
    deadline,
  );
  if (periodSelected) {
    await waitForFieldSelection(
      documentRef,
      FILING_PERIOD_LABEL,
      leaveFilingPeriodUnselected
        ? acceptedUnselectedFilingPeriodOptions()
        : acceptedFilingPeriodOptions(scope),
      deadline,
    );
    if (leaveFilingPeriodUnselected) selectSignals.push("return-filing-period-left-unselected");
  }

  let monthFieldPresent = hasFieldControl(documentRef, MONTH_LABEL);
  let monthSelected = !monthFieldPresent;
  if (periodSelected && monthFieldPresent) {
    monthSelected = await selectFieldOption(
      documentRef,
      MONTH_LABEL,
      acceptedMonthOptions(scope),
      deadline,
    );
    monthFieldPresent = monthFieldPresent || hasFieldControl(documentRef, MONTH_LABEL);
  }
  if (monthFieldPresent && monthSelected) {
    await waitForFieldSelection(documentRef, MONTH_LABEL, acceptedMonthOptions(scope), deadline);
  }

  let returnTypeSelected = await selectFieldOption(
    documentRef,
    RETURN_TYPE_LABEL,
    acceptedReturnTypeOptions(scope),
    deadline,
  );
  if (periodSelected && returnTypeSelected && monthFieldPresent && !monthSelected) {
    await delay(Math.min(FIELD_SETTLE_DELAY_MS, remainingFiledReturnsAcquisitionTime(deadline)));
    monthSelected = await selectFieldOption(
      documentRef,
      MONTH_LABEL,
      acceptedMonthOptions(scope),
      deadline,
    );
    monthFieldPresent = monthFieldPresent || hasFieldControl(documentRef, MONTH_LABEL);
    if (monthSelected) {
      await waitForFieldSelection(documentRef, MONTH_LABEL, acceptedMonthOptions(scope), deadline);
    }
  }

  const settledSelection = await settleFiledReturnsFilterSelection(
    documentRef,
    scope,
    leaveFilingPeriodUnselected,
    deadline,
  );
  financialYearSelected = settledSelection.financialYearSelected;
  periodSelected = settledSelection.periodSelected;
  monthFieldPresent = settledSelection.monthFieldPresent;
  monthSelected = settledSelection.monthSelected;
  returnTypeSelected = settledSelection.returnTypeSelected;

  if (financialYearSelected) selectSignals.push("financial-year-selected");
  if (periodSelected) selectSignals.push("period-selected");
  if (monthFieldPresent && monthSelected) selectSignals.push("month-selected");
  if (returnTypeSelected) selectSignals.push("return-type-selected");

  const formRoot = findFiledReturnsFilterRoot(documentRef);
  const searchRoot = formRoot ?? documentRef;
  const search = findUniqueActionableExactSearchControl(searchRoot);

  const selectionExpired = hasFiledReturnsAcquisitionDeadlineExpired(deadline);
  if (
    selectionExpired ||
    !financialYearSelected ||
    !periodSelected ||
    !monthSelected ||
    !returnTypeSelected ||
    !search
  ) {
    if (
      selectionExpired ||
      financialYearSelected ||
      periodSelected ||
      (monthFieldPresent && monthSelected) ||
      returnTypeSelected
    ) {
      const missingContext = describeMissingFilterContext(
        {
          financialYearSelected,
          periodSelected,
          monthFieldPresent,
          monthSelected,
          returnTypeSelected,
        },
        Boolean(search),
      );
      return {
        connectorId: "gst",
        scopeId,
        state: selectionExpired ? "user-action-required" : "clicked",
        safeSignals: ["filed-return-filter-selection-in-progress", ...selectSignals],
        safeMessage: selectionExpired
          ? filedReturnsFilterActionRequiredMessage(selectSignals)
          : `Pack selected part of the filed-return filter form and is waiting for the GST portal to finish updating it.${missingContext}`,
        ...(selectionExpired
          ? {
              userAction: {
                type: "NAVIGATE_TO_SUPPORTED_PAGE" as const,
                message: `Select the filed ${descriptor.label} filters in the GST portal, then start Pack again.`,
                canResume: true,
              },
            }
          : {}),
      };
    }

    return {
      connectorId: "gst",
      scopeId,
      state: "candidate-not-found",
      safeSignals: ["filed-return-filter-candidate-not-found", ...selectSignals],
      safeMessage:
        "Pack could not safely select the requested filed-return filters. Use the portal filters manually, then start Pack again.",
      userAction: {
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        message: `Select the filed ${descriptor.label} filters in the GST portal, then start Pack again.`,
        canResume: true,
      },
    };
  }

  markFiledReturnsSearchPending(documentRef, scope);
  // Re-read the clock rather than trusting the snapshot above.
  // `markFiledReturnsSearchPending` fingerprints the result DOM synchronously, so on a large or
  // slow page it can carry execution across the deadline the earlier check passed. Clicking then
  // fires a portal action against a step the background has already classified as timed out --
  // the late click the shared deadline exists to prevent, in a smaller window.
  if (hasFiledReturnsAcquisitionDeadlineExpired(deadline)) {
    // The marker was written a moment ago for a search that will not happen. Leaving it would
    // tell a later read that a search is in flight when none was fired.
    clearFiledReturnsSearchAttemptForScope(documentRef, scope);
    return {
      connectorId: "gst",
      scopeId,
      state: "blocked",
      safeSignals: [
        "filed-return-filters-selected",
        ...selectSignals,
        "filed-return-filter-selection-deadline-expired",
      ],
      safeMessage:
        "Pack selected the filed-return filters but ran out of time before it could search. Start Pack again.",
      userAction: {
        type: "RETRY_PORTAL_GENERATION",
        message: "Start Pack again for this period.",
        canResume: true,
      },
    };
  }
  activateElement(search);
  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: ["filed-return-filters-selected", ...selectSignals, "search-clicked"],
    safeMessage: "Pack selected the filed-return filters and clicked Search.",
  };
}

export function filedReturnsFilterSelectionMatchesScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  return isFilterSelectionComplete(
    readPortalFilterSelectionState(
      documentRef,
      scope,
      shouldLeaveFilingPeriodUnselected(documentRef, scope.returnType),
    ),
  );
}

async function settleFiledReturnsFilterSelection(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  leaveFilingPeriodUnselected: boolean,
  deadline: number,
): Promise<FilterSelectionState> {
  let state = readPortalFilterSelectionState(documentRef, scope, leaveFilingPeriodUnselected);
  for (
    let attempt = 0;
    attempt < FIELD_CONVERGENCE_ATTEMPTS && !hasFiledReturnsAcquisitionDeadlineExpired(deadline);
    attempt += 1
  ) {
    if (isFilterSelectionComplete(state)) {
      await delay(
        Math.min(FIELD_STABILITY_DELAY_MS, remainingFiledReturnsAcquisitionTime(deadline)),
      );
      const stableState = readPortalFilterSelectionState(
        documentRef,
        scope,
        leaveFilingPeriodUnselected,
      );
      if (isFilterSelectionComplete(stableState)) return stableState;
      state = stableState;
    }

    if (!state.financialYearSelected) {
      await selectFieldOption(documentRef, FINANCIAL_YEAR_LABEL, [scope.financialYear], deadline);
      await waitForFieldSelection(
        documentRef,
        FINANCIAL_YEAR_LABEL,
        [scope.financialYear],
        deadline,
      );
    }

    state = readPortalFilterSelectionState(documentRef, scope, leaveFilingPeriodUnselected);
    if (state.financialYearSelected && !state.periodSelected) {
      const acceptedPeriodOptions = leaveFilingPeriodUnselected
        ? acceptedUnselectedFilingPeriodOptions()
        : acceptedFilingPeriodOptions(scope);
      await selectFieldOption(documentRef, FILING_PERIOD_LABEL, acceptedPeriodOptions, deadline);
      await waitForFieldSelection(
        documentRef,
        FILING_PERIOD_LABEL,
        acceptedPeriodOptions,
        deadline,
      );
    }

    state = readPortalFilterSelectionState(documentRef, scope, leaveFilingPeriodUnselected);
    if (state.periodSelected && !state.returnTypeSelected) {
      await selectFieldOption(
        documentRef,
        RETURN_TYPE_LABEL,
        acceptedReturnTypeOptions(scope),
        deadline,
      );
      await waitForFieldSelection(
        documentRef,
        RETURN_TYPE_LABEL,
        acceptedReturnTypeOptions(scope),
        deadline,
      );
    }

    state = readPortalFilterSelectionState(documentRef, scope, leaveFilingPeriodUnselected);
    if (
      state.periodSelected &&
      state.returnTypeSelected &&
      state.monthFieldPresent &&
      !state.monthSelected
    ) {
      await selectFieldOption(documentRef, MONTH_LABEL, acceptedMonthOptions(scope), deadline);
      await waitForFieldSelection(documentRef, MONTH_LABEL, acceptedMonthOptions(scope), deadline);
    }

    state = readPortalFilterSelectionState(documentRef, scope, leaveFilingPeriodUnselected);
  }

  return state;
}

function readPortalFilterSelectionState(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  leaveFilingPeriodUnselected: boolean,
): FilterSelectionState {
  const state = readFilterSelectionState(documentRef, scope);
  return leaveFilingPeriodUnselected
    ? {
        ...state,
        periodSelected:
          hasFieldControl(documentRef, FILING_PERIOD_LABEL) &&
          filedReturnsFilterFieldMatches(
            documentRef,
            FILING_PERIOD_LABEL,
            acceptedUnselectedFilingPeriodOptions(),
          ),
      }
    : state;
}

function describeMissingFilterContext(
  state: FilterSelectionState,
  hasUniqueSearchControl: boolean,
): string {
  const missing: string[] = [];
  if (!state.financialYearSelected) missing.push("financial year");
  if (!state.periodSelected) missing.push("filing period");
  if (state.monthFieldPresent && !state.monthSelected) {
    missing.push("month selection still pending");
  }
  if (!state.returnTypeSelected) missing.push("return type");
  if (
    state.financialYearSelected &&
    state.periodSelected &&
    state.monthSelected &&
    state.returnTypeSelected &&
    !hasUniqueSearchControl
  ) {
    missing.push("search button");
  }

  return missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
}
