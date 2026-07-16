import type { FiledReturnsDownloadScope } from "../../core/contracts";
import {
  findFieldRoot,
  findFiledReturnsFilterRoot,
  selectCustomOptionNearLabel,
} from "./filed-returns-custom-dropdown";
import {
  filedReturnsFilterFieldMatches,
  findKnownGstSelect,
  findLabelledSelects,
  hasFiledReturnsFilterFieldControl,
} from "./filed-returns-filter-fields";
import { acceptedFiledReturnsMonthTexts } from "./filed-returns-months";
import { delay, dispatchChange, matchesAcceptedText, normaliseText } from "./filed-returns-dom";

const FIELD_SETTLE_DELAY_MS = 500;
const FIELD_SETTLE_POLL_MS = 50;
const FIELD_SELECTION_ATTEMPTS = 24;
const UNSELECTED_FILING_PERIOD_OPTIONS = ["Select", "Please Select"];

export const FINANCIAL_YEAR_LABEL = /financial\s+year/i;
export const FILING_PERIOD_LABEL = /^return\s+filing\s+period\b|^period\b/i;
export const MONTH_LABEL = /^month\b|^tax\s+period\b/i;
export const RETURN_TYPE_LABEL = /^return\s+type\b/i;
const LEAVE_FILING_PERIOD_UNSELECTED_PATTERN =
  /please\s+do\s+not\s+select\s+any\s+value\s+in\s+['"]?return\s+filing\s+period/i;
const RETURN_TYPE_INSTRUCTION_PATTERNS: Record<FiledReturnsDownloadScope["returnType"], RegExp> = {
  "GSTR-1": /\bgstr\s*[- ]?\s*1\b/i,
  "GSTR-3B": /\bgstr\s*[- ]?\s*3b\b/i,
  "GSTR-2B": /\bgstr\s*[- ]?\s*2b\b/i,
};

type FieldSelectionAttempt = "selected" | "pending" | "missing";

export interface FilterSelectionState {
  financialYearSelected: boolean;
  periodSelected: boolean;
  monthFieldPresent: boolean;
  monthSelected: boolean;
  returnTypeSelected: boolean;
}

export function acceptedFilingPeriodOptions(scope: FiledReturnsDownloadScope): string[] {
  return ["Monthly", scope.period];
}

export function acceptedMonthOptions(scope: FiledReturnsDownloadScope): string[] {
  return acceptedFiledReturnsMonthTexts(scope.period);
}

export function acceptedReturnTypeOptions(scope: FiledReturnsDownloadScope): string[] {
  return scope.returnType === "GSTR-1" ? ["GSTR-1", "GSTR-1/IFF/GSTR-1A"] : [scope.returnType];
}

export function acceptedUnselectedFilingPeriodOptions(): readonly string[] {
  return UNSELECTED_FILING_PERIOD_OPTIONS;
}

export function shouldLeaveFilingPeriodUnselected(
  documentRef: Document,
  returnType: FiledReturnsDownloadScope["returnType"],
): boolean {
  const returnTypePattern = RETURN_TYPE_INSTRUCTION_PATTERNS[returnType];
  return Array.from(
    documentRef.querySelectorAll<HTMLElement>("p, li, [role='note'], [role='alert']"),
  ).some((element) => {
    const instructionText = element.innerText || element.textContent || "";
    return (
      LEAVE_FILING_PERIOD_UNSELECTED_PATTERN.test(instructionText) &&
      returnTypePattern.test(instructionText)
    );
  });
}

export function hasFieldControl(documentRef: Document, labelPattern: RegExp): boolean {
  return hasFiledReturnsFilterFieldControl(documentRef, labelPattern);
}

export function readFilterSelectionState(
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
    returnTypeSelected: filedReturnsFilterFieldMatches(
      documentRef,
      RETURN_TYPE_LABEL,
      acceptedReturnTypeOptions(scope),
      matchesExactReturnTypeText,
    ),
  };
}

export function isFilterSelectionComplete(state: FilterSelectionState): boolean {
  return (
    state.financialYearSelected &&
    state.periodSelected &&
    state.monthSelected &&
    state.returnTypeSelected
  );
}

export async function waitForFieldSelection(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): Promise<void> {
  const attempts = Math.ceil(FIELD_SETTLE_DELAY_MS / FIELD_SETTLE_POLL_MS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (
      filedReturnsFilterFieldMatches(
        documentRef,
        labelPattern,
        acceptedTexts,
        matcherForField(labelPattern),
      )
    ) {
      // GST replaces dependent select options asynchronously after a change event.
      // Keep the established settle window before probing the next field.
      await delay(FIELD_SETTLE_DELAY_MS);
      return;
    }
    await delay(FIELD_SETTLE_POLL_MS);
  }
}

export function summariseNativeSelectOptions(documentRef: Document, labelPattern: RegExp): string {
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

export async function selectFieldOption(
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
  const matchesText = matcherForField(labelPattern);
  if (formRoot) {
    const scopedKnownSelect = findKnownGstSelect(formRoot, labelPattern);
    if (scopedKnownSelect) {
      if (selectOption(scopedKnownSelect, acceptedTexts, matchesText)) return "selected";
      hasPendingNativeControl = true;
    }

    const fieldRoot = findFieldRoot(formRoot, labelPattern);
    const select = fieldRoot?.querySelector("select");
    if (select && select !== scopedKnownSelect) {
      if (selectOption(select, acceptedTexts, matchesText)) return "selected";
      hasPendingNativeControl = true;
    }
  }

  const knownDocumentSelect = findKnownGstSelect(documentRef, labelPattern);
  if (knownDocumentSelect) {
    if (selectOption(knownDocumentSelect, acceptedTexts, matchesText)) return "selected";
    hasPendingNativeControl = true;
  }

  for (const labelledSelect of findLabelledSelects(documentRef, labelPattern)) {
    if (selectOption(labelledSelect, acceptedTexts, matchesText)) return "selected";
    hasPendingNativeControl = true;
  }

  if (hasPendingNativeControl) return "pending";

  return (await selectCustomOptionNearLabel(documentRef, labelPattern, acceptedTexts, matchesText))
    ? "selected"
    : "missing";
}

function selectOption(
  select: HTMLSelectElement,
  acceptedTexts: readonly string[],
  matchesText: (text: string, acceptedTexts: readonly string[]) => boolean,
): boolean {
  const selectedText = normaliseText(select.selectedOptions[0]?.textContent || select.value);
  if (matchesText(selectedText, acceptedTexts)) return true;

  const option = Array.from(select.options).find((candidate) => {
    const text = normaliseText(candidate.textContent || candidate.value);
    return matchesText(text, acceptedTexts);
  });
  if (!option) return false;

  select.focus?.({ preventScroll: true });
  const SelectConstructor = select.ownerDocument.defaultView?.HTMLSelectElement;
  const nativeValueSetter = SelectConstructor
    ? Object.getOwnPropertyDescriptor(SelectConstructor.prototype, "value")?.set
    : undefined;
  if (nativeValueSetter) {
    nativeValueSetter.call(select, option.value);
  } else {
    select.value = option.value;
  }
  select.selectedIndex = option.index;
  dispatchChange(select);
  select.blur?.();
  return true;
}

function matcherForField(
  labelPattern: RegExp,
): (text: string, acceptedTexts: readonly string[]) => boolean {
  return labelPattern === RETURN_TYPE_LABEL ? matchesExactReturnTypeText : matchesAcceptedText;
}

function matchesExactReturnTypeText(text: string, acceptedTexts: readonly string[]): boolean {
  const comparableText = comparableReturnTypeText(text);
  return acceptedTexts.some((acceptedText) => {
    const comparableAccepted = comparableReturnTypeText(acceptedText);
    return (
      comparableText === comparableAccepted || comparableText === `returntype${comparableAccepted}`
    );
  });
}

function comparableReturnTypeText(value: string): string {
  return normaliseText(value).replace(/[^a-z0-9]/g, "");
}
