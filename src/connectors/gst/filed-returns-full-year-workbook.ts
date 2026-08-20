import { createXlsx, type XlsxCell, type XlsxWorksheet } from "../../core/xlsx";
import type {
  FiledReturnsSummaryContextRow,
  FiledReturnsSummaryDataRow,
  FiledReturnsSummaryPlanEntry,
  FiledReturnsSummarySheet,
} from "./filed-returns-summary-sheet";
import {
  filedReturnsStatementCoverage,
  filedReturnsStatementLineItems,
} from "./filed-returns-summary-labels";
import { FILED_RETURNS_MONTHS, type FiledReturnsMonth } from "./filed-returns-scope";

export const FILED_RETURNS_FULL_YEAR_WORKBOOK_PATH = "full-year-workbook.xlsx";

const FOOTER_VALUE_COLUMN_WIDTH = 58;
const MONTH_COLUMN_WIDTH = 13;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface WorkbookOptions {
  generatedAt: Date;
  maxOutputBytes?: number;
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
        consolidatedSheet(
          financialYear,
          summary.dataRows,
          summary.contextRows,
          options.generatedAt,
        ),
      ],
    },
    options.maxOutputBytes,
  );
}

function consolidatedSheet(
  financialYear: string,
  dataRows: readonly FiledReturnsSummaryDataRow[],
  contextRows: readonly FiledReturnsSummaryContextRow[],
  generatedAt: Date,
): XlsxWorksheet {
  const rows: Array<Array<XlsxCell | undefined>> = [
    [{ value: "GSTIN", style: "bold" }, { value: taxpayerIdentityValue(contextRows, "GSTIN") }],
    [
      { value: "Legal name", style: "bold" },
      { value: taxpayerIdentityValue(contextRows, "Legal name") },
    ],
    [{ value: "Financial year", style: "bold" }, { value: financialYear }],
    [],
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
  const coverage = filedReturnsStatementCoverage();
  rows.push(
    [
      { value: "Source", style: "bold" },
      { value: `Filed GSTR-3B returns from the GST portal · ${humanDate(generatedAt)}` },
    ],
    [
      { value: "Coverage", style: "bold" },
      {
        value: `Tables ${coverage.includedTables.join(" and ")}. Not included: ${coverage.excludedTables.join(", ")}.`,
      },
    ],
  );
  return {
    name: "GSTR-3B Consolidated",
    freezeFirstColumnAndRows: 5,
    columns: [
      { width: 78 },
      { width: FOOTER_VALUE_COLUMN_WIDTH },
      ...FILED_RETURNS_MONTHS.slice(1).map(() => ({ width: MONTH_COLUMN_WIDTH })),
      { width: 15 },
    ],
    rows,
  };
}

function humanDate(value: Date): string {
  return `${value.getUTCDate()} ${MONTH_NAMES[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
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

function taxpayerIdentityValue(
  rows: readonly FiledReturnsSummaryContextRow[],
  fieldLabel: "GSTIN" | "Legal name",
): string {
  const matches = rows.filter(
    (row) => row.contextType === "taxpayer_identity" && row.fieldLabel === fieldLabel,
  );
  if (matches.length > 1) throw new SyntaxError("Duplicate workbook taxpayer identity.");
  return matches[0]?.valueText ?? "";
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
