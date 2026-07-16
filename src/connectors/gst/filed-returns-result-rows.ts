import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { getClickableElements, matchesAcceptedText, normaliseText } from "./filed-returns-dom";
import { extractTaxPeriodFromRow } from "./filed-returns-detail-identity";
import {
  acceptedFiledReturnsPeriodTexts,
  canonicalFiledReturnsMonth,
} from "./filed-returns-months";

export interface MatchingFiledReturnRow {
  row: HTMLTableRowElement;
  period: string | null;
}

export interface MatchingActionableFiledReturnRow extends MatchingFiledReturnRow {
  view: HTMLElement;
}

export interface MatchingFilterBoundGstr1Result {
  container: HTMLElement;
  period: null;
  view: HTMLElement;
}

export interface FiledReturnsResultRowMatchOptions {
  allowFilterBoundScope?: boolean;
}

export function findMatchingFiledReturnRows(
  root: ParentNode,
  scope: FiledReturnsDownloadScope,
  options: FiledReturnsResultRowMatchOptions = {},
): MatchingFiledReturnRow[] {
  return Array.from(root.querySelectorAll("tr"))
    .map((row) => ({ row, identity: extractResultRowIdentity(row) }))
    .filter(({ row, identity }) => {
      const rowText = readElementText(row);
      const period = canonicalResultRowPeriod(identity.period ?? extractTaxPeriodFromRow(row));
      const returnType = identity.returnType ?? rowText;
      return (
        matchesAcceptedText(returnType, [scope.returnType]) &&
        financialYearMatchesScope(identity.financialYear, rowText, scope, options) &&
        periodMatchesScope(period, scope, options)
      );
    })
    .map(({ row, identity }) => ({
      row,
      period: canonicalResultRowPeriod(identity.period ?? extractTaxPeriodFromRow(row)),
    }));
}

export function findMatchingActionableFiledReturnRows(
  root: ParentNode,
  scope: FiledReturnsDownloadScope,
  options: FiledReturnsResultRowMatchOptions = {},
): MatchingActionableFiledReturnRow[] {
  return findMatchingFiledReturnRows(root, scope, options)
    .map(({ row, period }) => ({
      row,
      period,
      view: getClickableElements(row).find((element) =>
        /^view$/i.test(normaliseText(readElementText(element))),
      ),
    }))
    .filter((candidate): candidate is MatchingActionableFiledReturnRow => Boolean(candidate.view));
}

export function findMatchingFilterBoundGstr1Results(
  root: ParentNode,
  scope: FiledReturnsDownloadScope,
): MatchingFilterBoundGstr1Result[] {
  return getClickableElements(root)
    .filter((view) => isVisibleResultControl(view) && isExactViewAction(view))
    .map((view) => ({ view, container: findNearestGstr1ResultContainer(view) }))
    .filter((candidate): candidate is { view: HTMLElement; container: HTMLElement } =>
      Boolean(candidate.container),
    )
    .filter(({ container }) => filterBoundIdentityMatchesScope(container, scope))
    .map(({ view, container }) => ({ view, container, period: null }));
}

function filterBoundIdentityMatchesScope(
  container: HTMLElement,
  scope: FiledReturnsDownloadScope,
): boolean {
  const text = normaliseText(readElementText(container));
  const explicitFinancialYear = extractExplicitFinancialYear(text);
  const explicitPeriod = extractExplicitPeriod(text);
  return (
    (!explicitFinancialYear || explicitFinancialYear === scope.financialYear) &&
    (!explicitPeriod || explicitPeriod === scope.period)
  );
}

function extractExplicitFinancialYear(text: string): string | null {
  const match =
    /\b(?:financial\s*year|fy)\b\s*(?:[-:]\s*)?(20\d{2})\s*[-\u2013/]\s*(\d{2}|\d{4})\b/.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const endYear = match[2].length === 4 ? match[2].slice(2) : match[2];
  return Number(endYear) === (Number(match[1]) + 1) % 100 ? `${match[1]}-${endYear}` : null;
}

function extractExplicitPeriod(text: string): string | null {
  const match =
    /\b(?:(?:return|tax)\s*(?:filing\s*)?period|month)\b\s*(?:[-:]\s*)?([a-z]+)\b/i.exec(text);
  return canonicalFiledReturnsMonth(match?.[1]);
}

function findNearestGstr1ResultContainer(view: HTMLElement): HTMLElement | null {
  if (view.closest("tr")) return null;
  let current = view.parentElement;
  while (current && current !== current.ownerDocument.body) {
    if (["MAIN", "FORM"].includes(current.tagName)) return null;
    if (isCandidateResultContainer(current)) {
      const comparable = normaliseText(readElementText(current)).replace(/[^a-z0-9]/g, "");
      if (
        comparable.includes("gstr1") &&
        !/gstr(?:2a|2b|3b|4|9)/.test(comparable) &&
        getClickableElements(current).filter(
          (element) => isVisibleResultControl(element) && isExactViewAction(element),
        ).length === 1
      ) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return null;
}

function isCandidateResultContainer(element: HTMLElement): boolean {
  return (
    ["ARTICLE", "LI", "SECTION", "DIV"].includes(element.tagName) ||
    element.getAttribute("role") === "row"
  );
}

function isExactViewAction(element: HTMLElement): boolean {
  return /^view$/i.test(normaliseText(readElementText(element)));
}

function isVisibleResultControl(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

function periodMatchesScope(
  period: string | null,
  scope: FiledReturnsDownloadScope,
  options: FiledReturnsResultRowMatchOptions,
): boolean {
  if (!period) return options.allowFilterBoundScope === true;
  return matchesAcceptedText(period, acceptedFiledReturnsPeriodTexts(scope));
}

function financialYearMatchesScope(
  explicitFinancialYear: string | null,
  rowText: string,
  scope: FiledReturnsDownloadScope,
  options: FiledReturnsResultRowMatchOptions,
): boolean {
  if (explicitFinancialYear) {
    return matchesAcceptedText(explicitFinancialYear, [scope.financialYear]);
  }
  if (matchesAcceptedText(rowText, [scope.financialYear])) return true;
  if (hasFinancialYearText(rowText)) return false;
  return options.allowFilterBoundScope === true;
}

function hasFinancialYearText(text: string): boolean {
  return /\b20\d{2}\s*[-–]\s*\d{2}\b/.test(text);
}

function canonicalResultRowPeriod(period: string | null): string | null {
  return canonicalFiledReturnsMonth(period) ?? period;
}

function extractResultRowIdentity(row: Element): {
  financialYear: string | null;
  period: string | null;
  returnType: string | null;
} {
  const cells = Array.from(row.querySelectorAll("td"));
  const headers = getResultTableHeaders(row);
  if (cells.length === 0 || headers.length === 0) {
    return { financialYear: null, period: null, returnType: null };
  }

  return {
    financialYear: readCellByHeader(cells, headers, /financial\s+year|^fy$/i),
    period: readCellByHeader(cells, headers, /tax\s+period|period|month/i),
    returnType: readCellByHeader(cells, headers, /return\s+type|return/i),
  };
}

function getResultTableHeaders(row: Element): string[] {
  const table = row.closest("table");
  if (!table) return [];
  const headerCells = Array.from(table.querySelectorAll("thead th"));
  const fallbackHeaderCells =
    headerCells.length > 0 ? headerCells : Array.from(table.querySelectorAll("th"));
  return fallbackHeaderCells.map((header) => normaliseText(readElementText(header)));
}

function readCellByHeader(cells: readonly Element[], headers: readonly string[], pattern: RegExp) {
  const index = headers.findIndex((header) => pattern.test(header));
  if (index < 0) return null;
  return readElementText(cells[index]).replace(/\s+/g, " ").trim() || null;
}

export function readElementText(element: Element | null | undefined): string {
  if (!element) return "";
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  const seenTexts = new Set<string>();
  return [
    "innerText" in element ? (element as HTMLElement).innerText : "",
    element.textContent ?? "",
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
