import {
  getClickableElements,
  isHtmlElement,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { findKnownGstSelect, findLabelledSelects } from "./filed-returns-filter-fields";
import { findSearchButton, findSearchButtons } from "./gstr2b-dashboard-search";

const FINANCIAL_YEAR_LABEL = /financial\s+year/i;
const QUARTER_LABEL = /^quarter\b/i;
const PERIOD_LABEL = /^period\b|^tax\s+period\b|^month\b/i;

export type ReturnDashboardControls = {
  year: HTMLSelectElement;
  quarter: HTMLSelectElement | null;
  period: HTMLSelectElement;
  search: HTMLElement;
};

export function findReturnDashboardControls(documentRef: Document): ReturnDashboardControls | null {
  const root =
    findReturnDashboardFilterRoot(documentRef) ?? findNativeReturnDashboardRoot(documentRef);
  if (!root) return null;

  const year = findDashboardControlSelect(root, FINANCIAL_YEAR_LABEL, "financial-year");
  const quarter = findDashboardControlSelect(root, QUARTER_LABEL, "quarter");
  const period = findDashboardControlSelect(root, PERIOD_LABEL, "period");
  const search = findSearchButton(root);
  if (!year || !period || !search) return null;
  return { year, quarter, period, search };
}

export function diagnoseReturnDashboardControls(documentRef: Document): string[] {
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

export function selectedDashboardFilterSignals(controls: {
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

export function isReturnDashboardStillRendering(
  documentRef: Document,
  documentText: string,
): boolean {
  if (normaliseText(documentText).length > 40) return false;
  return getClickableElements(documentRef).length === 0;
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

function findReturnDashboardFilterRoot(documentRef: Document): HTMLElement | null {
  const nativeDashboardForm = documentRef.querySelector("form[name='dashboard']");
  if (nativeDashboardForm && isHtmlElement(documentRef, nativeDashboardForm)) {
    return nativeDashboardForm;
  }

  const roots: Array<{ element: HTMLElement; score: number }> = [];
  for (const searchButton of findSearchButtons(documentRef)) {
    const owningForm = searchButton.closest("form");
    if (owningForm && isHtmlElement(documentRef, owningForm)) {
      const formText = normaliseText(owningForm.innerText || owningForm.textContent || "");
      if (/financial\s+year/.test(formText) && /\bperiod\b/.test(formText)) {
        roots.push({ element: owningForm, score: formText.length });
        continue;
      }
    }

    let current: HTMLElement | null = searchButton;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const text = normaliseText(current.innerText || current.textContent || "");
      if (/financial\s+year/.test(text) && /\bperiod\b/.test(text)) {
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
    /\bperiod\b/.test(bodyText)
  ) {
    return documentRef.body;
  }

  return null;
}

function findNativeReturnDashboardRoot(documentRef: Document): HTMLElement | null {
  const body = documentRef.body;
  if (!body) return null;
  const controls = findOrderedDashboardSelects(body);
  if (!controls.year || !controls.period) return null;
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

function isSelectElement(element: Element): element is HTMLSelectElement {
  return element.tagName.toLowerCase() === "select";
}
