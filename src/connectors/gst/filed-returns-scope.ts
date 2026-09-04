import type { FiledReturnsDownloadScope } from "./filed-returns-contracts";
import {
  isFiledReturnsArtifactType,
  normaliseFiledReturnsArtifactType,
  supportsFiledReturnsArtifactType,
} from "./filed-returns-artifacts";
import {
  isFiledReturnsReturnType,
  supportsFullFiscalYearFiledReturnsRun,
  type FiledReturnsReturnType,
} from "./filed-returns-return-types";

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

export function isFiledReturnsFinancialYear(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const match = /^20(\d{2})-(\d{2})$/.exec(input);
  return Boolean(match && Number(match[2]) === (Number(match[1]) + 1) % 100);
}

export interface FiledReturnsPeriodOption {
  value: FiledReturnsMonth;
  label: string;
}

export interface FiledReturnsScopePeriodOption {
  value: FiledReturnsScopePeriod;
  label: string;
}

export interface FiledReturnsFilingPeriod {
  financialYear: string;
  period: FiledReturnsMonth;
}

export function compareFiledReturnsFilingPeriods(
  left: FiledReturnsFilingPeriod,
  right: FiledReturnsFilingPeriod,
): number {
  const leftCalendar = getFiledReturnsPeriodCalendarMonth(
    parseFinancialYearStartYearOrThrow(left.financialYear),
    left.period,
  );
  const rightCalendar = getFiledReturnsPeriodCalendarMonth(
    parseFinancialYearStartYearOrThrow(right.financialYear),
    right.period,
  );
  return (
    leftCalendar.year - rightCalendar.year || leftCalendar.monthIndex - rightCalendar.monthIndex
  );
}

export const DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE: FiledReturnsDownloadScope = {
  ...getDefaultFiledReturnsPeriodScope(),
  returnType: "GSTR-3B",
  artifactType: "PDF",
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
  returnType: FiledReturnsReturnType = "GSTR-3B",
): FiledReturnsPeriodOption[] {
  return getFiledReturnsPeriods(financialYear, asOf, returnType).map((month) => ({
    value: month,
    label: month,
  }));
}

export function getFiledReturnsScopePeriodOptions(
  financialYear: string,
  asOf = new Date(),
  returnType: FiledReturnsReturnType = "GSTR-3B",
): FiledReturnsScopePeriodOption[] {
  const periodOptions = getFiledReturnsPeriodOptions(financialYear, asOf, returnType);
  if (periodOptions.length === 0) return [];
  if (!supportsFullFiscalYearFiledReturnsRun(returnType)) return periodOptions;
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
  returnType: FiledReturnsReturnType = "GSTR-3B",
): FiledReturnsMonth[] {
  return getFiledReturnsPeriods(financialYear, asOf, returnType);
}

export function normaliseFiledReturnsScope(
  scope: FiledReturnsDownloadScope,
  asOf = new Date(),
): FiledReturnsDownloadScope {
  const returnType = isFiledReturnsReturnType(scope.returnType) ? scope.returnType : "GSTR-3B";
  const financialYearOptions = getFiledReturnsFinancialYearOptions(asOf);
  const requestedFinancialYear = financialYearOptions.includes(scope.financialYear)
    ? scope.financialYear
    : financialYearOptions[0];
  const financialYear =
    requestedFinancialYear &&
    getFiledReturnsPeriodOptions(requestedFinancialYear, asOf, returnType).length > 0
      ? requestedFinancialYear
      : (financialYearOptions.find(
          (candidate) => getFiledReturnsPeriodOptions(candidate, asOf, returnType).length > 0,
        ) ?? GST_LAUNCH_FINANCIAL_YEAR);
  const periodOptions = getFiledReturnsPeriodOptions(financialYear, asOf, returnType);
  const period =
    isFullFiscalYearScope(scope) && supportsFullFiscalYearFiledReturnsRun(returnType)
      ? FULL_FISCAL_YEAR_PERIOD
      : periodOptions.some((option) => option.value === scope.period)
        ? scope.period
        : defaultPeriodForFinancialYear(financialYear, asOf, returnType);

  return {
    financialYear,
    period,
    returnType,
    artifactType: normaliseFiledReturnsArtifactType(returnType, scope.artifactType),
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
  if (!isFiledReturnsReturnType(input.returnType)) return false;
  if (!isSupportedArtifactSelection(input)) return false;
  if (!getFiledReturnsFinancialYearOptions(asOf).includes(input.financialYear)) return false;
  return getFiledReturnsPeriodOptions(input.financialYear, asOf, input.returnType).some(
    (option) => option.value === input.period,
  );
}

export function isSupportedFiledReturnsStartScope(
  input: FiledReturnsDownloadScope,
  asOf = new Date(),
): boolean {
  if (!isFiledReturnsReturnType(input.returnType)) return false;
  if (!isSupportedArtifactSelection(input)) return false;
  if (!getFiledReturnsFinancialYearOptions(asOf).includes(input.financialYear)) return false;
  if (isFullFiscalYearScope(input)) {
    return (
      supportsFullFiscalYearFiledReturnsRun(input.returnType) &&
      getFiledReturnsFullFiscalYearPeriods(input.financialYear, asOf, input.returnType).length > 0
    );
  }
  return isSupportedFiledReturnsScope(input, asOf);
}

function isSupportedArtifactSelection(input: FiledReturnsDownloadScope): boolean {
  const artifactType = input.artifactType ?? "PDF";
  return (
    isFiledReturnsArtifactType(artifactType) &&
    supportsFiledReturnsArtifactType(input.returnType, artifactType)
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

function defaultPeriodForFinancialYear(
  financialYear: string,
  asOf = new Date(),
  returnType: FiledReturnsReturnType = "GSTR-3B",
): FiledReturnsMonth {
  const firstMonth = getFiledReturnsPeriodOptions(financialYear, asOf, returnType)[0];
  return firstMonth?.value ?? GST_LAUNCH_MONTH;
}

function getIndianDateParts(asOf: Date): { year: number; monthIndex: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).formatToParts(asOf);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return { year, monthIndex: month - 1, day };
}

function formatFinancialYear(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function getFiledReturnsPeriods(
  financialYear: string,
  asOf: Date,
  returnType: FiledReturnsReturnType,
): FiledReturnsMonth[] {
  const financialYearStart = parseFinancialYearStartYear(financialYear);
  if (financialYearStart === null) return [];

  const launchScopedMonths =
    financialYear === GST_LAUNCH_FINANCIAL_YEAR
      ? FILED_RETURNS_MONTHS.slice(FILED_RETURNS_MONTHS.indexOf(GST_LAUNCH_MONTH))
      : [...FILED_RETURNS_MONTHS];

  if (financialYearStart !== getIndianFinancialYearStartYear(asOf)) return launchScopedMonths;

  return launchScopedMonths.filter((month) =>
    isFiledReturnPeriodEligible(
      getFiledReturnsPeriodCalendarMonth(financialYearStart, month),
      asOf,
      returnType,
    ),
  );
}

/**
 * Pack does not know whether the signed-in taxpayer files monthly or under QRMP.
 * Verified 2026-09-04 against the GST Portal Returns FAQs: GSTR-1 Q10 gives the
 * 11th monthly and 13th post-quarterly dates; GSTR-2B Q4 gives the 14th monthly
 * and post-quarterly generation date; GSTR-3B Q4 gives the 20th monthly and
 * 22nd/24th post-quarterly dates. Use the later QRMP cut-off for each return type
 * so the planner does not offer a period before it can be due for that frequency.
 */
function isFiledReturnPeriodEligible(
  periodCalendar: { year: number; monthIndex: number },
  asOf: Date,
  returnType: FiledReturnsReturnType,
): boolean {
  const cutoff = conservativeFilingCutoff(periodCalendar, returnType);
  const today = getIndianDateParts(asOf);
  if (today.year !== cutoff.year) return today.year > cutoff.year;
  if (today.monthIndex !== cutoff.monthIndex) return today.monthIndex > cutoff.monthIndex;
  return today.day >= cutoff.day;
}

function conservativeFilingCutoff(
  periodCalendar: { year: number; monthIndex: number },
  returnType: FiledReturnsReturnType,
): { year: number; monthIndex: number; day: number } {
  const quarterEndMonthIndex = Math.floor(periodCalendar.monthIndex / 3) * 3 + 2;
  const firstFollowingMonthIndex = (quarterEndMonthIndex + 1) % 12;
  const firstFollowingMonthYear = periodCalendar.year + (quarterEndMonthIndex === 11 ? 1 : 0);
  const day = returnType === "GSTR-1" ? 13 : returnType === "GSTR-2B" ? 14 : 24;
  return { year: firstFollowingMonthYear, monthIndex: firstFollowingMonthIndex, day };
}

function parseFinancialYearStartYear(financialYear: string): number | null {
  const match = /^(20\d{2})-\d{2}$/.exec(financialYear);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function parseFinancialYearStartYearOrThrow(financialYear: string): number {
  const startYear = parseFinancialYearStartYear(financialYear);
  if (startYear === null) throw new TypeError("Invalid filed-return financial year.");
  return startYear;
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
