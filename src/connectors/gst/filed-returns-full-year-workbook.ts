import { createXlsx, type XlsxCell, type XlsxWorksheet } from "../../core/xlsx";
import type {
  FiledReturnsSummaryContextRow,
  FiledReturnsSummaryDataRow,
  FiledReturnsSummaryPlanEntry,
  FiledReturnsSummarySheet,
} from "./filed-returns-summary-sheet";
import {
  FILED_RETURNS_SUMMARY_FORMAT_VERSION,
  FILED_RETURNS_SUMMARY_SHEET_PATH,
} from "./filed-returns-summary-sheet";
import { filedReturnsStatementLineItems } from "./filed-returns-summary-labels";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

export const FILED_RETURNS_FULL_YEAR_WORKBOOK_PATH = "full-year-workbook.xlsx";
export const FILED_RETURNS_FULL_YEAR_WORKBOOK_FORMAT_VERSION = "pack-full-year-workbook-v2";

const GSTR9_BOUNDARY =
  "GSTR-9 is not the sum of twelve GSTR-3B returns. Its Table 4 requires outward supplies split by counterparty type, which GSTR-3B does not contain, and it further requires amendments, ITC claimed in a later financial year, and reversals. This workbook does not produce GSTR-9 values.";
const WORKBOOK_NUMBER_RULE =
  "Statement cells are numeric only when a portal decimal can be represented without changing its value and within spreadsheet precision; otherwise the cell is blank. Totals sum the numeric month cells only.";

interface WorkbookOptions {
  generatedAt: Date;
  maxOutputBytes?: number;
  packVersion: string;
}

export function buildFiledReturnsFullYearWorkbook(
  summary: FiledReturnsSummarySheet,
  plan: readonly FiledReturnsSummaryPlanEntry[],
  options: WorkbookOptions,
): Uint8Array {
  const financialYear = singleFinancialYear(plan);
  return createXlsx(
    {
      generatedAt: options.generatedAt,
      worksheets: [
        consolidatedSheet(financialYear, summary.dataRows),
        runDetailsSheet(summary.contextRows, options),
      ],
    },
    options.maxOutputBytes,
  );
}

function runDetailsSheet(
  sourceRows: readonly FiledReturnsSummaryContextRow[],
  options: WorkbookOptions,
): XlsxWorksheet {
  const rows: Array<readonly [string, string]> = [
    ["pack_version", options.packVersion],
    ["generated_at", options.generatedAt.toISOString()],
    ["workbook_format_version", FILED_RETURNS_FULL_YEAR_WORKBOOK_FORMAT_VERSION],
    ["tidy_data_format_version", FILED_RETURNS_SUMMARY_FORMAT_VERSION],
    ["tidy_data_file", FILED_RETURNS_SUMMARY_SHEET_PATH],
    ...["financial_year", "return_types", "artifacts", "planned_periods"].map((contextKey) =>
      requiredContextEntry(sourceRows, "run_metadata", contextKey),
    ),
    ["included_statement_coverage", "Verified labels for Form GSTR-3B Tables 3.1 and 4."],
    [
      "excluded_statement_coverage",
      "Form GSTR-3B Tables 3.1.1, 3.2, 5.1 and 6.1 remain in full-year-summary.csv when present because their statement labels are not yet verified.",
    ],
    ["gstr9_boundary", GSTR9_BOUNDARY],
    ...[
      "envelope_rule",
      "array_rule",
      "number_rule",
      "text_rule",
      "label_rule",
      "identity_rule",
    ].map((contextKey) => requiredContextEntry(sourceRows, "format_rule", contextKey)),
    ["workbook_number_rule", WORKBOOK_NUMBER_RULE],
    ...sourceRows
      .filter(
        (row) => row.contextType === "taxpayer_identity" || row.contextType === "return_identity",
      )
      .map(
        (row) => [`${row.contextType}:${row.contextKey}:${row.fieldLabel}`, row.valueText] as const,
      ),
  ];
  assertUniqueContextKeys(rows.map(([key]) => key));
  return {
    name: "Run details",
    freezeFirstColumnAndTopRow: true,
    columns: [{ width: 48 }, { width: 110 }],
    rows: [
      [
        { value: "Item", style: "bold" },
        { value: "Details", style: "bold" },
      ],
      ...rows.map(([key, value]) => [{ value: key }, { value }]),
    ],
  };
}

function consolidatedSheet(
  financialYear: string,
  dataRows: readonly FiledReturnsSummaryDataRow[],
): XlsxWorksheet {
  const rows: Array<Array<XlsxCell | undefined>> = [
    [
      { value: "Description", style: "bold" },
      ...financialYearMonthSerials(financialYear).map((value) => ({
        value,
        style: "bold-date" as const,
      })),
      { value: "Total", style: "bold" },
    ],
  ];
  const values = statementValues(dataRows);
  const lineItems = filedReturnsStatementLineItems();
  const sectionOrders = [...new Set(lineItems.map((item) => item.sectionOrder))];
  for (const sectionOrder of sectionOrders) {
    const sectionItems = lineItems.filter((item) => item.sectionOrder === sectionOrder);
    rows.push([{ value: sectionItems[0]!.sectionCaption, style: "bold" }]);
    for (const item of sectionItems) {
      const monthValues = FILED_RETURNS_MONTHS.map((period) =>
        values.get(`${period}:${item.fieldPath}`),
      );
      const numericValues = monthValues.filter((value): value is number => value !== undefined);
      rows.push([
        { value: item.shortLabel },
        ...monthValues.map((value) =>
          value === undefined ? undefined : { value, style: "number" as const },
        ),
        numericValues.length > 0
          ? { value: numericValues.reduce((total, value) => total + value, 0), style: "number" }
          : undefined,
      ]);
    }
    rows.push([]);
  }
  return {
    name: "GSTR-3B Consolidated",
    freezeFirstColumnAndTopRow: true,
    columns: [{ width: 78 }, ...FILED_RETURNS_MONTHS.map(() => ({ width: 13 })), { width: 15 }],
    rows,
  };
}

function statementValues(dataRows: readonly FiledReturnsSummaryDataRow[]): Map<string, number> {
  const output = new Map<string, number>();
  const statementPaths = new Set(filedReturnsStatementLineItems().map((item) => item.fieldPath));
  for (const row of dataRows) {
    if (
      row.returnType !== "GSTR-3B" ||
      !statementPaths.has(row.fieldPath) ||
      row.valueNumber === undefined
    ) {
      continue;
    }
    const value = exactSpreadsheetNumber(row.valueNumber);
    if (value === null) continue;
    const key = `${row.period}:${row.fieldPath}`;
    if (output.has(key)) throw new SyntaxError("Duplicate GSTR-3B statement value.");
    output.set(key, value);
  }
  return output;
}

function exactSpreadsheetNumber(input: string): number | null {
  const significantDigits = input
    .replace(/^-/, "")
    .replace(".", "")
    .replace(/^0+/, "")
    .replace(/0+$/, "").length;
  if (significantDigits > 15) return null;
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  return value;
}

function requiredContextEntry(
  rows: readonly FiledReturnsSummaryContextRow[],
  contextType: FiledReturnsSummaryContextRow["contextType"],
  contextKey: string,
): readonly [string, string] {
  const matches = rows.filter(
    (row) => row.contextType === contextType && row.contextKey === contextKey,
  );
  if (matches.length !== 1) throw new SyntaxError("Workbook run detail must have one source row.");
  return [contextKey, matches[0]!.valueText];
}

function assertUniqueContextKeys(rows: readonly string[]): void {
  const keys = new Set<string>();
  for (const key of rows) {
    if (keys.has(key)) throw new SyntaxError("Workbook run detail keys must be unique.");
    keys.add(key);
  }
}

function financialYearMonthSerials(financialYear: string): number[] {
  const startYear = Number(financialYear.slice(0, 4));
  return FILED_RETURNS_MONTHS.map((period) => excelDateSerial(startYear, period));
}

function excelDateSerial(startYear: number, period: FiledReturnsMonth): number {
  const monthIndex = FILED_RETURNS_MONTHS.indexOf(period) + 3;
  const year = startYear + Math.floor(monthIndex / 12);
  const calendarMonth = monthIndex % 12;
  return Date.UTC(year, calendarMonth, 1) / 86_400_000 + 25_569;
}

function singleFinancialYear(plan: readonly FiledReturnsSummaryPlanEntry[]): string {
  const financialYears = [...new Set(plan.map((entry) => entry.financialYear))];
  if (financialYears.length !== 1)
    throw new SyntaxError("Workbook plan must have one financial year.");
  return financialYears[0]!;
}
