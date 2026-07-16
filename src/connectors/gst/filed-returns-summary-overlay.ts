import {
  scoreFiledReturnsSummaryModalDismissalCandidate,
  type NavigationCandidateInput,
  type NavigationCandidateScore,
} from "./filed-returns-navigation-candidates";
import { clickPortalElement } from "./filed-returns-dom";

const SUMMARY_DIALOG_SETTLE_DELAY_MS = 1_000;
const SUMMARY_DIALOG_CONTROL_WAIT_MS = 1_000;
const SUMMARY_DIALOG_POLL_MS = 15;
const SUMMARY_MODAL_PATTERN = /system generated summary for gstr[\s-]?3b/i;
const MODAL_SELECTOR = ".modal.in, .modal.show, .modal-open .modal, [role='dialog']";
const CLICKABLE_SELECTOR = [
  "a",
  "button",
  "[role='button']",
  "[ng-click]",
  "[data-ng-click]",
  "[data-dismiss='modal']",
].join(",");

export async function dismissKnownFiledReturnsSummaryModal(
  documentRef: Document,
): Promise<string[]> {
  if (!findVisibleSummaryModal(documentRef)) return [];
  const candidate = await waitForDismissalCandidate(documentRef);
  if (candidate) {
    activateElement(candidate.element);
    await waitForSummaryModalToSettle(documentRef);
    if (findVisibleSummaryModal(documentRef)) {
      return [
        "detail-summary-modal-close-blocked",
        "detail-summary-modal-close-clicked",
        ...candidate.score.safeSignals,
      ];
    }
    return [
      "detail-summary-modal-dismissed",
      "detail-summary-modal-close-clicked",
      ...candidate.score.safeSignals,
    ];
  }
  return findVisibleSummaryModal(documentRef)
    ? ["detail-summary-modal-close-control-not-found"]
    : ["detail-summary-modal-dismissed"];
}

export function isFiledReturnsSummaryModalDismissalBlocked(
  safeSignals: readonly string[],
): boolean {
  return (
    safeSignals.includes("detail-summary-modal-close-blocked") ||
    safeSignals.includes("detail-summary-modal-close-control-not-found")
  );
}

async function waitForDismissalCandidate(
  documentRef: Document,
): Promise<{ element: HTMLElement; score: NavigationCandidateScore } | null> {
  const startedAt = Date.now();
  do {
    const modalRoot = findVisibleSummaryModal(documentRef);
    if (!modalRoot) return null;
    const candidate = findDismissalCandidate(modalRoot);
    if (candidate) return candidate;
    await delay(SUMMARY_DIALOG_POLL_MS);
  } while (Date.now() - startedAt < SUMMARY_DIALOG_CONTROL_WAIT_MS);
  return null;
}

function findVisibleSummaryModal(documentRef: Document): HTMLElement | null {
  const roots = Array.from(documentRef.querySelectorAll(MODAL_SELECTOR)).filter(
    (element): element is HTMLElement => isHtmlElement(documentRef, element) && isVisible(element),
  );
  for (const element of getClickableElements(documentRef)) {
    const score = scoreFiledReturnsSummaryModalDismissalCandidate(toCandidateInput(element));
    if (score.score < 60) continue;
    let current: HTMLElement | null = element;
    for (let depth = 0; current && depth < 8; depth += 1) {
      if (SUMMARY_MODAL_PATTERN.test(current.innerText || current.textContent || "")) {
        roots.push(current);
        break;
      }
      current = current.parentElement;
    }
  }
  return (
    [...new Set(roots)].find((root) =>
      SUMMARY_MODAL_PATTERN.test(root.innerText || root.textContent || ""),
    ) ?? null
  );
}

function findDismissalCandidate(
  modalRoot: HTMLElement,
): { element: HTMLElement; score: NavigationCandidateScore } | null {
  let bestElement: HTMLElement | null = null;
  let bestScore: NavigationCandidateScore = { score: 0, safeSignals: [] };
  for (const element of getClickableElements(modalRoot)) {
    const score = scoreFiledReturnsSummaryModalDismissalCandidate(toCandidateInput(element));
    if (score.score > bestScore.score) {
      bestElement = element;
      bestScore = score;
    }
  }
  return bestElement && bestScore.score >= 60 ? { element: bestElement, score: bestScore } : null;
}

async function waitForSummaryModalToSettle(documentRef: Document): Promise<void> {
  const attempts = Math.ceil(SUMMARY_DIALOG_SETTLE_DELAY_MS / SUMMARY_DIALOG_POLL_MS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!findVisibleSummaryModal(documentRef)) return;
    await delay(SUMMARY_DIALOG_POLL_MS);
  }
}

function getClickableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter(
    (element): element is HTMLElement => isHtmlElement(root, element) && isVisible(element),
  );
}

function toCandidateInput(element: HTMLElement): NavigationCandidateInput {
  const input: NavigationCandidateInput = { text: element.innerText || element.textContent || "" };
  const anchor = element.ownerDocument.defaultView?.HTMLAnchorElement;
  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  if (anchor && element instanceof anchor && element.href) input.href = element.href;
  if (ariaLabel) input.ariaLabel = ariaLabel;
  if (typeof element.className === "string" && element.className.trim()) {
    input.className = element.className;
  }
  if (title) input.title = title;
  return input;
}

function activateElement(element: HTMLElement): void {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  const MouseEventConstructor = element.ownerDocument.defaultView?.MouseEvent;
  if (MouseEventConstructor) {
    for (const type of ["pointerover", "mouseover", "mouseenter", "pointerdown", "mousedown"]) {
      element.dispatchEvent(
        new MouseEventConstructor(type, {
          bubbles: true,
          cancelable: true,
          view: element.ownerDocument.defaultView,
        }),
      );
    }
  }
  clickPortalElement(element);
}

function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.offsetParent !== null;
}

function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  const HTMLElementConstructor = documentRef?.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
