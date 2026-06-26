import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  findFieldRoot,
  findFiledReturnsFilterRoot,
  selectCustomOptionNearLabel,
} from "./filed-returns-custom-dropdown";
import {
  findKnownGstSelect,
  filedReturnsFilterFieldMatches,
  findLabelledSelects,
  hasFiledReturnsFilterFieldControl,
} from "./filed-returns-filter-fields";
import { acceptedFiledReturnsMonthTexts } from "./filed-returns-months";
import {
  activateElement,
  delay,
  dispatchChange,
  getClickableElements,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { markFiledReturnsSearchPending } from "./filed-returns-search-state";

const FIELD_SETTLE_DELAY_MS = 500;
const FIELD_STABILITY_DELAY_MS = 1_000;
const FIELD_SELECTION_ATTEMPTS = 8;
const FIELD_CONVERGENCE_ATTEMPTS = 4;
const FINANCIAL_YEAR_LABEL = /financial\s+year/i;
const FILING_PERIOD_LABEL = /^return\s+filing\s+period\b|^period\b/i;
const MONTH_LABEL = /^month\b|^tax\s+period\b/i;
const RETURN_TYPE_LABEL = /^return\s+type\b/i;
type FieldSelectionAttempt = "selected" | "pending" | "missing";

interface FilterSelectionState {
  financialYearSelected: boolean;
  periodSelected: boolean;
  monthFieldPresent: boolean;
  monthSelected: boolean;
  returnTypeSelected: boolean;
}

export async function selectFiledReturnsFiltersAndSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): Promise<PortalFlowStepResult> {
  const selectSignals: string[] = [];
  let financialYearSelected = await selectFieldOption(documentRef, FINANCIAL_YEAR_LABEL, [
    scope.financialYear,
  ]);
  if (financialYearSelected) await delay(FIELD_SETTLE_DELAY_MS);

  let periodSelected = await selectFieldOption(
    documentRef,
    FILING_PERIOD_LABEL,
    acceptedFilingPeriodOptions(scope),
  );
  if (periodSelected) await delay(FIELD_SETTLE_DELAY_MS);

  let monthFieldPresent = hasFieldControl(documentRef, MONTH_LABEL);
  let monthSelected = !monthFieldPresent;
  if (periodSelected && monthFieldPresent) {
    monthSelected = await selectFieldOption(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
    monthFieldPresent = monthFieldPresent || hasFieldControl(documentRef, MONTH_LABEL);
  }
  if (monthFieldPresent && monthSelected) await delay(FIELD_SETTLE_DELAY_MS);

  let returnTypeSelected = await selectFieldOption(documentRef, RETURN_TYPE_LABEL, [
    scope.returnType,
  ]);
  if (periodSelected && returnTypeSelected && monthFieldPresent && !monthSelected) {
    await delay(FIELD_SETTLE_DELAY_MS);
    monthSelected = await selectFieldOption(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
    monthFieldPresent = monthFieldPresent || hasFieldControl(documentRef, MONTH_LABEL);
    if (monthSelected) await delay(FIELD_SETTLE_DELAY_MS);
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
  const search = getClickableElements(searchRoot).find((element) =>
    /^search$/i.test(normaliseText(readElementText(element))),
  );

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
        message: "Select the filed GSTR-3B filters in the GST portal, then start Pack again.",
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

function acceptedFilingPeriodOptions(scope: FiledReturnsDownloadScope): string[] {
  if (scope.returnType === "GSTR-3B") {
    return ["Monthly", scope.period];
  }
  return [scope.period];
}

function acceptedMonthOptions(scope: FiledReturnsDownloadScope): string[] {
  return acceptedFiledReturnsMonthTexts(scope.period);
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
      await delay(FIELD_SETTLE_DELAY_MS);
    }

    state = readFilterSelectionState(documentRef, scope);
    if (state.financialYearSelected && !state.periodSelected) {
      await selectFieldOption(documentRef, FILING_PERIOD_LABEL, acceptedFilingPeriodOptions(scope));
      await delay(FIELD_SETTLE_DELAY_MS);
    }

    state = readFilterSelectionState(documentRef, scope);
    if (state.periodSelected && !state.returnTypeSelected) {
      await selectFieldOption(documentRef, RETURN_TYPE_LABEL, [scope.returnType]);
      await delay(FIELD_SETTLE_DELAY_MS);
    }

    state = readFilterSelectionState(documentRef, scope);
    if (
      state.periodSelected &&
      state.returnTypeSelected &&
      state.monthFieldPresent &&
      !state.monthSelected
    ) {
      await selectFieldOption(documentRef, MONTH_LABEL, acceptedMonthOptions(scope));
      await delay(FIELD_SETTLE_DELAY_MS);
    }

    state = readFilterSelectionState(documentRef, scope);
  }

  return state;
}

function readFilterSelectionState(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): FilterSelectionState {
  const monthFieldPresent = hasFieldControl(documentRef, MONTH_LABEL);
  return {
    financialYearSelected: filedReturnsFilterFieldMatches(documentRef, FINANCIAL_YEAR_LABEL, [
      scope.financialYear,
    ]),
    periodSelected: filedReturnsFilterFieldMatches(
      documentRef,
      FILING_PERIOD_LABEL,
      acceptedFilingPeriodOptions(scope),
    ),
    monthFieldPresent,
    monthSelected:
      !monthFieldPresent ||
      filedReturnsFilterFieldMatches(documentRef, MONTH_LABEL, acceptedMonthOptions(scope)),
    returnTypeSelected: filedReturnsFilterFieldMatches(documentRef, RETURN_TYPE_LABEL, [
      scope.returnType,
    ]),
  };
}

function isFilterSelectionComplete(state: FilterSelectionState): boolean {
  return (
    state.financialYearSelected &&
    state.periodSelected &&
    state.monthSelected &&
    state.returnTypeSelected
  );
}

function describeMissingFilterContext(documentRef: Document, state: FilterSelectionState): string {
  const missing: string[] = [];
  if (!state.financialYearSelected) missing.push("financial year");
  if (!state.periodSelected) missing.push("filing period");
  if (state.monthFieldPresent && !state.monthSelected) {
    missing.push(`month (${summariseNativeSelectOptions(documentRef, MONTH_LABEL)})`);
  }
  if (!state.returnTypeSelected) missing.push("return type");

  return missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
}

function summariseNativeSelectOptions(documentRef: Document, labelPattern: RegExp): string {
  const select =
    findKnownGstSelect(documentRef, labelPattern) ??
    findLabelledSelects(documentRef, labelPattern)[0] ??
    null;
  if (!select) return "control present but native options were not found";

  const options = Array.from(select.options)
    .map((option) => normaliseText(option.textContent || option.value))
    .filter(Boolean);
  if (options.length === 0) return "no options available";

  const visibleOptions = options.slice(0, 6).join(", ");
  const suffix = options.length > 6 ? `, +${options.length - 6} more` : "";
  return `available options: ${visibleOptions}${suffix}`;
}

function hasFieldControl(documentRef: Document, labelPattern: RegExp): boolean {
  return hasFiledReturnsFilterFieldControl(documentRef, labelPattern);
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
  ]
    .filter(Boolean)
    .join(" ");
}

async function selectFieldOption(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): Promise<boolean> {
  for (let attempt = 0; attempt < FIELD_SELECTION_ATTEMPTS; attempt += 1) {
    const result = await selectOptionNearLabel(documentRef, labelPattern, acceptedTexts);
    if (result === "selected") return true;
    if (result === "missing") return false;
    await delay(FIELD_SETTLE_DELAY_MS);
  }

  return false;
}

async function selectOptionNearLabel(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): Promise<FieldSelectionAttempt> {
  let hasPendingNativeControl = false;
  const formRoot = findFiledReturnsFilterRoot(documentRef);
  if (formRoot) {
    const scopedKnownSelect = findKnownGstSelect(formRoot, labelPattern);
    if (scopedKnownSelect) {
      if (selectOption(scopedKnownSelect, acceptedTexts)) return "selected";
      hasPendingNativeControl = true;
    }

    const fieldRoot = findFieldRoot(formRoot, labelPattern);
    const select = fieldRoot?.querySelector("select");
    if (select && select !== scopedKnownSelect) {
      if (selectOption(select, acceptedTexts)) return "selected";
      hasPendingNativeControl = true;
    }
  }

  const knownDocumentSelect = findKnownGstSelect(documentRef, labelPattern);
  if (knownDocumentSelect) {
    if (selectOption(knownDocumentSelect, acceptedTexts)) return "selected";
    hasPendingNativeControl = true;
  }

  for (const labelledSelect of findLabelledSelects(documentRef, labelPattern)) {
    if (selectOption(labelledSelect, acceptedTexts)) return "selected";
    hasPendingNativeControl = true;
  }

  if (hasPendingNativeControl) return "pending";

  return (await selectCustomOptionNearLabel(documentRef, labelPattern, acceptedTexts))
    ? "selected"
    : "missing";
}

function selectOption(select: HTMLSelectElement, acceptedTexts: readonly string[]): boolean {
  const selectedText = normaliseText(select.selectedOptions[0]?.textContent || select.value);
  if (matchesAcceptedText(selectedText, acceptedTexts)) return true;

  const option = Array.from(select.options).find((candidate) => {
    const text = normaliseText(candidate.textContent || candidate.value);
    return matchesAcceptedText(text, acceptedTexts);
  });
  if (!option) return false;

  select.value = option.value;
  select.selectedIndex = option.index;
  dispatchChange(select);
  return true;
}
