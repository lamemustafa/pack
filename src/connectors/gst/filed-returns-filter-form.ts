import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  findFieldRoot,
  findFiledReturnsFilterRoot,
  selectCustomOptionNearLabel,
} from "./filed-returns-custom-dropdown";
import {
  findKnownGstSelect,
  findLabelledSelects,
  hasFiledReturnsFilterFieldControl,
} from "./filed-returns-filter-fields";
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
const FIELD_SELECTION_ATTEMPTS = 8;
type FieldSelectionAttempt = "selected" | "pending" | "missing";

export async function selectFiledReturnsFiltersAndSearch(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): Promise<PortalFlowStepResult> {
  const selectSignals: string[] = [];
  const financialYearSelected = await selectFieldOption(documentRef, /financial\s+year/i, [
    scope.financialYear,
  ]);
  if (financialYearSelected) await delay(FIELD_SETTLE_DELAY_MS);

  const periodSelected = await selectFieldOption(
    documentRef,
    /^return\s+filing\s+period\b|^period\b/i,
    acceptedFilingPeriodOptions(scope),
  );
  if (periodSelected) await delay(FIELD_SETTLE_DELAY_MS);

  const monthFieldPresent = hasFieldControl(documentRef, /^month\b|^tax\s+period\b/i);
  const monthSelected =
    periodSelected && monthFieldPresent
      ? await selectFieldOption(
          documentRef,
          /^month\b|^tax\s+period\b/i,
          acceptedMonthOptions(scope),
        )
      : true;
  if (monthFieldPresent && monthSelected) await delay(FIELD_SETTLE_DELAY_MS);

  const returnTypeSelected = await selectFieldOption(documentRef, /^return\s+type\b/i, [
    scope.returnType,
  ]);

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
      return {
        connectorId: "gst",
        scopeId,
        state: "clicked",
        safeSignals: ["filed-return-filter-selection-in-progress", ...selectSignals],
        safeMessage:
          "Pack selected part of the filed-return filter form and is waiting for the GST portal to finish updating it.",
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
  const shortMonth = MONTH_ABBREVIATIONS[scope.period.toLowerCase()];
  return shortMonth ? [scope.period, shortMonth] : [scope.period];
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  april: "Apr",
  may: "May",
  june: "Jun",
  july: "Jul",
  august: "Aug",
  september: "Sep",
  october: "Oct",
  november: "Nov",
  december: "Dec",
  january: "Jan",
  february: "Feb",
  march: "Mar",
};

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
    const knownSelect = findKnownGstSelect(formRoot, labelPattern);
    if (knownSelect) {
      if (selectOption(knownSelect, acceptedTexts)) return "selected";
      hasPendingNativeControl = true;
    }

    const fieldRoot = findFieldRoot(formRoot, labelPattern);
    const select = fieldRoot?.querySelector("select");
    if (select && select !== knownSelect) {
      if (selectOption(select, acceptedTexts)) return "selected";
      hasPendingNativeControl = true;
    }
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
