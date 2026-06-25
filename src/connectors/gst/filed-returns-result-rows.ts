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

export function findMatchingFiledReturnRows(
  root: ParentNode,
  scope: FiledReturnsDownloadScope,
): MatchingFiledReturnRow[] {
  return Array.from(root.querySelectorAll("tr"))
    .map((row) => ({ row, identity: extractResultRowIdentity(row) }))
    .filter(({ row, identity }) => {
      const rowText = readElementText(row);
      const period = canonicalResultRowPeriod(identity.period ?? extractTaxPeriodFromRow(row));
      const financialYear = identity.financialYear ?? rowText;
      const returnType = identity.returnType ?? rowText;
      return (
        matchesAcceptedText(returnType, [scope.returnType]) &&
        matchesAcceptedText(financialYear, [scope.financialYear]) &&
        periodMatchesScope(period, scope)
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
): MatchingActionableFiledReturnRow[] {
  return findMatchingFiledReturnRows(root, scope)
    .map(({ row, period }) => ({
      row,
      period,
      view: getClickableElements(row).find((element) =>
        /^view$/i.test(normaliseText(readElementText(element))),
      ),
    }))
    .filter((candidate): candidate is MatchingActionableFiledReturnRow => Boolean(candidate.view));
}

function periodMatchesScope(period: string | null, scope: FiledReturnsDownloadScope): boolean {
  if (!period) return false;
  return matchesAcceptedText(period, acceptedFiledReturnsPeriodTexts(scope));
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
  return [
    "innerText" in element ? (element as HTMLElement).innerText : "",
    element.textContent ?? "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
