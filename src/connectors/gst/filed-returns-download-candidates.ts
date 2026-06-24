import type { NavigationCandidateInput } from "./filed-returns-navigator";

const CLICKABLE_SELECTOR = ["a", "button", "[role='button']", "[ng-click]", "[data-ng-click]"].join(
  ",",
);

interface CandidateScore {
  score: number;
  safeSignals: string[];
}

export interface FiledGstr3bDownloadCandidate {
  candidate: NavigationCandidateInput;
  element: HTMLElement;
  score: CandidateScore;
}

export function scoreFiledGstr3bDownloadCandidate(
  candidate: NavigationCandidateInput,
): CandidateScore {
  const searchable = normaliseCandidateText([
    candidate.text,
    candidate.ariaLabel,
    candidate.title,
    candidate.href,
  ]);
  const safeSignals: string[] = [];
  let score = 0;
  const hasExplicitFiledDownload = /\bdownload\s+filed\s+gstr[\s-]?3b\b/.test(searchable);

  if (hasExplicitFiledDownload) {
    score += 160;
    safeSignals.push("text-download-filed-gstr3b");
  }
  if (/\bdownload\b/.test(searchable) && /\bfiled\b/.test(searchable)) {
    score += 50;
    safeSignals.push("text-download-filed");
  }
  if (/\bdownload\b/.test(searchable) && /\bgstr[\s-]?3b\b/.test(searchable)) {
    score += 40;
    safeSignals.push("text-download-gstr3b");
  }

  if (/\bsystem\s+generated\b/.test(searchable)) {
    score -= 220;
    safeSignals.push("excluded-system-generated-gstr3b");
  }
  if (
    /\b(save|submit|proceed|continue|file)\b/.test(searchable) ||
    (!hasExplicitFiledDownload && /\bclick here\b/.test(searchable))
  ) {
    score -= 160;
    safeSignals.push("excluded-filing-or-navigation-action");
  }
  if (!/\bdownload\b/.test(searchable)) {
    score -= 40;
    safeSignals.push("excluded-missing-download-term");
  }

  return { score, safeSignals };
}

export function findFiledGstr3bDownloadCandidateIndex(
  candidates: readonly NavigationCandidateInput[],
): number {
  let bestIndex = -1;
  let bestScore = 0;

  candidates.forEach((candidate, index) => {
    const { score } = scoreFiledGstr3bDownloadCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 120 ? bestIndex : -1;
}

export function resolveVisibleFiledGstr3bDownloadCandidates(
  documentRef: Document,
): FiledGstr3bDownloadCandidate[] {
  return getClickableElements(documentRef)
    .filter((element) => !isDisabled(element) && isVisible(element))
    .map((element) => ({
      candidate: toNavigationCandidateInput(element),
      element,
    }))
    .map(({ candidate, element }) => ({
      candidate,
      element,
      score: scoreFiledGstr3bDownloadCandidate(candidate),
    }))
    .filter((candidate) => candidate.score.score >= 120);
}

function getClickableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter((element) =>
    isHtmlElement(root, element),
  );
}

function toNavigationCandidateInput(element: HTMLElement): NavigationCandidateInput {
  const input: NavigationCandidateInput = {
    text: element.innerText || element.textContent || "",
  };
  const HTMLAnchorElementConstructor = element.ownerDocument.defaultView?.HTMLAnchorElement;
  const href =
    HTMLAnchorElementConstructor && element instanceof HTMLAnchorElementConstructor
      ? element.href
      : null;
  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");

  if (href) input.href = href;
  if (ariaLabel) input.ariaLabel = ariaLabel;
  if (title) input.title = title;

  return input;
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.getAttribute("disabled") !== null ||
    element.getAttribute("aria-disabled") === "true" ||
    element.classList.contains("disabled")
  );
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style?.display === "none" || style?.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect?.();
  return !rect || rect.width > 0 || rect.height > 0;
}

function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}

function normaliseCandidateText(values: readonly (string | undefined)[]): string {
  return values.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}
