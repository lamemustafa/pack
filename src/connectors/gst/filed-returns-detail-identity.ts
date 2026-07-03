import type { FiledReturnsReturnType } from "../../core/filed-returns-return-types";
import { normaliseText } from "./filed-returns-dom";
import { canonicalFiledReturnsMonth } from "./filed-returns-months";
import { filedReturnDescriptor } from "./filed-returns-return-descriptors";

export interface FiledReturnsDetailIdentity {
  financialYear: string | null;
  period: string | null;
  returnType: FiledReturnsReturnType | null;
  safeSignals: string[];
}

export function extractFiledReturnsDetailIdentity(
  documentRef: Document,
  returnType?: FiledReturnsReturnType,
): FiledReturnsDetailIdentity {
  const text = getDetailIdentityText(documentRef, returnType);
  const period = extractDetailTaxPeriod(text);
  const financialYear = extractDetailFinancialYear(text);
  const detectedReturnType = extractDetailReturnType(
    text,
    returnType,
    documentRef.defaultView?.location.pathname,
  );
  return {
    financialYear,
    period,
    returnType: detectedReturnType,
    safeSignals: [
      ...(period ? [`filed-return-detail-period:${period}`] : []),
      ...(financialYear ? [`filed-return-detail-financial-year:${financialYear}`] : []),
      ...(detectedReturnType ? [`filed-return-detail-type:${detectedReturnType}`] : []),
    ],
  };
}

export function extractTaxPeriodFromRow(row: Element): string | null {
  const cells = Array.from(row.querySelectorAll("td"));
  const periodCell = cells[2];
  const periodText = normaliseText(periodCell?.textContent || "");
  return canonicalFiledReturnsMonth(periodText);
}

function extractDetailTaxPeriod(text: string): string | null {
  const match = new RegExp(
    "\\b(?:(?:return|tax)\\s*period|month)\\b\\s*(?:[-:]\\s*)?([a-z]+)\\b",
    "i",
  ).exec(normaliseText(text));
  if (!match?.[1]) return null;
  return canonicalFiledReturnsMonth(match[1]);
}

function extractDetailFinancialYear(text: string): string | null {
  const normalised = normaliseText(text);
  const match =
    /\b(?:financial\s*year|fy)\b\s*(?:[-:]\s*)?(20\d{2})(?:\s*[-/]\s*(\d{2}|\d{4})|\s+(\d{2})|(\d{2}))\b/i.exec(
      normalised,
    );
  if (!match?.[1]) return null;

  const startYear = Number(match[1]);
  const endYearText = match[2] ?? match[3] ?? match[4];
  if (!endYearText) return null;
  const endYear = endYearText.length === 4 ? Number(endYearText.slice(2)) : Number(endYearText);
  if (endYear !== (startYear + 1) % 100) return null;
  return `${match[1]}-${String(endYear).padStart(2, "0")}`;
}

function extractDetailReturnType(
  text: string,
  returnType?: FiledReturnsReturnType,
  pathname?: string,
): FiledReturnsReturnType | null {
  if (returnType && filedReturnDescriptor(returnType).detailRoutePattern.test(pathname ?? "")) {
    return returnType;
  }
  if (returnType && filedReturnDescriptor(returnType).detailHeadingPattern.test(text)) {
    return returnType;
  }
  if (/\bgstr[\s-]?3b\b/i.test(text)) return "GSTR-3B";
  if (/\bgstr[\s-]?1\b/i.test(text)) return "GSTR-1";
  return null;
}

function getDetailIdentityText(documentRef: Document, returnType?: FiledReturnsReturnType): string {
  const downloadControl = findFiledReturnDownloadControl(documentRef, returnType);
  const scopedRoot = downloadControl ? findDetailIdentityRoot(downloadControl) : null;
  return readElementText(scopedRoot ?? documentRef.body);
}

function findFiledReturnDownloadControl(
  documentRef: Document,
  returnType?: FiledReturnsReturnType,
): HTMLElement | null {
  const elements = Array.from(
    documentRef.querySelectorAll("button,a,[role='button'],input,[aria-label],[title]"),
  ).filter((element): element is HTMLElement => isHtmlElement(documentRef, element));

  if (returnType) {
    const descriptor = filedReturnDescriptor(returnType);
    return (
      elements.find((element) =>
        descriptor.explicitDownloadPattern.test(readElementText(element)),
      ) ??
      elements.find(
        (element) => descriptor.secondaryDownloadPattern?.test(readElementText(element)) ?? false,
      ) ??
      elements.find(
        (element) => descriptor.excelDownloadPattern?.test(readElementText(element)) ?? false,
      ) ??
      null
    );
  }

  return (
    elements.find((element) =>
      /\bdownload\s+filed\s+gstr[\s-]?(?:3b|1)\b/i.test(readElementText(element)),
    ) ?? null
  );
}

function findDetailIdentityRoot(downloadControl: HTMLElement): HTMLElement | null {
  let current = downloadControl.parentElement;
  while (current && current !== downloadControl.ownerDocument.body) {
    const text = readElementText(current);
    if (
      /\b(?:(?:return|tax)\s+period|month)\b/i.test(text) &&
      /\b(?:financial\s+year|fy)\b/i.test(text)
    ) {
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
  const seenTexts = new Set<string>();
  return [
    "innerText" in element ? (element as HTMLElement).innerText : "",
    element.textContent ?? "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ]
    .filter((text) => {
      const comparable = normaliseText(text);
      if (!comparable || seenTexts.has(comparable)) return false;
      seenTexts.add(comparable);
      return true;
    })
    .join(" ");
}

function isHtmlElement(documentRef: Document, element: Element): element is HTMLElement {
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}
