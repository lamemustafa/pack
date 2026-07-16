import type { FiledReturnsDownloadScope } from "../../core/contracts";
import { normaliseFiledReturnsArtifactType } from "../../core/filed-returns-artifacts";
import { normaliseText } from "./filed-returns-dom";

interface FiledReturnsSearchAttempt {
  signature: string;
  preSearchFingerprint: string;
  preSearchLoadingFingerprint: string | null;
  preSearchResultWasSettledForScope: boolean;
  candidateResultFingerprint: string | null;
  sawResultSurfaceLoading: boolean;
  unchangedResultAfterLoading: boolean;
  settled: boolean;
  createdAt: number;
}

interface Gstr1ViewActivationAttempt {
  attemptedAt: number;
  signature: string;
}

interface SettledFiledReturnsSearchEvidence {
  fingerprint: string;
  settledAt: number;
  signature: string;
}

export type Gstr1ViewActivationState = "not-attempted" | "navigation-pending" | "expired";

const searchAttempts = new WeakMap<Document, FiledReturnsSearchAttempt>();
const settledSearchEvidence = new WeakMap<Document, SettledFiledReturnsSearchEvidence>();
const gstr1ViewActivationAttempts = new WeakMap<Document, Gstr1ViewActivationAttempt>();
const GSTR1_VIEW_NAVIGATION_PENDING_MS = 3_000;
const SEARCH_ATTEMPT_TTL_MS = 2 * 60 * 1000;
const SETTLED_SEARCH_EVIDENCE_TTL_MS = 30_000;
const resultRootIds = new WeakMap<Element, number>();
let nextResultRootId = 1;

function filedReturnsSearchSignature(scope: FiledReturnsDownloadScope): string {
  const artifactType = normaliseFiledReturnsArtifactType(scope.returnType, scope.artifactType);
  return `${scope.financialYear}::${scope.period}::${scope.returnType}::${artifactType}`;
}

export function markFiledReturnsSearchPending(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): void {
  gstr1ViewActivationAttempts.delete(documentRef);
  const signature = filedReturnsSearchSignature(scope);
  const preSearchFingerprint = resultFingerprint(documentRef);
  const settledEvidence = settledSearchEvidence.get(documentRef);
  const settledEvidenceIsFresh =
    settledEvidence && Date.now() - settledEvidence.settledAt <= SETTLED_SEARCH_EVIDENCE_TTL_MS;
  searchAttempts.set(documentRef, {
    signature,
    preSearchFingerprint,
    preSearchLoadingFingerprint: loadingFingerprint(documentRef),
    preSearchResultWasSettledForScope:
      Boolean(settledEvidenceIsFresh) &&
      settledEvidence?.signature === signature &&
      settledEvidence.fingerprint === preSearchFingerprint,
    candidateResultFingerprint: null,
    sawResultSurfaceLoading: false,
    unchangedResultAfterLoading: false,
    settled: false,
    createdAt: Date.now(),
  });
}

export function gstr1ViewActivationStateForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): Gstr1ViewActivationState {
  const attempt = gstr1ViewActivationAttempts.get(documentRef);
  if (!attempt || attempt.signature !== filedReturnsSearchSignature(scope)) {
    return "not-attempted";
  }
  return Date.now() - attempt.attemptedAt < GSTR1_VIEW_NAVIGATION_PENDING_MS
    ? "navigation-pending"
    : "expired";
}

export function markGstr1ViewActivationAttempted(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): void {
  gstr1ViewActivationAttempts.set(documentRef, {
    attemptedAt: Date.now(),
    signature: filedReturnsSearchSignature(scope),
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
    attempt.candidateResultFingerprint = null;
    attempt.settled = false;
    attempt.unchangedResultAfterLoading = false;
    return false;
  }
  if (attempt.settled) return true;

  const currentFingerprint = resultFingerprint(documentRef);
  const hasTrustedIdenticalRefresh =
    attempt.sawResultSurfaceLoading && attempt.preSearchResultWasSettledForScope;
  if (currentFingerprint === attempt.preSearchFingerprint && !hasTrustedIdenticalRefresh) {
    if (!attempt.sawResultSurfaceLoading) {
      attempt.candidateResultFingerprint = null;
      return false;
    }
    if (attempt.candidateResultFingerprint !== currentFingerprint) {
      attempt.candidateResultFingerprint = currentFingerprint;
      return false;
    }
    attempt.unchangedResultAfterLoading = true;
    return false;
  }
  attempt.unchangedResultAfterLoading = false;

  if (attempt.candidateResultFingerprint !== currentFingerprint) {
    attempt.candidateResultFingerprint = currentFingerprint;
    return false;
  }

  // The portal can render a stable result row before its View action is ready.
  // Defer the first settled result so the runner observes one more unchanged cycle.
  attempt.settled = true;
  return false;
}

export function hasPendingFiledReturnsSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  const attempt = searchAttempts.get(documentRef);
  if (!attempt || attempt.signature !== filedReturnsSearchSignature(scope)) return false;
  if (Date.now() - attempt.createdAt > SEARCH_ATTEMPT_TTL_MS) {
    searchAttempts.delete(documentRef);
    return false;
  }
  return !attempt.settled;
}

export function hasUnchangedFiledReturnsSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): boolean {
  const attempt = searchAttempts.get(documentRef);
  if (attempt && Date.now() - attempt.createdAt > SEARCH_ATTEMPT_TTL_MS) {
    searchAttempts.delete(documentRef);
    return false;
  }
  return (
    attempt?.signature === filedReturnsSearchSignature(scope) && attempt.unchangedResultAfterLoading
  );
}

export function consumeSettledFiledReturnsSearchForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): void {
  const attempt = searchAttempts.get(documentRef);
  if (attempt?.signature === filedReturnsSearchSignature(scope) && attempt.settled) {
    settledSearchEvidence.set(documentRef, {
      fingerprint: resultFingerprint(documentRef),
      settledAt: Date.now(),
      signature: attempt.signature,
    });
    searchAttempts.delete(documentRef);
  }
}

export function clearFiledReturnsSearchAttempt(documentRef: Document): void {
  searchAttempts.delete(documentRef);
  settledSearchEvidence.delete(documentRef);
  gstr1ViewActivationAttempts.delete(documentRef);
}

export function clearFiledReturnsSearchAttemptForScope(
  documentRef: Document,
  scope: FiledReturnsDownloadScope,
): void {
  const signature = filedReturnsSearchSignature(scope);
  if (searchAttempts.get(documentRef)?.signature === signature) {
    searchAttempts.delete(documentRef);
  }
  if (settledSearchEvidence.get(documentRef)?.signature === signature) {
    settledSearchEvidence.delete(documentRef);
  }
  if (gstr1ViewActivationAttempts.get(documentRef)?.signature === signature) {
    gstr1ViewActivationAttempts.delete(documentRef);
  }
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
    textHash: hashVisibleText(text),
    noRecordCount: (text.match(/\bno\s+(records?|data|results?)\s+found\b/g) ?? []).length,
    tableCount: element.querySelectorAll("table").length,
    rowCount: element.querySelectorAll("tr").length,
    clickableCount: element.querySelectorAll("a,button,[role='button'],input[type='button']")
      .length,
    viewActionCount: (text.match(/\bview\b|\bdownload\b/g) ?? []).length,
    textLengthBucket: Math.min(100, Math.ceil(text.length / 25)),
  });
}

function hashVisibleText(text: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(36);
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
