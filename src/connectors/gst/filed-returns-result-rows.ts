import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { getClickableElements, matchesAcceptedText, normaliseText } from "./filed-returns-dom";
import { extractTaxPeriodFromRow } from "./filed-returns-detail-identity";
import {
  acceptedFiledReturnsPeriodTexts,
  canonicalFiledReturnsMonth,
} from "./filed-returns-months";

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
      const rowText = readElementText(row);
      const period = canonicalResultRowPeriod(identity.period ?? extractTaxPeriodFromRow(row));
      const returnType = identity.returnType ?? rowText;
      const financialYearMatch = financialYearMatchForScope(identity.financialYear, rowText, scope);
      return {
        filterBound:
          options.allowFilterBoundScope === true &&
          (period === null || financialYearMatch === "absent"),
        matches:
          matchesAcceptedText(returnType, [scope.returnType]) &&
          financialYearMatch !== "conflict" &&
          (financialYearMatch === "match" || options.allowFilterBoundScope === true) &&
          periodMatchesScope(period, scope, options),
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
    .map((view) => ({ view, container: findNearestGstr1ResultContainer(view) }))
    .filter((candidate): candidate is { view: HTMLElement; container: HTMLElement } =>
      Boolean(candidate.container),
    )
    .filter(({ container }) => filterBoundIdentityMatchesScope(container, scope))
    .map(({ view, container }) => ({ view, container, filterBound: true, period: null }));
}

function filterBoundIdentityMatchesScope(
  container: HTMLElement,
  scope: FiledReturnsDownloadScope,
): boolean {
  const text = normaliseText(readElementText(container));
  const financialYearEvidence = extractFinancialYearEvidence(text);
  const periodEvidence = extractExplicitPeriodEvidence(text);
  return (
    financialYearEvidence.valid &&
    financialYearEvidence.values.every((financialYear) => financialYear === scope.financialYear) &&
    periodEvidence.valid &&
    periodEvidence.values.every((period) => period === scope.period)
  );
}

function extractFinancialYearEvidence(text: string): { valid: boolean; values: string[] } {
  const matches = Array.from(text.matchAll(/\b(20\d{2})\s*[-\u2013/]\s*(\d{2}|\d{4})(?!\d)/g));
  const values = matches
    .map((match) => canonicalFinancialYear(match[1], match[2]))
    .filter((financialYear): financialYear is string => Boolean(financialYear));
  return { valid: values.length === matches.length, values };
}

function extractExplicitPeriodEvidence(text: string): { valid: boolean; values: string[] } {
  const matches = Array.from(
    text.matchAll(/\b(?:(?:return|tax)\s*(?:filing\s*)?period|month)\b\s*(?:[-:]\s*)?([a-z]+)\b/gi),
  );
  const values: string[] = [];
  let valid = true;
  for (const match of matches) {
    const rawPeriod = match[1]?.toLowerCase();
    const period = canonicalFiledReturnsMonth(rawPeriod);
    if (period) {
      values.push(period);
    } else if (rawPeriod !== "monthly" && rawPeriod !== "quarterly") {
      valid = false;
    }
  }
  return { valid, values };
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

function financialYearMatchForScope(
  explicitFinancialYear: string | null,
  rowText: string,
  scope: FiledReturnsDownloadScope,
): "absent" | "conflict" | "match" {
  if (explicitFinancialYear) {
    const evidence = extractFinancialYearEvidence(explicitFinancialYear);
    if (evidence.values.length > 0) {
      return evidence.valid &&
        evidence.values.every((financialYear) => financialYear === scope.financialYear)
        ? "match"
        : "conflict";
    }
    return matchesAcceptedText(explicitFinancialYear, [scope.financialYear]) ? "match" : "conflict";
  }
  const evidence = extractFinancialYearEvidence(rowText);
  if (evidence.values.length > 0 || !evidence.valid) {
    return evidence.valid &&
      evidence.values.every((financialYear) => financialYear === scope.financialYear)
      ? "match"
      : "conflict";
  }
  return matchesAcceptedText(rowText, [scope.financialYear]) ? "match" : "absent";
}

function canonicalFinancialYear(
  startYear: string | undefined,
  rawEndYear: string | undefined,
): string | null {
  if (!startYear || !rawEndYear) return null;
  const expectedEndYear = Number(startYear) + 1;
  if (rawEndYear.length === 4 && Number(rawEndYear) !== expectedEndYear) return null;
  const endYear = rawEndYear.length === 4 ? rawEndYear.slice(2) : rawEndYear;
  return Number(endYear) === expectedEndYear % 100 ? `${startYear}-${endYear}` : null;
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
