import {
  normaliseCandidateText,
  type NavigationCandidateInput,
} from "./filed-returns-navigation-candidates";

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

export function revealMenuCandidate(
  documentRef: Document,
  predicate: (candidate: NavigationCandidateInput) => boolean,
) {
  const element = getClickableElements(documentRef).find((candidateElement) =>
    predicate(toNavigationCandidateInput(candidateElement)),
  );
  if (!element) return;

  dispatchPointerSequence(element);
  const FocusEventConstructor = element.ownerDocument.defaultView?.FocusEvent;
  if (FocusEventConstructor) {
    element.dispatchEvent(new FocusEventConstructor("focus", { bubbles: true }));
  }
  element.click();
}

export function isServicesMenuCandidate(candidate: NavigationCandidateInput): boolean {
  return /^services\s*$/i.test(normaliseCandidateText([candidate.text, candidate.ariaLabel]));
}

export function isReturnsMenuCandidate(candidate: NavigationCandidateInput): boolean {
  return /^returns\s*$/i.test(normaliseCandidateText([candidate.text, candidate.ariaLabel]));
}

export function getClickableElements(
  root: ParentNode,
  options: { includeHidden?: boolean } = {},
): HTMLElement[] {
  const elements = Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter(
    (element): element is HTMLElement => isHtmlElement(root, element),
  );
  return options.includeHidden ? elements : elements.filter(isVisible);
}

export function toNavigationCandidateInput(element: HTMLElement): NavigationCandidateInput {
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

export function activateElement(element: HTMLElement) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  dispatchPointerSequence(element);
  element.click();
}

export function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.offsetParent !== null;
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

function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}
