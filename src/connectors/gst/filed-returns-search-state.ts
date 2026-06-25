import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { normaliseText } from "./filed-returns-dom";

interface FiledReturnsSearchAttempt {
  signature: string;
  preSearchFingerprint: string;
  preSearchLoadingFingerprint: string | null;
  sawPostClickLoading: boolean;
  settled: boolean;
  createdAt: number;
}

const searchAttempts = new WeakMap<Document, FiledReturnsSearchAttempt>();
const SEARCH_ATTEMPT_TTL_MS = 2 * 60 * 1000;

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
    preSearchLoadingFingerprint: loadingFingerprint(documentRef),
    sawPostClickLoading: false,
    settled: false,
    createdAt: Date.now(),
  });
}

export function hasSettledFiledReturnsSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  const attempt = searchAttempts.get(documentRef);
  if (!attempt || attempt.signature !== filedReturnsSearchSignature(scope)) return false;
  if (Date.now() - attempt.createdAt > SEARCH_ATTEMPT_TTL_MS) {
    searchAttempts.delete(documentRef);
    return false;
  }
  if (attempt.settled) return true;

  const currentLoadingFingerprint = loadingFingerprint(documentRef);
  if (
    currentLoadingFingerprint &&
    currentLoadingFingerprint !== attempt.preSearchLoadingFingerprint
  ) {
    attempt.sawPostClickLoading = true;
    return false;
  }

  const currentFingerprint = resultFingerprint(documentRef);
  if (attempt.sawPostClickLoading || currentFingerprint !== attempt.preSearchFingerprint) {
    attempt.settled = true;
    return true;
  }

  return false;
}

export function consumeSettledFiledReturnsSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): void {
  const attempt = searchAttempts.get(documentRef);
  if (attempt?.signature === filedReturnsSearchSignature(scope) && attempt.settled) {
    searchAttempts.delete(documentRef);
  }
}

export function clearFiledReturnsSearchAttempt(documentRef: Document): void {
  searchAttempts.delete(documentRef);
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
    tableCount: element.querySelectorAll("table").length,
    rowCount: element.querySelectorAll("tr").length,
    clickableCount: element.querySelectorAll("a,button,[role='button'],input[type='button']")
      .length,
    viewActionCount: (text.match(/\bview\b|\bdownload\b/g) ?? []).length,
    textLengthBucket: Math.min(100, Math.ceil(text.length / 25)),
  });
}

function loadingFingerprint(root: ParentNode): string | null {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return null;
  const busyElements = Array.from(documentRef.querySelectorAll("[aria-busy='true']")).filter(
    (element) => !isHidden(element),
  );
  const text = normaliseText(visibleText(documentRef.body));
  const loadingTextCount = (
    text.match(/\bloading\b|\bplease\s+wait\b|\bsearching\b|\bprocessing\b/g) ?? []
  ).length;
  if (busyElements.length === 0 && loadingTextCount === 0) return null;
  return JSON.stringify({
    busyCount: busyElements.length,
    loadingTextCount,
  });
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
