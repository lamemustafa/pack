import type { FiledReturnsDownloadScope, PortalFlowStepResult } from "../../core/contracts";
import { matchesAcceptedText, normaliseText } from "./filed-returns-dom";
import { extractTaxPeriodFromRow } from "./filed-returns-detail-identity";
import { filedReturnsFilterFieldMatches } from "./filed-returns-filter-fields";

export function detectPositiveNotFiledEvidence(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
  scopeId: string,
): PortalFlowStepResult | null {
  const resultsContainer = findSettledNoRecordResultsContainer(documentRef);
  if (!resultsContainer) return null;
  if (!filterFormMatchesScope(documentRef, scope)) return null;
  if (hasMatchingResultRow(documentRef, scope)) return null;

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
    filedReturnsFilterFieldMatches(documentRef, /financial\s+year/i, [scope.financialYear]) &&
    filedReturnsFilterFieldMatches(documentRef, /^return\s+filing\s+period\b|^period\b/i, [
      "Monthly",
      scope.period,
    ]) &&
    filedReturnsFilterFieldMatches(documentRef, /^month\b|^tax\s+period\b/i, [scope.period]) &&
    filedReturnsFilterFieldMatches(documentRef, /^return\s+type\b/i, [scope.returnType])
  );
}

function findSettledNoRecordResultsContainer(documentRef: Document): Element | null {
  const candidates = Array.from(documentRef.body?.querySelectorAll("*") ?? []).filter((element) =>
    hasNoRecordText(element),
  );

  for (const candidate of candidates) {
    if (isHidden(candidate)) continue;
    const container = findResultsContainer(candidate);
    if (!container || hasLoadingEvidence(container)) continue;
    return container;
  }

  return null;
}

function hasNoRecordText(element: Element): boolean {
  return /\bno\s+records?\s+found\b|\bno\s+data\s+found\b|\bno\s+results?\s+found\b/i.test(
    ownVisibleText(element),
  );
}

function findResultsContainer(element: Element): Element | null {
  return element.closest(
    [
      "[aria-label*='result' i]",
      "[id*='result' i]",
      "[class*='result' i]",
      "table",
      "tbody",
      "section",
      "article",
      "main",
    ].join(","),
  );
}

function hasLoadingEvidence(container: Element): boolean {
  if (container.getAttribute("aria-busy") === "true") return true;
  const text = visibleText(container);
  return /\bloading\b|\bplease\s+wait\b|\bsearching\b|\bprocessing\b/.test(normaliseText(text));
}

function hasMatchingResultRow(root: ParentNode, scope: FiledReturnsDownloadScope): boolean {
  return Array.from(root.querySelectorAll("tr")).some((row) => {
    const rowText = visibleText(row);
    const period = extractTaxPeriodFromRow(row) ?? rowText;
    return (
      matchesAcceptedText(rowText, [scope.returnType]) &&
      matchesAcceptedText(rowText, [scope.financialYear]) &&
      matchesAcceptedText(period, [scope.period]) &&
      /\bview\b|download/i.test(rowText)
    );
  });
}

function visibleText(root: Element): string {
  return Array.from(root.querySelectorAll("*"))
    .filter((element) => !isHidden(element))
    .map(ownVisibleText)
    .concat(ownVisibleText(root))
    .filter(Boolean)
    .join(" ");
}

function ownVisibleText(element: Element): string {
  if (isHidden(element)) return "";
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ");
}

function isHidden(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if (element.getAttribute("aria-hidden") === "true") return true;
  if (htmlElement.hidden) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  return Boolean(element.parentElement && isHidden(element.parentElement));
}
