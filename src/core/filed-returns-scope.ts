import type { FiledReturnsDownloadScope } from "./contracts";

export const GST_LAUNCH_FINANCIAL_YEAR = "2017-18";
export const GST_LAUNCH_MONTH = "July";
export const FULL_FISCAL_YEAR_PERIOD = "FULL_FISCAL_YEAR";
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
export type FiledReturnsScopePeriod = FiledReturnsMonth | typeof FULL_FISCAL_YEAR_PERIOD;

export interface FiledReturnsPeriodOption {
  value: FiledReturnsMonth;
  label: string;
}

export interface FiledReturnsScopePeriodOption {
  value: FiledReturnsScopePeriod;
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

export function getFiledReturnsPeriodOptions(
  financialYear: string,
  asOf = new Date(),
): FiledReturnsPeriodOption[] {
  return getFiledReturnsPeriods(financialYear, asOf).map((month) => ({
    value: month,
    label: month,
  }));
}

export function getFiledReturnsScopePeriodOptions(
  financialYear: string,
  asOf = new Date(),
): FiledReturnsScopePeriodOption[] {
  const periodOptions = getFiledReturnsPeriodOptions(financialYear, asOf);
  if (periodOptions.length === 0) return [];
  return [
    {
      value: FULL_FISCAL_YEAR_PERIOD,
      label: "Full fiscal year",
    },
    ...periodOptions,
  ];
}

export function getFiledReturnsFullFiscalYearPeriods(
  financialYear: string,
  asOf = new Date(),
): FiledReturnsMonth[] {
  return getFiledReturnsPeriods(financialYear, asOf);
}

export function normaliseFiledReturnsScope(
  scope: FiledReturnsDownloadScope,
  asOf = new Date(),
): FiledReturnsDownloadScope {
  const financialYearOptions = getFiledReturnsFinancialYearOptions(asOf);
  const requestedFinancialYear = financialYearOptions.includes(scope.financialYear)
    ? scope.financialYear
    : financialYearOptions[0];
  const financialYear =
    requestedFinancialYear && getFiledReturnsPeriodOptions(requestedFinancialYear, asOf).length > 0
      ? requestedFinancialYear
      : (financialYearOptions.find(
          (candidate) => getFiledReturnsPeriodOptions(candidate, asOf).length > 0,
        ) ?? GST_LAUNCH_FINANCIAL_YEAR);
  const periodOptions = getFiledReturnsPeriodOptions(financialYear, asOf);
  const period = isFullFiscalYearScope(scope)
    ? FULL_FISCAL_YEAR_PERIOD
    : periodOptions.some((option) => option.value === scope.period)
      ? scope.period
      : defaultPeriodForFinancialYear(financialYear, asOf);

  return {
    financialYear,
    period,
    returnType: "GSTR-3B",
    ...(scope.completedPeriods ? { completedPeriods: scope.completedPeriods } : {}),
  };
}

export function isFullFiscalYearScope(input: Pick<FiledReturnsDownloadScope, "period">): boolean {
  return input.period === FULL_FISCAL_YEAR_PERIOD;
}

export function isSupportedFiledReturnsScope(
  input: FiledReturnsDownloadScope,
  asOf = new Date(),
): boolean {
  if (input.returnType !== "GSTR-3B") return false;
  if (!getFiledReturnsFinancialYearOptions(asOf).includes(input.financialYear)) return false;
  return getFiledReturnsPeriodOptions(input.financialYear, asOf).some(
    (option) => option.value === input.period,
  );
}

export function isSupportedFiledReturnsStartScope(
  input: FiledReturnsDownloadScope,
  asOf = new Date(),
): boolean {
  if (input.returnType !== "GSTR-3B") return false;
  if (!getFiledReturnsFinancialYearOptions(asOf).includes(input.financialYear)) return false;
  if (isFullFiscalYearScope(input)) {
    return getFiledReturnsFullFiscalYearPeriods(input.financialYear, asOf).length > 0;
  }
  return isSupportedFiledReturnsScope(input, asOf);
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

function defaultPeriodForFinancialYear(
  financialYear: string,
  asOf = new Date(),
): FiledReturnsMonth {
  const firstMonth = getFiledReturnsPeriodOptions(financialYear, asOf)[0];
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

function getFiledReturnsPeriods(financialYear: string, asOf: Date): FiledReturnsMonth[] {
  const financialYearStart = parseFinancialYearStartYear(financialYear);
  if (financialYearStart === null) return [];

  const launchScopedMonths =
    financialYear === GST_LAUNCH_FINANCIAL_YEAR
      ? FILED_RETURNS_MONTHS.slice(FILED_RETURNS_MONTHS.indexOf(GST_LAUNCH_MONTH))
      : [...FILED_RETURNS_MONTHS];

  if (financialYearStart !== getIndianFinancialYearStartYear(asOf)) return launchScopedMonths;

  const previousMonth = getPreviousCompletedCalendarMonth(asOf);
  return launchScopedMonths.filter((month) => {
    const periodCalendar = getFiledReturnsPeriodCalendarMonth(financialYearStart, month);
    if (periodCalendar.year < previousMonth.year) return true;
    if (periodCalendar.year > previousMonth.year) return false;
    return periodCalendar.monthIndex <= previousMonth.monthIndex;
  });
}

function parseFinancialYearStartYear(financialYear: string): number | null {
  const match = /^(20\d{2})-\d{2}$/.exec(financialYear);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function getPreviousCompletedCalendarMonth(asOf: Date): { year: number; monthIndex: number } {
  const { year, monthIndex } = getIndianDateParts(asOf);
  if (monthIndex === 0) return { year: year - 1, monthIndex: 11 };
  return { year, monthIndex: monthIndex - 1 };
}

function getFiledReturnsPeriodCalendarMonth(
  financialYearStart: number,
  month: FiledReturnsMonth,
): { year: number; monthIndex: number } {
  const monthIndex = CALENDAR_MONTHS.indexOf(month);
  return {
    year: monthIndex >= 3 ? financialYearStart : financialYearStart + 1,
    monthIndex,
  };
}
