import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { normaliseText } from "./filed-returns-dom";

interface FiledReturnsSearchAttempt {
  signature: string;
  preSearchFingerprint: string;
  preSearchLoadingFingerprint: string | null;
  sawResultSurfaceLoading: boolean;
  settled: boolean;
  createdAt: number;
}

const searchAttempts = new WeakMap<Document, FiledReturnsSearchAttempt>();
const SEARCH_ATTEMPT_TTL_MS = 2 * 60 * 1000;
const resultRootIds = new WeakMap<Element, number>();
let nextResultRootId = 1;

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
    sawResultSurfaceLoading: false,
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

  const currentLoadingFingerprint = loadingFingerprint(documentRef);
  if (
    currentLoadingFingerprint &&
    currentLoadingFingerprint !== attempt.preSearchLoadingFingerprint
  ) {
    attempt.sawResultSurfaceLoading = true;
    attempt.settled = false;
    return false;
  }
  if (attempt.settled) return true;

  const currentFingerprint = resultFingerprint(documentRef);
  if (attempt.sawResultSurfaceLoading || currentFingerprint !== attempt.preSearchFingerprint) {
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
  if (candidates.length === 0) return "__no-result-surface__";
  return candidates.map((root) => fingerprintElement(root)).join("|");
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
        "section",
        "article",
      ].join(","),
    ),
  ).filter((element) => !isHidden(element) && isResultSurface(element));
}

function fingerprintElement(element: Element): string {
  const text = normaliseText(visibleText(element));
  return JSON.stringify({
    rootId: resultRootId(element),
    noRecordCount: (text.match(/\bno\s+(records?|data|results?)\s+found\b/g) ?? []).length,
    tableCount: element.querySelectorAll("table").length,
    rowCount: element.querySelectorAll("tr").length,
    clickableCount: element.querySelectorAll("a,button,[role='button'],input[type='button']")
      .length,
    viewActionCount: (text.match(/\bview\b|\bdownload\b/g) ?? []).length,
    textLengthBucket: Math.min(100, Math.ceil(text.length / 25)),
  });
}

function isResultSurface(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "table" || tagName === "tbody") return true;
  if (
    /result/i.test(
      [
        element.getAttribute("aria-label") ?? "",
        element.getAttribute("id") ?? "",
        element.getAttribute("class") ?? "",
      ].join(" "),
    )
  ) {
    return true;
  }
  const text = normaliseText(visibleText(element));
  return /\bno\s+(records?|data|results?)\s+found\b/.test(text);
}

function loadingFingerprint(root: ParentNode): string | null {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return null;
  const roots = resultContainers(documentRef);
  const busyElements = roots.flatMap((resultRoot) =>
    [resultRoot, ...Array.from(resultRoot.querySelectorAll("[aria-busy='true']"))].filter(
      (element) => element.getAttribute("aria-busy") === "true" && !isHidden(element),
    ),
  );
  const text = normaliseText(roots.map((resultRoot) => visibleText(resultRoot)).join(" "));
  const loadingTextCount = (
    text.match(/\bloading\b|\bplease\s+wait\b|\bsearching\b|\bprocessing\b/g) ?? []
  ).length;
  if (busyElements.length === 0 && loadingTextCount === 0) return null;
  return JSON.stringify({
    busyCount: busyElements.length,
    loadingTextCount,
  });
}

function resultRootId(element: Element): number {
  const existing = resultRootIds.get(element);
  if (existing) return existing;
  const id = nextResultRootId;
  nextResultRootId += 1;
  resultRootIds.set(element, id);
  return id;
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
