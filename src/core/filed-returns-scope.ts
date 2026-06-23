import type { FiledReturnsDownloadScope } from "./contracts";

export const GST_LAUNCH_FINANCIAL_YEAR = "2017-18";
export const GST_LAUNCH_MONTH = "July";
export const FILED_RETURNS_MONTHS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
] as const;
const CALENDAR_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type FiledReturnsMonth = (typeof FILED_RETURNS_MONTHS)[number];

export interface FiledReturnsPeriodOption {
  value: "ALL" | FiledReturnsMonth;
  label: string;
}

export const DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE: FiledReturnsDownloadScope = {
  ...getDefaultFiledReturnsPeriodScope(),
  returnType: "GSTR-3B",
};

export function getFiledReturnsFinancialYearOptions(asOf = new Date()): string[] {
  const currentStartYear = getIndianFinancialYearStartYear(asOf);
  const years: string[] = [];
  for (let year = currentStartYear; year >= 2017; year -= 1) {
    years.push(formatFinancialYear(year));
  }
  return years;
}

export function getFiledReturnsPeriodOptions(financialYear: string): FiledReturnsPeriodOption[] {
  const months =
    financialYear === GST_LAUNCH_FINANCIAL_YEAR
      ? FILED_RETURNS_MONTHS.slice(FILED_RETURNS_MONTHS.indexOf(GST_LAUNCH_MONTH))
      : FILED_RETURNS_MONTHS;

  return [
    { value: "ALL", label: "All currently available filed returns" },
    ...months.map((month) => ({ value: month, label: month })),
  ];
}

export function normaliseFiledReturnsScope(
  scope: FiledReturnsDownloadScope,
): FiledReturnsDownloadScope {
  const [firstFinancialYear] = getFiledReturnsFinancialYearOptions();
  const financialYear = getFiledReturnsFinancialYearOptions().includes(scope.financialYear)
    ? scope.financialYear
    : (firstFinancialYear ?? GST_LAUNCH_FINANCIAL_YEAR);
  const period = getFiledReturnsPeriodOptions(financialYear).some(
    (option) => option.value === scope.period,
  )
    ? scope.period
    : defaultPeriodForFinancialYear(financialYear);

  return {
    financialYear,
    period,
    returnType: "GSTR-3B",
    ...(scope.completedPeriods ? { completedPeriods: scope.completedPeriods } : {}),
  };
}

export function isSupportedFiledReturnsScope(input: FiledReturnsDownloadScope): boolean {
  if (input.returnType !== "GSTR-3B") return false;
  if (!getFiledReturnsFinancialYearOptions().includes(input.financialYear)) return false;
  return getFiledReturnsPeriodOptions(input.financialYear).some(
    (option) => option.value === input.period,
  );
}

function getDefaultFiledReturnsPeriodScope(asOf = new Date()): {
  financialYear: string;
  period: FiledReturnsMonth;
} {
  const { year, monthIndex } = getIndianDateParts(asOf);
  const previousMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1;
  const previousMonthYear = monthIndex === 0 ? year - 1 : year;
  return {
    financialYear: formatFinancialYear(
      getFinancialYearStartYear(previousMonthYear, previousMonthIndex),
    ),
    period: CALENDAR_MONTHS[previousMonthIndex] as FiledReturnsMonth,
  };
}

function getIndianFinancialYearStartYear(asOf: Date): number {
  const { year, monthIndex } = getIndianDateParts(asOf);
  return getFinancialYearStartYear(year, monthIndex);
}

function getFinancialYearStartYear(year: number, monthIndex: number): number {
  return monthIndex >= 3 ? year : year - 1;
}

function defaultPeriodForFinancialYear(financialYear: string): FiledReturnsMonth {
  const firstMonth = getFiledReturnsPeriodOptions(financialYear).find(
    (option): option is FiledReturnsPeriodOption & { value: FiledReturnsMonth } =>
      option.value !== "ALL",
  );
  return firstMonth?.value ?? GST_LAUNCH_MONTH;
}

function getIndianDateParts(asOf: Date): { year: number; monthIndex: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).formatToParts(asOf);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, monthIndex: month - 1 };
}

function formatFinancialYear(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
