import type { FiledReturnsDownloadScope } from "./contracts";
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
export const GSTR2B_FIRST_FINANCIAL_YEAR = "2020-21";
export const GSTR2B_FIRST_MONTH = "July";
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
  artifactType: "PDF",
};

export function getFiledReturnsFinancialYearOptions(
  asOf = new Date(),
  returnType: FiledReturnsReturnType = "GSTR-3B",
): string[] {
  const currentStartYear = getIndianFinancialYearStartYear(asOf);
  const firstStartYear = availabilityFloor(returnType).financialYearStart;
  const years: string[] = [];
  for (let year = currentStartYear; year >= firstStartYear; year -= 1) {
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

export function getFiledReturnsRangePeriods(
  scope: Pick<
    FiledReturnsDownloadScope,
    "financialYear" | "period" | "rangeEndPeriod" | "returnType"
  >,
  asOf = new Date(),
): FiledReturnsMonth[] {
  if (!isCustomFiledReturnsRangeScope(scope)) return [];
  const availablePeriods = getFiledReturnsPeriodOptions(
    scope.financialYear,
    asOf,
    scope.returnType,
  ).map((option) => option.value);
  const startIndex = availablePeriods.indexOf(scope.period as FiledReturnsMonth);
  const endIndex = availablePeriods.indexOf(scope.rangeEndPeriod as FiledReturnsMonth);
  return startIndex >= 0 && endIndex > startIndex
    ? availablePeriods.slice(startIndex, endIndex + 1)
    : [];
}

export function getFiledReturnsRunPeriods(
  scope: FiledReturnsDownloadScope,
  asOf = new Date(),
): FiledReturnsMonth[] {
  if (isFullFiscalYearScope(scope))
    return getFiledReturnsFullFiscalYearPeriods(scope.financialYear, asOf, scope.returnType);
  if (isCustomFiledReturnsRangeScope(scope)) return getFiledReturnsRangePeriods(scope, asOf);
  return [];
}

export function normaliseFiledReturnsScope(
  scope: FiledReturnsDownloadScope,
  asOf = new Date(),
): FiledReturnsDownloadScope {
  const returnType = isFiledReturnsReturnType(scope.returnType) ? scope.returnType : "GSTR-3B";
  const financialYearOptions = getFiledReturnsFinancialYearOptions(asOf, returnType);
  const floorFinancialYear = formatFinancialYear(availabilityFloor(returnType).financialYearStart);
  const requestedFinancialYearStart = parseFinancialYearStartYear(scope.financialYear);
  const requestedFinancialYear = financialYearOptions.includes(scope.financialYear)
    ? scope.financialYear
    : requestedFinancialYearStart !== null &&
        requestedFinancialYearStart < availabilityFloor(returnType).financialYearStart
      ? floorFinancialYear
      : financialYearOptions[0];
  const financialYear =
    requestedFinancialYear &&
    getFiledReturnsPeriodOptions(requestedFinancialYear, asOf, returnType).length > 0
      ? requestedFinancialYear
      : (financialYearOptions.find(
          (candidate) => getFiledReturnsPeriodOptions(candidate, asOf, returnType).length > 0,
        ) ?? floorFinancialYear);
  const periodOptions = getFiledReturnsPeriodOptions(financialYear, asOf, returnType);
  const period =
    isFullFiscalYearScope(scope) && supportsFullFiscalYearFiledReturnsRun(returnType)
      ? FULL_FISCAL_YEAR_PERIOD
      : periodOptions.some((option) => option.value === scope.period)
        ? scope.period
        : defaultPeriodForFinancialYear(financialYear, asOf, returnType);

  const rangeEndPeriod = normaliseRangeEndPeriod(scope, periodOptions, period);
  return {
    financialYear,
    period,
    returnType,
    artifactType: normaliseFiledReturnsArtifactType(returnType, scope.artifactType),
    ...(rangeEndPeriod ? { rangeEndPeriod } : {}),
    ...(scope.completedPeriods ? { completedPeriods: scope.completedPeriods } : {}),
  };
}

export function isFullFiscalYearScope(input: Pick<FiledReturnsDownloadScope, "period">): boolean {
  return input.period === FULL_FISCAL_YEAR_PERIOD;
}

export function isCustomFiledReturnsRangeScope(
  input: Pick<FiledReturnsDownloadScope, "period" | "rangeEndPeriod">,
): input is Pick<FiledReturnsDownloadScope, "period" | "rangeEndPeriod"> & {
  rangeEndPeriod: string;
} {
  return (
    input.period !== FULL_FISCAL_YEAR_PERIOD &&
    typeof input.rangeEndPeriod === "string" &&
    input.rangeEndPeriod !== input.period
  );
}

export function isMultiPeriodFiledReturnsScope(
  input: Pick<FiledReturnsDownloadScope, "period" | "rangeEndPeriod">,
): boolean {
  return isFullFiscalYearScope(input) || isCustomFiledReturnsRangeScope(input);
}

/**
 * Return-type history floors are planning bounds only. They do not assert that
 * the GST Portal has an artifact for an otherwise eligible period.
 */
export function isWithinFiledReturnsAvailabilityFloor(
  input: Pick<FiledReturnsDownloadScope, "financialYear" | "period" | "returnType">,
): boolean {
  const financialYearStart = parseFinancialYearStartYear(input.financialYear);
  if (financialYearStart === null) return false;
  const floor = availabilityFloor(input.returnType);
  if (financialYearStart < floor.financialYearStart) return false;
  if (financialYearStart > floor.financialYearStart || isFullFiscalYearScope(input)) return true;
  return (
    typeof input.period === "string" &&
    FILED_RETURNS_MONTHS.indexOf(input.period as FiledReturnsMonth) >=
      FILED_RETURNS_MONTHS.indexOf(floor.firstMonth)
  );
}

export function isSupportedFiledReturnsScope(
  input: FiledReturnsDownloadScope,
  asOf = new Date(),
): boolean {
  if (!isFiledReturnsReturnType(input.returnType)) return false;
  if (!isSupportedArtifactSelection(input)) return false;
  if (!isWithinFiledReturnsAvailabilityFloor(input)) return false;
  if (!getFiledReturnsFinancialYearOptions(asOf, input.returnType).includes(input.financialYear))
    return false;
  const periodOptions = getFiledReturnsPeriodOptions(input.financialYear, asOf, input.returnType);
  const startIndex = periodOptions.findIndex((option) => option.value === input.period);
  if (startIndex < 0) return false;
  if (input.rangeEndPeriod === undefined) return true;
  const endIndex = periodOptions.findIndex((option) => option.value === input.rangeEndPeriod);
  return endIndex > startIndex;
}

export function isSupportedFiledReturnsStartScope(
  input: FiledReturnsDownloadScope,
  asOf = new Date(),
): boolean {
  if (!isFiledReturnsReturnType(input.returnType)) return false;
  if (!isSupportedArtifactSelection(input)) return false;
  if (!isWithinFiledReturnsAvailabilityFloor(input)) return false;
  if (!getFiledReturnsFinancialYearOptions(asOf, input.returnType).includes(input.financialYear))
    return false;
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

function normaliseRangeEndPeriod(
  scope: FiledReturnsDownloadScope,
  periodOptions: FiledReturnsPeriodOption[],
  period: string,
): FiledReturnsMonth | null {
  if (period === FULL_FISCAL_YEAR_PERIOD || typeof scope.rangeEndPeriod !== "string") return null;
  const startIndex = periodOptions.findIndex((option) => option.value === period);
  const endIndex = periodOptions.findIndex((option) => option.value === scope.rangeEndPeriod);
  return endIndex > startIndex ? (scope.rangeEndPeriod as FiledReturnsMonth) : null;
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
  return firstMonth?.value ?? availabilityFloor(returnType).firstMonth;
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

function getFiledReturnsPeriods(
  financialYear: string,
  asOf: Date,
  returnType: FiledReturnsReturnType,
): FiledReturnsMonth[] {
  const financialYearStart = parseFinancialYearStartYear(financialYear);
  if (financialYearStart === null) return [];
  const floor = availabilityFloor(returnType);
  if (financialYearStart < floor.financialYearStart) return [];

  const availabilityScopedMonths =
    financialYearStart === floor.financialYearStart
      ? FILED_RETURNS_MONTHS.slice(FILED_RETURNS_MONTHS.indexOf(floor.firstMonth))
      : [...FILED_RETURNS_MONTHS];

  if (financialYearStart !== getIndianFinancialYearStartYear(asOf)) return availabilityScopedMonths;

  const previousMonth = getPreviousCompletedCalendarMonth(asOf);
  return availabilityScopedMonths.filter((month) => {
    const periodCalendar = getFiledReturnsPeriodCalendarMonth(financialYearStart, month);
    if (periodCalendar.year < previousMonth.year) return true;
    if (periodCalendar.year > previousMonth.year) return false;
    return periodCalendar.monthIndex <= previousMonth.monthIndex;
  });
}

function availabilityFloor(returnType: FiledReturnsReturnType): {
  financialYearStart: number;
  firstMonth: FiledReturnsMonth;
} {
  if (returnType === "GSTR-2B") {
    return {
      financialYearStart: Number(GSTR2B_FIRST_FINANCIAL_YEAR.slice(0, 4)),
      firstMonth: GSTR2B_FIRST_MONTH,
    };
  }
  return {
    financialYearStart: Number(GST_LAUNCH_FINANCIAL_YEAR.slice(0, 4)),
    firstMonth: GST_LAUNCH_MONTH,
  };
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
