import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { getClickableElements, normaliseText } from "./filed-returns-dom";
import { extractTaxPeriodFromRow } from "./filed-returns-detail-identity";
import {
  canonicalResultRowPeriod,
  filterBoundResultIdentityMatchesScope,
  returnIdentityMatchesScope,
  resultRowFinancialYearMatch,
  resultRowPeriodMatch,
} from "./filed-returns-result-identity";

export interface MatchingFiledReturnRow {
  filterBound: boolean;
  row: HTMLTableRowElement;
  period: string | null;
}

export interface MatchingActionableFiledReturnRow extends MatchingFiledReturnRow {
  view: HTMLElement;
}

export interface MatchingFilterBoundGstr1Result {
  container: HTMLElement;
  filterBound: true;
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
    .map((row) => {
      const identity = extractResultRowIdentity(row);
      const rowText = readResultRowText(row);
      const explicitPeriod = identity.period ?? extractTaxPeriodFromRow(row);
      const periodMatch = resultRowPeriodMatch(explicitPeriod, rowText, scope);
      const period = canonicalResultRowPeriod(explicitPeriod) ?? periodMatch.period;
      const returnType = identity.returnType ?? rowText;
      const financialYearMatch = resultRowFinancialYearMatch(
        identity.financialYear,
        rowText,
        scope,
      );
      return {
        filterBound:
          options.allowFilterBoundScope === true &&
          (periodMatch.state === "absent" || financialYearMatch === "absent"),
        matches:
          returnIdentityMatchesScope(returnType, scope) &&
          financialYearMatch !== "conflict" &&
          (financialYearMatch === "match" || options.allowFilterBoundScope === true) &&
          periodMatch.state !== "conflict" &&
          (periodMatch.state === "match" || options.allowFilterBoundScope === true),
        period,
        row,
      };
    })
    .filter(({ matches }) => matches)
    .map(({ filterBound, period, row }) => ({
      filterBound,
      row,
      period,
    }));
}

export function findMatchingActionableFiledReturnRows(
  root: ParentNode,
  scope: FiledReturnsDownloadScope,
  options: FiledReturnsResultRowMatchOptions = {},
): MatchingActionableFiledReturnRow[] {
  return findMatchingFiledReturnRows(root, scope, options)
    .map(({ filterBound, row, period }) => ({
      filterBound,
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
    .map((view) => ({ view, container: findGstr1ResultContainer(view) }))
    .filter((candidate): candidate is { view: HTMLElement; container: HTMLElement } =>
      Boolean(candidate.container),
    )
    .filter(({ container }) =>
      filterBoundResultIdentityMatchesScope(normaliseText(readElementText(container)), scope),
    )
    .map(({ view, container }) => ({ view, container, filterBound: true, period: null }));
}

function findGstr1ResultContainer(view: HTMLElement): HTMLElement | null {
  if (view.closest("tr")) return null;
  let result: HTMLElement | null = null;
  let current = view.parentElement;
  while (current && current !== current.ownerDocument.body) {
    if (["MAIN", "FORM"].includes(current.tagName)) break;
    if (isResultSurfaceBoundary(current)) break;
    if (isCandidateResultContainer(current)) {
      if (
        getClickableElements(current).filter(
          (element) => isVisibleResultControl(element) && isExactViewAction(element),
        ).length === 1
      ) {
        result = current;
        if (isSemanticResultCard(current)) break;
      }
    }
    current = current.parentElement;
  }
  return result;
}

function isSemanticResultCard(element: HTMLElement): boolean {
  return ["ARTICLE", "LI"].includes(element.tagName) || element.getAttribute("role") === "row";
}

function isResultSurfaceBoundary(element: HTMLElement): boolean {
  if (
    [element.getAttribute("aria-label"), element.id].some((value) =>
      typeof value === "string" ? isNamedResultSurfaceValue(value) : false,
    )
  ) {
    return true;
  }
  return element.className
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .some((token) => isNamedResultSurfaceValue(token));
}

function isNamedResultSurfaceValue(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  return /^(?:search[-_\s]+results(?:[-_\s]+(?:container|panel|surface|list|table))?|results(?:[-_\s]+(?:container|panel|surface|list|table))?)$/.test(
    normalised,
  );
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
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    if (current === current.ownerDocument.body) break;
    current = current.parentElement;
  }
  return true;
}

function readResultRowText(row: HTMLTableRowElement): string {
  const cells = Array.from(row.querySelectorAll("td"));
  return cells.length > 0
    ? cells.map((cell) => readElementText(cell)).join(" ")
    : readElementText(row);
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
