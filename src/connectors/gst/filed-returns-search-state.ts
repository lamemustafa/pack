import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { normaliseText } from "./filed-returns-dom";

interface FiledReturnsSearchAttempt {
  signature: string;
  preSearchFingerprint: string;
  sawLoading: boolean;
  settled: boolean;
}

const searchAttempts = new WeakMap<Document, FiledReturnsSearchAttempt>();

function filedReturnsSearchSignature(scope: FiledReturnsDownloadScope): string {
  return `${scope.financialYear}::${scope.period}::${scope.returnType}`;
}

export function markFiledReturnsSearchPending(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): void {
  searchAttempts.set(documentRef, {
    signature: filedReturnsSearchSignature(scope),
    preSearchFingerprint: resultFingerprint(documentRef),
    sawLoading: hasLoadingEvidence(documentRef),
    settled: false,
  });
}

export function hasSettledFiledReturnsSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  const attempt = searchAttempts.get(documentRef);
  if (!attempt || attempt.signature !== filedReturnsSearchSignature(scope)) return false;
  if (attempt.settled) return true;

  if (hasLoadingEvidence(documentRef)) {
    attempt.sawLoading = true;
    return false;
  }

  const currentFingerprint = resultFingerprint(documentRef);
  if (attempt.sawLoading || currentFingerprint !== attempt.preSearchFingerprint) {
    attempt.settled = true;
    return true;
  }

  return false;
}

function resultFingerprint(documentRef: Document): string {
  const candidates = resultContainers(documentRef);
  const roots = candidates.length > 0 ? candidates : [documentRef.body].filter(Boolean);
  return roots.map((root) => fingerprintElement(root)).join("|");
}

function resultContainers(documentRef: Document): Element[] {
  return Array.from(
    documentRef.querySelectorAll(
      [
        "[aria-label*='result' i]",
        "[id*='result' i]",
        "[class*='result' i]",
        "table",
        "tbody",
      ].join(","),
    ),
  ).filter((element) => !isHidden(element));
}

function fingerprintElement(element: Element): string {
  const text = normaliseText(visibleText(element));
  return JSON.stringify({
    noRecordCount: (text.match(/\bno\s+(records?|data|results?)\s+found\b/g) ?? []).length,
    loadingCount: (text.match(/\bloading\b|\bplease\s+wait\b|\bsearching\b|\bprocessing\b/g) ?? [])
      .length,
    tableCount: element.querySelectorAll("table").length,
    rowCount: element.querySelectorAll("tr").length,
    clickableCount: element.querySelectorAll("a,button,[role='button'],input[type='button']")
      .length,
    viewActionCount: (text.match(/\bview\b|\bdownload\b/g) ?? []).length,
    textLengthBucket: Math.min(100, Math.ceil(text.length / 25)),
  });
}

function hasLoadingEvidence(root: ParentNode): boolean {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  const busyElement = Array.from(documentRef.querySelectorAll("[aria-busy='true']")).find(
    (element) => !isHidden(element),
  );
  if (busyElement) return true;
  const text = normaliseText(visibleText(documentRef.body));
  return /\bloading\b|\bplease\s+wait\b|\bsearching\b|\bprocessing\b/.test(text);
}

function visibleText(root: Element | null): string {
  if (!root) return "";
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
