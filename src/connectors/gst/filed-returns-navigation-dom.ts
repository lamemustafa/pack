import {
  CLICKABLE_CONTROL_SELECTOR,
  clickPortalElement,
  dispatchPointerSequence,
  isHtmlElement,
  isPlainFormActionInput,
  isVisible,
} from "./filed-returns-dom";
import {
  normaliseCandidateText,
  type NavigationCandidateInput,
} from "./filed-returns-navigation-candidates";

const NAVIGATION_EXTRA_CONTROL_SELECTOR = [
  "[ng-mouseenter]",
  "[data-ng-mouseenter]",
  "[data-dismiss='modal']",
].join(",");
const NAVIGATION_CONTROL_SELECTOR = [
  CLICKABLE_CONTROL_SELECTOR,
  NAVIGATION_EXTRA_CONTROL_SELECTOR,
].join(",");

export function revealMenuCandidate(
  documentRef: Document,
  predicate: (candidate: NavigationCandidateInput) => boolean,
  options: { click?: boolean } = {},
) {
  const element = getNavigationElements(documentRef).find((candidateElement) =>
    predicate(toNavigationCandidateInput(candidateElement)),
  );
  if (!element) return;

  dispatchPointerSequence(element);
  const FocusEventConstructor = element.ownerDocument.defaultView?.FocusEvent;
  if (FocusEventConstructor) {
    element.dispatchEvent(new FocusEventConstructor("focus", { bubbles: true }));
  }
  if (options.click) clickPortalElement(element);
}

export function isServicesMenuCandidate(candidate: NavigationCandidateInput): boolean {
  return /^services\s*$/i.test(normaliseCandidateText([candidate.text, candidate.ariaLabel]));
}

export function isReturnsMenuCandidate(candidate: NavigationCandidateInput): boolean {
  return /^returns\s*$/i.test(normaliseCandidateText([candidate.text, candidate.ariaLabel]));
}

export function getNavigationElements(
  root: ParentNode,
  options: { includeHidden?: boolean } = {},
): HTMLElement[] {
  const elements = Array.from(root.querySelectorAll(NAVIGATION_CONTROL_SELECTOR)).filter(
    (element): element is HTMLElement =>
      isHtmlElement(root, element) &&
      (!isPlainFormActionInput(element) || element.matches(NAVIGATION_EXTRA_CONTROL_SELECTOR)),
  );
  return options.includeHidden ? elements : elements.filter((element) => isVisible(element));
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
