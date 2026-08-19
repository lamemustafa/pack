import { createXlsx, type XlsxCell, type XlsxWorksheet } from "../../core/xlsx";
import type {
  FiledReturnsSummaryContextRow,
  FiledReturnsSummaryDataRow,
  FiledReturnsSummaryPlanEntry,
  FiledReturnsSummarySheet,
} from "./filed-returns-summary-sheet";
import {
  FILED_RETURNS_SUMMARY_CONTEXT_HEADERS,
  FILED_RETURNS_SUMMARY_FORMAT_VERSION,
  FILED_RETURNS_SUMMARY_HEADERS,
  FILED_RETURNS_SUMMARY_SHEET_PATH,
} from "./filed-returns-summary-sheet";
import { filedReturnsStatementLineItems } from "./filed-returns-summary-labels";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

export const FILED_RETURNS_FULL_YEAR_WORKBOOK_PATH = "full-year-workbook.xlsx";
export const FILED_RETURNS_FULL_YEAR_WORKBOOK_FORMAT_VERSION = "pack-full-year-workbook-v1";

const GSTR9_DISCLAIMER =
  "GSTR-9 is not the sum of twelve GSTR-3B returns. Its Table 4 requires outward supplies split by counterparty type, which GSTR-3B does not contain, and it further requires amendments, ITC claimed in a later financial year, and reversals. This sheet shows where sourced 3B figures feed. It does not produce GSTR-9 values.";
const WORKBOOK_NUMBER_RULE =
  "Statement cells are numeric only when a portal decimal can be represented without changing its value and within spreadsheet precision; otherwise the cell is blank. Totals sum the numeric month cells only.";

interface WorkbookOptions {
  generatedAt: Date;
  maxOutputBytes?: number;
  packVersion: string;
}

interface Gstr9ReferenceRow {
  basis: string;
  gstr3bLineItem: string;
  gstr9Table: string;
  verifiedFinancialYear: string;
}

const GSTR9_REFERENCE_ROWS: readonly Gstr9ReferenceRow[] = [
  {
    gstr3bLineItem: "Table 4(A) ITC available",
    gstr9Table: "Table 6",
    basis:
      "Official GST Portal Manual > GSTR-9, section 14.3: Table 6 reports ITC availed and its Table 6A is auto-filled from Form GSTR-3B.",
    verifiedFinancialYear: "2024-25",
  },
];

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
        aboutSheet(financialYear, plan, options),
        consolidatedSheet(financialYear, summary.dataRows),
        gstr9ReferenceSheet(),
        dataSheet(summary.dataRows),
        contextSheet(summary.contextRows),
      ],
    },
    options.maxOutputBytes,
  );
}

function aboutSheet(
  financialYear: string,
  plan: readonly FiledReturnsSummaryPlanEntry[],
  options: WorkbookOptions,
): XlsxWorksheet {
  const returnTypes = [...new Set(plan.map((entry) => entry.returnType))].sort().join(" | ");
  return keyValueSheet("About", [
    ["Workbook format", FILED_RETURNS_FULL_YEAR_WORKBOOK_FORMAT_VERSION],
    ["Tidy data format", FILED_RETURNS_SUMMARY_FORMAT_VERSION],
    ["Tidy data file", FILED_RETURNS_SUMMARY_SHEET_PATH],
    ["Pack version", options.packVersion],
    ["Generated at", options.generatedAt.toISOString()],
    ["Financial year", financialYear],
    ["Return types", returnTypes],
    [
      "Purpose",
      "A local comparative working paper derived from parseable portal JSON already present in this user-requested ZIP.",
    ],
    ["Included statement coverage", "Verified labels for Form GSTR-3B Tables 3.1 and 4."],
    [
      "Excluded statement coverage",
      "Form GSTR-3B Tables 3.1.1, 3.2, 5.1 and 6.1 remain on Data when present because their statement labels are not yet verified.",
    ],
    ["GSTR-9 boundary", "Reference mapping only; this workbook does not compute GSTR-9."],
  ]);
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

function gstr9ReferenceSheet(): XlsxWorksheet {
  return {
    name: "GSTR-9 Reference",
    columns: [{ width: 54 }, { width: 28 }, { width: 135 }, { width: 22 }],
    rows: [
      [{ value: GSTR9_DISCLAIMER }],
      [],
      [
        { value: "GSTR-3B line item", style: "bold" },
        { value: "GSTR-9 table it feeds", style: "bold" },
        { value: "Basis", style: "bold" },
        { value: "Verified financial year", style: "bold" },
      ],
      ...GSTR9_REFERENCE_ROWS.map((row) => [
        { value: row.gstr3bLineItem },
        { value: row.gstr9Table },
        { value: row.basis },
        { value: row.verifiedFinancialYear },
      ]),
    ],
  };
}

function dataSheet(rows: readonly FiledReturnsSummaryDataRow[]): XlsxWorksheet {
  return {
    name: "Data",
    freezeFirstColumnAndTopRow: true,
    columns: FILED_RETURNS_SUMMARY_HEADERS.map((header) => ({
      width: header === "field_label" ? 120 : header === "field_path" ? 72 : 20,
    })),
    rows: [
      FILED_RETURNS_SUMMARY_HEADERS.map((header) => ({ value: header, style: "bold" })),
      ...rows.map((row) => dataCells(row)),
    ],
  };
}

function dataCells(row: FiledReturnsSummaryDataRow): Array<XlsxCell | undefined> {
  return [
    { value: row.period },
    { value: row.returnType },
    { value: row.artifact },
    { value: row.outcome },
    { value: row.fieldLabel },
    { value: row.fieldPath },
    row.valueText === undefined ? undefined : { value: row.valueText },
    row.valueNumber === undefined ? undefined : { value: row.valueNumber },
  ];
}

function contextSheet(rows: readonly FiledReturnsSummaryContextRow[]): XlsxWorksheet {
  const augmentedRows = [
    ...rows,
    {
      contextType: "format_rule" as const,
      contextKey: "workbook_number_rule",
      fieldLabel: "",
      fieldPath: "",
      valueText: WORKBOOK_NUMBER_RULE,
    },
  ];
  return {
    name: "Context",
    freezeFirstColumnAndTopRow: true,
    columns: FILED_RETURNS_SUMMARY_CONTEXT_HEADERS.map((header) => ({
      width: header === "value_text" ? 110 : header === "field_path" ? 55 : 24,
    })),
    rows: [
      FILED_RETURNS_SUMMARY_CONTEXT_HEADERS.map((header) => ({ value: header, style: "bold" })),
      ...augmentedRows.map((row) => [
        { value: row.contextType },
        { value: row.contextKey },
        { value: row.fieldLabel },
        { value: row.fieldPath },
        { value: row.valueText },
      ]),
    ],
  };
}

function keyValueSheet(name: string, rows: readonly (readonly [string, string])[]): XlsxWorksheet {
  return {
    name,
    columns: [{ width: 32 }, { width: 110 }],
    rows: [
      [
        { value: "Item", style: "bold" },
        { value: "Details", style: "bold" },
      ],
      ...rows.map(([key, value]) => [{ value: key }, { value }]),
    ],
  };
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
