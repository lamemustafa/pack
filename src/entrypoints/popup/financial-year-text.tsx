/**
 * "FY <year>" as one unbreakable unit, so a narrow panel never splits the year at its hyphen.
 * The one place a surface formats a financial year for display; keep it the only one.
 */
export function FinancialYearText({ financialYear }: { financialYear: string }) {
  return <span className="panel-fy">{`FY ${financialYear}`}</span>;
}
