import { canonicalFiledReturnsMonth } from "./filed-returns-months";

const MONTH_NUMBER_BY_NAME: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

export function toPortalReturnPeriod(period: string, financialYear: string): string | null {
  const canonicalPeriod = canonicalFiledReturnsMonth(period);
  const month = canonicalPeriod ? MONTH_NUMBER_BY_NAME[canonicalPeriod] : undefined;
  const yearMatch = /^(20\d{2})-(\d{2})$/.exec(financialYear);
  if (!month || !yearMatch) return null;

  const startYear = yearMatch[1];
  const endYearSuffix = yearMatch[2];
  if (!startYear || !endYearSuffix) return null;

  const monthText = month < 10 ? `0${month}` : String(month);
  const yearText = month < 4 ? `${startYear.slice(0, 2)}${endYearSuffix}` : startYear;
  return `${monthText}${yearText}`;
}
