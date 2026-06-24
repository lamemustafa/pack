import { normaliseText } from "./filed-returns-dom";

const TAX_PERIODS = [
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
];

export interface FiledReturnsDetailIdentity {
  financialYear: string | null;
  period: string | null;
  safeSignals: string[];
}

export function extractFiledReturnsDetailIdentity(
  documentRef: Document,
): FiledReturnsDetailIdentity {
  const text = documentRef.body?.innerText ?? documentRef.body?.textContent ?? "";
  const period = extractDetailTaxPeriod(text);
  const financialYear = extractDetailFinancialYear(text);
  return {
    financialYear,
    period,
    safeSignals: [
      ...(period ? [`filed-return-detail-period:${period}`] : []),
      ...(financialYear ? [`filed-return-detail-financial-year:${financialYear}`] : []),
    ],
  };
}

export function extractTaxPeriodFromRow(row: Element): string | null {
  const cells = Array.from(row.querySelectorAll("td"));
  const periodCell = cells[2];
  const periodText = normaliseText(periodCell?.textContent || "");
  return TAX_PERIODS.find((period) => normaliseText(period) === periodText) ?? null;
}

function extractDetailTaxPeriod(text: string): string | null {
  const match = /return period\s*-\s*([a-z]+)/i.exec(normaliseText(text));
  if (!match?.[1]) return null;
  return TAX_PERIODS.find((period) => normaliseText(period) === match[1]) ?? null;
}

function extractDetailFinancialYear(text: string): string | null {
  const normalised = normaliseText(text);
  return /\b(?:financial year|fy)\s*-\s*(20\d{2}-\d{2})\b/i.exec(normalised)?.[1] ?? null;
}
