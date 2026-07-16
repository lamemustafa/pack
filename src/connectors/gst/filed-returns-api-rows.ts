import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { matchesAcceptedText } from "./filed-returns-dom";
import { acceptedFiledReturnsPeriodTexts } from "./filed-returns-months";

export interface FiledReturnsApiRow {
  rtntype?: unknown;
  rtnTyp?: unknown;
  rtnType?: unknown;
  rtn_type?: unknown;
  fy?: unknown;
  finYear?: unknown;
  financialYear?: unknown;
  taxp?: unknown;
  taxPeriod?: unknown;
  retPeriod?: unknown;
  period?: unknown;
  arn?: unknown;
  ackNo?: unknown;
  ackNum?: unknown;
  dof?: unknown;
  dateOfFiling?: unknown;
}

export function extractFiledReturnsApiRows(payload: unknown): FiledReturnsApiRow[] | null {
  if (Array.isArray(payload)) return payload.filter(isFiledReturnsApiRow);
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data.filter(isFiledReturnsApiRow);
  }
  return null;
}

export function rowMatchesScope(
  row: FiledReturnsApiRow,
  scope: FiledReturnsDownloadScope,
): boolean {
  return (
    matchesAcceptedText(
      readFiledReturnRowValue(row, ["rtntype", "rtnTyp", "rtnType", "rtn_type"]),
      [scope.returnType],
    ) &&
    matchesAcceptedText(readFiledReturnRowValue(row, ["fy", "finYear", "financialYear"]), [
      scope.financialYear,
    ]) &&
    matchesAcceptedText(
      readFiledReturnRowValue(row, ["taxp", "taxPeriod", "retPeriod", "period"]),
      acceptedFiledReturnsPeriodTexts(scope),
    )
  );
}

export function readFiledReturnRowValue(
  row: FiledReturnsApiRow,
  keys: readonly (keyof FiledReturnsApiRow)[],
): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function isFiledReturnsApiRow(row: unknown): row is FiledReturnsApiRow {
  return Boolean(row && typeof row === "object");
}
