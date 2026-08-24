import { isFlatJsonArrayCountReason } from "../../core/json-flat-table";
import { XLSX_NUMBER_DECIMAL_PLACES } from "../../core/xlsx";
import {
  createXlsx,
  MAX_EXCEL_STRING_LENGTH,
  type XlsxCell,
  type XlsxWorksheet,
} from "../../core/xlsx";
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
import {
  FILED_RETURNS_MONTHS,
  type FiledReturnsFilingPeriod,
  type FiledReturnsMonth,
} from "./filed-returns-scope";

export const FILED_RETURNS_FULL_YEAR_WORKBOOK_PATH = "full-year-workbook.xlsx";

const FOOTER_VALUE_COLUMN_WIDTH = 58;
const NON_NUMERIC_CELL_TEXT = "Non-numeric value";
const NON_NUMERIC_TOTAL_TEXT = "Total unavailable: a month is non-numeric";
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
          plan,
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
  plan: readonly FiledReturnsSummaryPlanEntry[],
  dataRows: readonly FiledReturnsSummaryDataRow[],
  contextRows: readonly FiledReturnsSummaryContextRow[],
  generatedAt: Date,
): XlsxWorksheet {
  const renderedMonthSerials = financialYearMonthSerials(financialYear);
  const renderedFilingPeriods = renderedMonthSerials.map((_, index) => ({
    financialYear,
    period: FILED_RETURNS_MONTHS[index]!,
  }));
  const rows: Array<Array<XlsxCell | undefined>> = [
    ...FILED_RETURNS_GSTR3B_WORKBOOK_IDENTITY_LABELS.map((fieldLabel) => [
      { value: fieldLabel, style: "bold" as const },
      { value: taxpayerIdentityValue(contextRows, fieldLabel) },
    ]),
    [{ value: "Financial year", style: "bold" }, { value: financialYear }],
    [],
    [
      { value: "Description", style: "bold" },
      ...renderedMonthSerials.map((value) => ({
        value,
        style: "bold-date" as const,
      })),
      { value: "Total", style: "bold" },
    ],
  ];
  const values = statementValues(dataRows, renderedFilingPeriods);
  const unreadablePeriods = unreadableStatementPeriods(plan, dataRows);
  const lineItems = filedReturnsStatementLineItems(renderedFilingPeriods);
  const sectionOrders = [...new Set(lineItems.map((item) => item.sectionOrder))];
  for (const sectionOrder of sectionOrders) {
    const sectionItems = lineItems.filter((item) => item.sectionOrder === sectionOrder);
    rows.push([{ value: sectionItems[0]!.sectionCaption, style: "bold" }]);
    for (const item of sectionItems) {
      const monthValues = renderedFilingPeriods.map(({ period }) =>
        values.get(`${period}:${item.fieldPath}`),
      );
      const presentValues = monthValues.filter(
        (value): value is StatementCellValue => value !== undefined,
      );
      // A row with a non-numeric month has no total. Summing the rest would
      // assert a figure that silently omits a month, and including the month
      // was worse still: a JSON string like "100" parses as a decimal, so it was
      // being added to a value the sheet had just marked unusable. Only the
      // non-parsing case failed loudly, and only by accident.
      const hasNonNumericMonth = presentValues.some((value) => !value.numeric);
      const total =
        presentValues.length === 0
          ? undefined
          : unreadablePeriods.length > 0
            ? undefined
            : hasNonNumericMonth
              ? NON_NUMERIC_TOTAL_TEXT
              : exactTotalSpreadsheetValue(
                  presentValues.map((value) => value.sourceText),
                  presentValues.some((value) => value.number === null),
                );
      rows.push([
        { value: item.shortLabel },
        ...monthValues.map((value) =>
          value === undefined
            ? undefined
            : !value.numeric
              ? { value: NON_NUMERIC_CELL_TEXT }
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
  const coverage = filedReturnsStatementCoverage(renderedFilingPeriods);
  rows.push(
    [
      { value: "Source", style: "bold" },
      { value: `Filed GSTR-3B returns from the GST portal · ${humanDate(generatedAt)}` },
    ],
    [
      { value: "Coverage", style: "bold" },
      {
        value: `Tables ${coverage.includedTables.join(" and ")}. Not included: ${coverage.excludedTables.join(", ")}.${unreadablePeriods.length === 0 ? "" : ` Unreadable periods: ${unreadablePeriods.join(", ")}.`}`,
      },
    ],
    ...(coverage.withheldCaptionTables
      ? [
          [
            { value: "Caption evidence", style: "bold" as const },
            { value: withheldCaptionFooter(coverage.withheldCaptionTables) },
          ],
        ]
      : []),
  );
  return {
    name: "GSTR-3B Consolidated",
    freezeFirstColumnAndRows: 5,
    columns: [
      { width: 78 },
      { width: FOOTER_VALUE_COLUMN_WIDTH },
      ...renderedFilingPeriods.slice(1).map(() => ({ width: MONTH_COLUMN_WIDTH })),
      { width: 15 },
    ],
    rows,
  };
}

function unreadableStatementPeriods(
  plan: readonly FiledReturnsSummaryPlanEntry[],
  dataRows: readonly FiledReturnsSummaryDataRow[],
): FiledReturnsMonth[] {
  return FILED_RETURNS_MONTHS.filter((period) =>
    plan
      .filter(
        (entry) =>
          entry.artifactType === "JSON" &&
          entry.period === period &&
          entry.returnType === "GSTR-3B",
      )
      .some(
        (entry) =>
          entry.outcomeCategory === "artifact-unavailable" ||
          (entry.outcomeCategory === "staged" && stagedJsonPeriodIsUnreadable(period, dataRows)),
      ),
  );
}

function stagedJsonPeriodIsUnreadable(
  period: FiledReturnsMonth,
  dataRows: readonly FiledReturnsSummaryDataRow[],
): boolean {
  const periodRows = dataRows.filter(
    (row) => row.artifact === "JSON" && row.period === period && row.returnType === "GSTR-3B",
  );
  return (
    periodRows.length === 0 ||
    periodRows.some((row) => row.fieldPath === "pack:outcome" && row.outcome !== "parseable-json")
  );
}

// Local components, not UTC. The footer presents an unqualified human-readable
// date, so an export at 00:30 in a UTC+ zone was labelled with the previous
// calendar day. This matches the ZIP entry timestamp, which is local for the
// same reason: both are read by a person in their own timezone.
function humanDate(value: Date): string {
  return `${value.getDate()} ${MONTH_NAMES[value.getMonth()]} ${value.getFullYear()}`;
}

interface StatementCellValue {
  number: number | null;
  numeric: boolean;
  sourceText: string;
}

// A mapped statement path whose portal value is a string, boolean, or null is
// present and malformed, not absent. Dropping it blanked the month — which a
// reader cannot tell from a filed zero — and silently understated the Total.
// It is retained here as a non-numeric cell so both stay visible.
function statementValues(
  dataRows: readonly FiledReturnsSummaryDataRow[],
  filingPeriods: readonly FiledReturnsFilingPeriod[],
): Map<string, StatementCellValue> {
  const output = new Map<string, StatementCellValue>();
  const statementPaths = new Set(
    filedReturnsStatementLineItems(filingPeriods).map((item) => item.fieldPath),
  );
  for (const row of dataRows) {
    if (row.returnType !== "GSTR-3B" || !statementPaths.has(row.fieldPath)) continue;
    const key = `${row.period}:${row.fieldPath}`;
    if (output.has(key)) throw new SyntaxError("Duplicate GSTR-3B statement value.");
    // An array-count row carries the array's length in the numeric column, not
    // the field's amount: `txval: []` and `txval: [100]` would otherwise render
    // as 0 and 1 and be summed into the total. The container is present and
    // malformed, so it takes the same marked cell as any other non-numeric
    // value rather than being dropped.
    const isArrayCount = isFlatJsonArrayCountReason(row.outcome);
    output.set(key, {
      number:
        isArrayCount || row.valueNumber === undefined
          ? null
          : exactSpreadsheetNumber(row.valueNumber),
      numeric: !isArrayCount && row.valueNumber !== undefined,
      sourceText: isArrayCount ? "" : (row.valueNumber ?? row.valueText ?? ""),
    });
  }
  return output;
}

function withheldCaptionFooter(tableReferences: readonly string[]): string {
  if (tableReferences.length === 1) return `Withheld captions: ${tableReferences[0]}.`;
  if (tableReferences.length === 2) {
    return `Withheld captions: ${tableReferences[0]} and ${tableReferences[1]}.`;
  }
  return `Withheld captions: ${tableReferences.slice(0, -1).join(", ")}, and ${tableReferences.at(-1)}.`;
}

function exactTotalSpreadsheetValue(
  inputs: readonly string[],
  hasUnrepresentableMonth: boolean,
): number | string {
  const exactText = exactDecimalSum(inputs);
  if (exactText === null) return "Exact total unavailable: invalid source decimal";
  const value = exactSpreadsheetNumber(exactText);
  if (hasUnrepresentableMonth || value === null || String(value) !== exactText) {
    const explanatoryTotal = `Exact total ${exactText} unavailable at spreadsheet numeric precision`;
    return explanatoryTotal.length <= MAX_EXCEL_STRING_LENGTH
      ? explanatoryTotal
      : "Exact total unavailable at spreadsheet numeric precision";
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

/**
 * Exported so the GSTR-2B workbook applies the same boundary rather than
 * carrying a second copy of it. Takes exact decimal *text*, never a number: by
 * the time a value is a JavaScript number the loss this guards against has
 * already happened.
 */
export function exactSpreadsheetNumber(input: string): number | null {
  const significantDigits = input
    .replace(/^-/, "")
    .replace(".", "")
    .replace(/^0+/, "")
    .replace(/0+$/, "").length;
  if (significantDigits > 15) return null;
  // Significant digits do not bound decimal places: `0.0000000000000001` has one
  // significant digit and sixteen decimals. The cell format renders
  // `XLSX_NUMBER_DECIMAL_PLACES` of them, so a value with more cannot be
  // displayed as what it is, and returning it here would store one number and
  // show another -- the defect this rule exists to prevent, surviving past a
  // wider format. It takes the `Precision limit` treatment instead, which is
  // what an unrepresentable value already gets.
  const decimalPlaces = /\.(\d+)$/.exec(input)?.[1]?.length ?? 0;
  if (decimalPlaces > XLSX_NUMBER_DECIMAL_PLACES) return null;
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
