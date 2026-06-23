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

export type FiledReturnsMonth = (typeof FILED_RETURNS_MONTHS)[number];

export interface FiledReturnsPeriodOption {
  value: "ALL" | FiledReturnsMonth;
  label: string;
}

export const DEFAULT_FILED_RETURNS_DOWNLOAD_SCOPE: FiledReturnsDownloadScope = {
  financialYear: getCurrentIndianFinancialYear(),
  period: "ALL",
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
    { value: "ALL", label: "Entire financial year" },
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
    : "ALL";

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

function getCurrentIndianFinancialYear(): string {
  return formatFinancialYear(getIndianFinancialYearStartYear(new Date()));
}

function getIndianFinancialYearStartYear(asOf: Date): number {
  const month = asOf.getMonth();
  return month >= 3 ? asOf.getFullYear() : asOf.getFullYear() - 1;
}

function formatFinancialYear(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
