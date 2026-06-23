import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import {
  activateElement,
  delay,
  dispatchChange,
  getClickableElements,
  isHtmlElement,
  isVisible,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";

const CLICK_SETTLE_DELAY_MS = 250;
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
  const shouldSelectMonth = !isEntireFinancialYearScope(scope);
  const monthSelected =
    periodSelected && monthFieldPresent && shouldSelectMonth
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
  if (monthFieldPresent && monthSelected && shouldSelectMonth) selectSignals.push("month-selected");
  if (monthFieldPresent && monthSelected && !shouldSelectMonth) {
    selectSignals.push("month-left-unselected-for-financial-year");
  }
  if (returnTypeSelected) selectSignals.push("return-type-selected");

  const search = getClickableElements(documentRef).find((element) =>
    /^search$/i.test(normaliseText(element.innerText || element.textContent || "")),
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
      (monthFieldPresent && monthSelected && shouldSelectMonth) ||
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
    return isEntireFinancialYearScope(scope) ? ["Monthly"] : ["Monthly", scope.period];
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

function isEntireFinancialYearScope(scope: FiledReturnsDownloadScope): boolean {
  return scope.period === "ALL";
}

function hasFieldControl(documentRef: Document, labelPattern: RegExp): boolean {
  const formRoot = findFiledReturnsFilterRoot(documentRef);
  const fieldRoot = formRoot ? findFieldRoot(formRoot, labelPattern) : null;
  return Boolean(
    fieldRoot?.querySelector("select") ||
    (fieldRoot && getCustomDropdownControls(fieldRoot).length > 0),
  );
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

  const labels = Array.from(documentRef.querySelectorAll("label")).filter((label) =>
    labelPattern.test(label.textContent || ""),
  );

  for (const label of labels) {
    const select = findNextSelect(label);
    if (!select) continue;
    if (selectOption(select, acceptedTexts)) return "selected";
    hasPendingNativeControl = true;
  }

  if (hasPendingNativeControl) return "pending";

  return (await selectCustomOptionNearLabel(documentRef, labelPattern, acceptedTexts))
    ? "selected"
    : "missing";
}

function findNextSelect(label: Element): HTMLSelectElement | null {
  const forId = label.getAttribute("for");
  const documentRef = label.ownerDocument;
  const HTMLSelectElementConstructor = documentRef.defaultView?.HTMLSelectElement;
  if (!HTMLSelectElementConstructor) return null;

  if (forId) {
    const target = documentRef.getElementById(forId);
    if (target instanceof HTMLSelectElementConstructor) return target;
  }

  let sibling = label.nextElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLSelectElementConstructor) return sibling;
    const nested = sibling.querySelector("select");
    if (nested instanceof HTMLSelectElementConstructor) return nested;
    sibling = sibling.nextElementSibling;
  }
  return null;
}

function findKnownGstSelect(root: ParentNode, labelPattern: RegExp): HTMLSelectElement | null {
  const ids = knownGstSelectIds(labelPattern);
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  const HTMLSelectElementConstructor = documentRef?.defaultView?.HTMLSelectElement;
  if (!HTMLSelectElementConstructor) return null;

  for (const id of ids) {
    const selector = `#${id}`;
    const candidate = root.querySelector(selector);
    if (candidate instanceof HTMLSelectElementConstructor) return candidate;
  }

  return null;
}

function knownGstSelectIds(labelPattern: RegExp): string[] {
  if (labelPattern.test("financial year")) return ["finYr"];
  if (labelPattern.test("return filing period")) return ["optValue"];
  if (labelPattern.test("month")) return ["month"];
  if (labelPattern.test("return type")) return ["retTyp"];
  return [];
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

async function selectCustomOptionNearLabel(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): Promise<boolean> {
  const formRoot = findFiledReturnsFilterRoot(documentRef);
  if (!formRoot) return false;

  const fieldRoot = findFieldRoot(formRoot, labelPattern);
  if (!fieldRoot) return false;

  const currentText = normaliseText(fieldRoot.textContent || "");
  if (matchesAcceptedText(currentText, acceptedTexts)) return true;

  const control = getCustomDropdownControls(fieldRoot).find((candidate) => isVisible(candidate));
  if (!control) return false;

  activateElement(control);
  await delay(CLICK_SETTLE_DELAY_MS);

  const option = findVisibleOption(documentRef, acceptedTexts, control);
  if (!option) return false;

  activateElement(option);
  await delay(CLICK_SETTLE_DELAY_MS);
  return true;
}

function findFiledReturnsFilterRoot(documentRef: Document): HTMLElement | null {
  const searchButton = getClickableElements(documentRef).find((element) =>
    /^search$/i.test(normaliseText(element.innerText || element.textContent || "")),
  );
  if (!searchButton) return null;

  let current: HTMLElement | null = searchButton;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const text = normaliseText(current.innerText || current.textContent || "");
    if (
      /financial\s+year/i.test(text) &&
      /return\s+filing\s+period/i.test(text) &&
      /return\s+type/i.test(text)
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return searchButton.parentElement;
}

function findFieldRoot(root: ParentNode, labelPattern: RegExp): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("label, div, span, p")).filter(
    (element) => {
      const text = normaliseText(element.textContent || "");
      return text.length > 0 && text.length <= 80 && labelPattern.test(text);
    },
  );

  for (const candidate of candidates) {
    let current: HTMLElement | null = candidate;
    for (let depth = 0; current && depth < 4; depth += 1) {
      const controls = getCustomDropdownControls(current);
      const selects = current.querySelectorAll("select");
      const text = normaliseText(current.innerText || current.textContent || "");
      if (
        ((controls.length > 0 && controls.length <= 2) || selects.length === 1) &&
        text.length <= 160
      ) {
        return current;
      }
      current = current.parentElement;
    }
  }

  return null;
}

function getCustomDropdownControls(root: ParentNode): HTMLElement[] {
  const selector = [
    "button",
    "[role='button']",
    "[aria-haspopup]",
    "[ng-click]",
    "[data-ng-click]",
    ".select2-choice",
    ".ui-select-match",
    ".chosen-single",
    ".dropdown-toggle",
  ].join(",");

  return Array.from(root.querySelectorAll(selector)).filter((element) =>
    isHtmlElement(root, element),
  );
}

function findVisibleOption(
  documentRef: Document,
  acceptedTexts: readonly string[],
  openedControl: HTMLElement,
): HTMLElement | null {
  const selector = [
    "[role='option']",
    ".ui-select-choices-row",
    ".select2-results li",
    ".chosen-results li",
    "li",
    "a",
    "button",
    "span",
    "[role='listbox'] div",
    ".dropdown-menu div",
    ".ui-select-choices div",
    ".select2-results div",
  ].join(",");

  for (const element of Array.from(documentRef.body.querySelectorAll(selector))) {
    if (!isHtmlElement(documentRef, element)) continue;
    if (element === openedControl || openedControl.contains(element)) continue;
    if (!isVisible(element)) continue;
    const text = normaliseText(element.innerText || element.textContent || "");
    if (text.length > 0 && text.length <= 80 && matchesAcceptedText(text, acceptedTexts)) {
      return element;
    }
  }

  return null;
}
