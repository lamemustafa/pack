import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import { findFiledReturnsFilterRoot } from "./filed-returns-custom-dropdown";
import {
  acceptedFilingPeriodOptions,
  acceptedMonthOptions,
  type FilterSelectionState,
  FINANCIAL_YEAR_LABEL,
  FILING_PERIOD_LABEL,
  hasFieldControl,
  isFilterSelectionComplete,
  MONTH_LABEL,
  readFilterSelectionState,
  RETURN_TYPE_LABEL,
  selectFieldOption,
  summariseNativeSelectOptions,
  waitForFieldSelection,
} from "./filed-returns-filter-selection";
import { activateElement, delay, getClickableElements, normaliseText } from "./filed-returns-dom";
import { markFiledReturnsSearchPending } from "./filed-returns-search-state";
import { filedReturnDescriptor } from "./filed-returns-return-descriptors";

const FIELD_SETTLE_DELAY_MS = 500;
const FIELD_STABILITY_DELAY_MS = 1_000;
const FIELD_CONVERGENCE_ATTEMPTS = 4;

export async function selectFiledReturnsFiltersAndSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): Promise<PortalFlowStepResult> {
  const descriptor = filedReturnDescriptor(scope.returnType);
  const selectSignals: string[] = [];
  let financialYearSelected = await selectFieldOption(documentRef, FINANCIAL_YEAR_LABEL, [
    scope.financialYear,
  ]);
  if (financialYearSelected) {
    await waitForFieldSelection(documentRef, FINANCIAL_YEAR_LABEL, [scope.financialYear]);
  }

  let periodSelected = await selectFieldOption(
    documentRef,
    FILING_PERIOD_LABEL,
    acceptedFilingPeriodOptions(scope),
  );
  if (periodSelected) {
    await waitForFieldSelection(
      documentRef,
      FILING_PERIOD_LABEL,
      acceptedFilingPeriodOptions(scope),
    );
  }

  let monthFieldPresent = hasFieldControl(documentRef, MONTH_LABEL);
  let monthSelected = !monthFieldPresent;
  if (periodSelected && monthFieldPresent) {
    monthSelected = await selectFieldOption(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
    monthFieldPresent = monthFieldPresent || hasFieldControl(documentRef, MONTH_LABEL);
  }
  if (monthFieldPresent && monthSelected) {
    await waitForFieldSelection(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
  }

  let returnTypeSelected = await selectFieldOption(documentRef, RETURN_TYPE_LABEL, [
    scope.returnType,
  ]);
  if (periodSelected && returnTypeSelected && monthFieldPresent && !monthSelected) {
    await delay(FIELD_SETTLE_DELAY_MS);
    monthSelected = await selectFieldOption(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
    monthFieldPresent = monthFieldPresent || hasFieldControl(documentRef, MONTH_LABEL);
    if (monthSelected) {
      await waitForFieldSelection(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
    }
  }

  const settledSelection = await settleFiledReturnsFilterSelection(documentRef, scope);
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
  const search = findSearchButton(searchRoot) ?? findSearchButton(documentRef);

  if (
    !financialYearSelected ||
    !periodSelected ||
    !monthSelected ||
    !returnTypeSelected ||
    !search
  ) {
    if (
      financialYearSelected ||
      periodSelected ||
      (monthFieldPresent && monthSelected) ||
      returnTypeSelected
    ) {
      const missingContext = describeMissingFilterContext(documentRef, {
        financialYearSelected,
        periodSelected,
        monthFieldPresent,
        monthSelected,
        returnTypeSelected,
      });
      return {
        connectorId: "gst",
        scopeId,
        state: "clicked",
        safeSignals: ["filed-return-filter-selection-in-progress", ...selectSignals],
        safeMessage: `Pack selected part of the filed-return filter form and is waiting for the GST portal to finish updating it.${missingContext}`,
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
  activateElement(search);
  return {
    connectorId: "gst",
    scopeId,
    state: "clicked",
    safeSignals: ["filed-return-filters-selected", ...selectSignals, "search-clicked"],
    safeMessage: "Pack selected the filed-return filters and clicked Search.",
  };
}

async function settleFiledReturnsFilterSelection(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Promise<FilterSelectionState> {
  let state = readFilterSelectionState(documentRef, scope);
  for (let attempt = 0; attempt < FIELD_CONVERGENCE_ATTEMPTS; attempt += 1) {
    if (isFilterSelectionComplete(state)) {
      await delay(FIELD_STABILITY_DELAY_MS);
      const stableState = readFilterSelectionState(documentRef, scope);
      if (isFilterSelectionComplete(stableState)) return stableState;
      state = stableState;
    }

    if (!state.financialYearSelected) {
      await selectFieldOption(documentRef, FINANCIAL_YEAR_LABEL, [scope.financialYear]);
      await waitForFieldSelection(documentRef, FINANCIAL_YEAR_LABEL, [scope.financialYear]);
    }

    state = readFilterSelectionState(documentRef, scope);
    if (state.financialYearSelected && !state.periodSelected) {
      await selectFieldOption(documentRef, FILING_PERIOD_LABEL, acceptedFilingPeriodOptions(scope));
      await waitForFieldSelection(
        documentRef,
        FILING_PERIOD_LABEL,
        acceptedFilingPeriodOptions(scope),
      );
    }

    state = readFilterSelectionState(documentRef, scope);
    if (state.periodSelected && !state.returnTypeSelected) {
      await selectFieldOption(documentRef, RETURN_TYPE_LABEL, [scope.returnType]);
      await waitForFieldSelection(documentRef, RETURN_TYPE_LABEL, [scope.returnType]);
    }

    state = readFilterSelectionState(documentRef, scope);
    if (
      state.periodSelected &&
      state.returnTypeSelected &&
      state.monthFieldPresent &&
      !state.monthSelected
    ) {
      await selectFieldOption(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
      await waitForFieldSelection(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
    }

    state = readFilterSelectionState(documentRef, scope);
  }

  return state;
}

function describeMissingFilterContext(documentRef: Document, state: FilterSelectionState): string {
  const missing: string[] = [];
  if (!state.financialYearSelected) missing.push("financial year");
  if (!state.periodSelected) missing.push("filing period");
  if (state.monthFieldPresent && !state.monthSelected) {
    missing.push(`month (${summariseNativeSelectOptions(documentRef, MONTH_LABEL)})`);
  }
  if (!state.returnTypeSelected) missing.push("return type");
  if (
    state.financialYearSelected &&
    state.periodSelected &&
    state.monthSelected &&
    state.returnTypeSelected &&
    !findSearchButton(documentRef)
  ) {
    missing.push("search button");
  }

  return missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
}

function findSearchButton(root: ParentNode): HTMLElement | null {
  return (
    getClickableElements(root).find((element) =>
      /^search$/i.test(normaliseText(readElementText(element))),
    ) ?? null
  );
}

function readElementText(element: HTMLElement): string {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  const seenTexts = new Set<string>();
  return [
    element.innerText || "",
    element.textContent || "",
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
