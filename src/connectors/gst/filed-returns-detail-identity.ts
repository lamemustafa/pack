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
  const text = getDetailIdentityText(documentRef);
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
  const periodPattern = TAX_PERIODS.map((period) => period.toLowerCase()).join("|");
  const match = new RegExp(
    `\\breturn\\s+period\\b\\s*(?:[-:]\\s*)?(${periodPattern})\\b`,
    "i",
  ).exec(normaliseText(text));
  if (!match?.[1]) return null;
  return TAX_PERIODS.find((period) => normaliseText(period) === match[1]) ?? null;
}

function extractDetailFinancialYear(text: string): string | null {
  const normalised = normaliseText(text);
  return (
    /\b(?:financial\s+year|fy)\b\s*(?:[-:]\s*)?(20\d{2}-\d{2})\b/i.exec(normalised)?.[1] ?? null
  );
}

function getDetailIdentityText(documentRef: Document): string {
  const downloadControl = findFiledGstr3bDownloadControl(documentRef);
  const scopedRoot = downloadControl ? findDetailIdentityRoot(downloadControl) : null;
  return readElementText(scopedRoot ?? documentRef.body);
}

function findFiledGstr3bDownloadControl(documentRef: Document): HTMLElement | null {
  const elements = Array.from(
    documentRef.querySelectorAll("button,a,[role='button'],input,[aria-label],[title]"),
  ).filter((element): element is HTMLElement => isHtmlElement(documentRef, element));

  return (
    elements.find((element) =>
      /\bdownload\s+filed\s+gstr[\s-]?3b\b/i.test(readElementText(element)),
    ) ?? null
  );
}

function findDetailIdentityRoot(downloadControl: HTMLElement): HTMLElement | null {
  let current = downloadControl.parentElement;
  while (current && current !== downloadControl.ownerDocument.body) {
    const text = readElementText(current);
    if (/\breturn\s+period\b/i.test(text) && /\b(?:financial\s+year|fy)\b/i.test(text)) {
      return current;
    }
    current = current.parentElement;
  }
  return downloadControl.ownerDocument.body;
}

function readElementText(element: Element | null | undefined): string {
  if (!element) return "";
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  return [
    "innerText" in element ? (element as HTMLElement).innerText : "",
    element.textContent ?? "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function isHtmlElement(documentRef: Document, element: Element): element is HTMLElement {
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}
