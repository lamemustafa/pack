import { createXlsx, type XlsxCell, type XlsxWorksheet } from "../../core/xlsx";
import type {
  FiledReturnsSummaryContextRow,
  FiledReturnsSummaryDataRow,
  FiledReturnsSummaryPlanEntry,
  FiledReturnsSummarySheet,
} from "./filed-returns-summary-sheet";
import {
  FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS,
  type FiledReturnsGstr3bWorkbookIdentityLabel,
} from "./filed-returns-summary-identity";
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
    ...FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS.map((fieldLabel) => [
      { value: fieldLabel, style: "bold" as const },
      { value: taxpayerIdentityValue(contextRows, fieldLabel) },
    ]),
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
      const numericValues = monthValues.filter(
        (value): value is StatementNumericValue => value !== undefined,
      );
      const total =
        numericValues.length === 0
          ? undefined
          : exactTotalSpreadsheetValue(
              numericValues.map((value) => value.sourceText),
              numericValues.some((value) => value.number === null),
            );
      rows.push([
        { value: item.shortLabel },
        ...monthValues.map((value) =>
          value === undefined
            ? undefined
            : value.number === null
              ? { value: "Precision limit" }
              : { value: value.number, style: "number" as const },
        ),
        total !== undefined
          ? typeof total === "number"
            ? { value: total, style: "number" }
            : { value: total }
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

interface StatementNumericValue {
  number: number | null;
  sourceText: string;
}

function statementValues(
  dataRows: readonly FiledReturnsSummaryDataRow[],
): Map<string, StatementNumericValue> {
  const output = new Map<string, StatementNumericValue>();
  const statementPaths = new Set(filedReturnsStatementLineItems().map((item) => item.fieldPath));
  for (const row of dataRows) {
    if (
      row.returnType !== "GSTR-3B" ||
      !statementPaths.has(row.fieldPath) ||
      row.valueNumber === undefined
    ) {
      continue;
    }
    const key = `${row.period}:${row.fieldPath}`;
    if (output.has(key)) throw new SyntaxError("Duplicate GSTR-3B statement value.");
    output.set(key, {
      number: exactSpreadsheetNumber(row.valueNumber),
      sourceText: row.valueNumber,
    });
  }
  return output;
}

function exactTotalSpreadsheetValue(
  inputs: readonly string[],
  hasUnrepresentableMonth: boolean,
): number | string {
  const exactText = exactDecimalSum(inputs);
  if (exactText === null) return "Exact total unavailable: invalid source decimal";
  const value = exactSpreadsheetNumber(exactText);
  if (hasUnrepresentableMonth || value === null || String(value) !== exactText) {
    return `Exact total ${exactText} unavailable at spreadsheet numeric precision`;
  }
  return value;
}

function exactDecimalSum(inputs: readonly string[]): string | null {
  const decimals = inputs.map((input) => /^(-?)(\d+)(?:\.(\d+))?$/.exec(input));
  if (decimals.some((decimal) => decimal === null)) return null;
  const scale = Math.max(...decimals.map((decimal) => decimal![3]?.length ?? 0));
  let total = 0n;
  for (const decimal of decimals) {
    const [, sign, whole, fraction = ""] = decimal!;
    const scaled = BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
    total += sign === "-" ? -scaled : scaled;
  }
  if (total === 0n) return "0";
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
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
  if (value === 0 && !/^-?0+(?:\.0+)?$/.test(input)) return null;
  return value;
}

function taxpayerIdentityValue(
  rows: readonly FiledReturnsSummaryContextRow[],
  fieldLabel: FiledReturnsGstr3bWorkbookIdentityLabel,
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
