import {
  findDialogDismissalCandidateIndex,
  scoreDialogDismissalCandidate,
  type NavigationCandidateInput,
} from "./filed-returns-navigation-candidates";
import { clickPortalElement } from "./filed-returns-dom";
export {
  dismissKnownFiledReturnsSummaryModal,
  isFiledReturnsSummaryModalDismissalBlocked,
} from "./filed-returns-summary-overlay";

const DIALOG_SETTLE_DELAY_MS = 60;
const DIALOG_SETTLE_POLL_MS = 15;
const MAX_DIALOG_DISMISSALS = 4;
const CLICKABLE_SELECTOR = [
  "a",
  "button",
  "[role='button']",
  "[ng-click]",
  "[data-ng-click]",
  "[ng-mouseenter]",
  "[data-ng-mouseenter]",
  "[data-dismiss='modal']",
].join(",");
const MODAL_SELECTOR = ".modal.in, .modal.show, .modal-open .modal, [role='dialog']";
const SAFE_POST_LOGIN_DIALOG_PATTERNS = [
  /would you like to authenticate aadhaar or upload e-?kyc documents/i,
  /dashboard\s*>\s*my profile\s*>\s*aadhaar authentication status/i,
  /gst system is collecting metadata/i,
  /furnish the bank account details/i,
  /(?:gta\s+)?annexure\s+v/i,
  /goods transport agency\s+annexure/i,
  /logged in session will expire[\s\S]*click continue to extend your session/i,
];

export async function dismissSafePostLoginDialogs(documentRef: Document): Promise<string[]> {
  const signals: string[] = [];
  const dismissedElements = new Set<HTMLElement>();

  for (let iteration = 0; iteration < MAX_DIALOG_DISMISSALS; iteration += 1) {
    const elements = getVisibleDialogElements(documentRef).filter(
      (element) => !dismissedElements.has(element),
    );
    const candidates = elements.map(toNavigationCandidateInput);
    const candidateIndex = findDialogDismissalCandidateIndex(candidates);
    if (candidateIndex === -1) break;

    const candidate = candidates[candidateIndex];
    const element = elements[candidateIndex];
    if (!candidate || !element) break;

    const score = scoreDialogDismissalCandidate(candidate);
    dismissedElements.add(element);
    activateElement(element);
    signals.push("safe-dialog-dismissed", ...score.safeSignals);
    const root = element.closest(MODAL_SELECTOR) ?? element;
    await waitForDialogRootToSettle(root);
  }

  return signals;
}

export function hasVisibleSafePostLoginDialog(documentRef: Document): boolean {
  return getVisiblePostLoginDialogRoots(documentRef).length > 0;
}

function getClickableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter(
    (element): element is HTMLElement => isHtmlElement(root, element) && isVisible(element),
  );
}

function getVisibleDialogRoots(documentRef: Document): HTMLElement[] {
  const roots = Array.from(documentRef.querySelectorAll(MODAL_SELECTOR)).filter(
    (element): element is HTMLElement => isHtmlElement(documentRef, element) && isVisible(element),
  );
  roots.push(...getKnownPostLoginDialogRoots(documentRef));
  return Array.from(new Set(roots));
}

function getVisiblePostLoginDialogRoots(documentRef: Document): HTMLElement[] {
  return getVisibleDialogRoots(documentRef).filter((root) => {
    const text = root.innerText || root.textContent || "";
    return SAFE_POST_LOGIN_DIALOG_PATTERNS.some((pattern) => pattern.test(text));
  });
}

function getKnownPostLoginDialogRoots(documentRef: Document): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const dismissiveElements = getClickableElements(documentRef).filter((element) => {
    const score = scoreDialogDismissalCandidate(toNavigationCandidateInput(element));
    return score.score >= 70 && isVisible(element);
  });

  for (const element of dismissiveElements) {
    let current: HTMLElement | null = element;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const text = current.innerText || current.textContent || "";
      if (SAFE_POST_LOGIN_DIALOG_PATTERNS.some((pattern) => pattern.test(text))) {
        roots.push(current);
        break;
      }
      current = current.parentElement;
    }
  }

  return roots.filter((element) => isVisible(element));
}

function getVisibleDialogElements(documentRef: Document): HTMLElement[] {
  return getVisiblePostLoginDialogRoots(documentRef).flatMap((root) =>
    Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter(
      (element): element is HTMLElement => isHtmlElement(root, element) && isVisible(element),
    ),
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
  const className = element.className;
  const title = element.getAttribute("title");

  if (href) input.href = href;
  if (ariaLabel) input.ariaLabel = ariaLabel;
  if (typeof className === "string" && className.trim()) input.className = className;
  if (title) input.title = title;

  return input;
}

function activateElement(element: HTMLElement) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  dispatchPointerSequence(element);
  clickPortalElement(element);
}

function dispatchPointerSequence(element: HTMLElement) {
  const MouseEventConstructor = element.ownerDocument.defaultView?.MouseEvent;
  if (!MouseEventConstructor) return;
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

function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.offsetParent !== null;
}

async function waitForDialogRootToSettle(
  element: Element,
  settleDelayMs = DIALOG_SETTLE_DELAY_MS,
): Promise<void> {
  const maxAttempts = Math.ceil(settleDelayMs / DIALOG_SETTLE_POLL_MS);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isElementStillConnectedAndVisible(element)) return;
    await delay(DIALOG_SETTLE_POLL_MS);
  }
}

function isElementStillConnectedAndVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  return isHtmlElement(element.ownerDocument, element) && isVisible(element);
}

function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
