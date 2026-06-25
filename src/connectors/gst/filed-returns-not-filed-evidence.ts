import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import { matchesAcceptedText } from "./filed-returns-dom";

export function detectPositiveNotFiledEvidence(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): PortalFlowStepResult | null {
  const bodyText = documentRef.body?.innerText || documentRef.body?.textContent || "";
  if (
    !/\bno\s+records?\s+found\b|\bno\s+data\s+found\b|\bno\s+results?\s+found\b/i.test(bodyText)
  ) {
    return null;
  }
  if (!filterFormMatchesScope(documentRef, scope)) return null;

  return {
    connectorId: "gst",
    scopeId,
    state: "candidate-not-found",
    safeSignals: ["filed-return-positively-not-filed"],
    safeMessage:
      "Pack found a settled GST Portal no-records result for the selected GSTR-3B period.",
  };
}

function filterFormMatchesScope(documentRef: Document, scope: FiledReturnsDownloadScope): boolean {
  return (
    selectMatches(documentRef, "#finYr", [scope.financialYear]) &&
    selectMatches(documentRef, "#optValue", ["Monthly", scope.period]) &&
    optionalSelectMatches(documentRef, "#month", [scope.period]) &&
    selectMatches(documentRef, "#retTyp", [scope.returnType])
  );
}

function optionalSelectMatches(
  documentRef: Document,
  selector: string,
  acceptedTexts: readonly string[],
): boolean {
  return documentRef.querySelector(selector)
    ? selectMatches(documentRef, selector, acceptedTexts)
    : true;
}

function selectMatches(
  documentRef: Document,
  selector: string,
  acceptedTexts: readonly string[],
): boolean {
  const HTMLSelectElementConstructor = documentRef.defaultView?.HTMLSelectElement;
  const select = documentRef.querySelector(selector);
  if (!HTMLSelectElementConstructor || !(select instanceof HTMLSelectElementConstructor)) {
    return false;
  }
  const selectedText = readElementText(select.selectedOptions[0]) || select.value;
  return matchesAcceptedText(selectedText, acceptedTexts);
}

function readElementText(element: Element | null | undefined): string {
  if (!element) return "";
  return [
    "innerText" in element ? (element as HTMLElement).innerText : "",
    element.textContent ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
