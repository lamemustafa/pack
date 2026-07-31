import { getClickableElements, isVisible, normaliseText } from "./filed-returns-dom";
import type { FiledReturnsReturnType } from "./filed-returns-return-types";

export function findGstr2bDashboardControl(
  documentRef: Document,
  intent: "view",
): HTMLElement | null {
  return findReturnDashboardControl(documentRef, "GSTR-2B", intent);
}

export function findReturnDashboardControl(
  documentRef: Document,
  returnType: FiledReturnsReturnType,
  intent: "view",
): HTMLElement | null {
  const containers = Array.from(
    documentRef.querySelectorAll(
      [
        "tr",
        ".row",
        ".card",
        ".panel",
        "[class*='card']",
        "[class*='col-']",
        "[class*='tile']",
        "[data-ng-repeat]",
        "[ng-repeat]",
      ].join(","),
    ),
  ).sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0));
  for (const container of containers) {
    const text = normaliseText(container.textContent ?? "");
    if (!isSpecificReturnTypeText(text, returnType)) continue;
    const control = findMatchingReturnControl(container, returnType, intent);
    if (control) return control;
  }

  const returnControls = getClickableElements(documentRef).filter((element) => {
    const text = normaliseText(readElementText(element));
    return isSpecificReturnTypeText(text, returnType);
  });
  for (const returnControl of returnControls) {
    const control = findNearestReturnControl(returnControl, returnType, intent);
    if (control) return control;
  }
  const nearbyIntentControl = findNearbyReturnIntentControl(documentRef, returnType, intent);
  if (nearbyIntentControl) return nearbyIntentControl;
  return null;
}

function findNearestReturnControl(
  element: HTMLElement,
  returnType: FiledReturnsReturnType,
  intent: "view",
): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    if (!isSpecificReturnTypeText(current.textContent ?? "", returnType)) continue;
    const control = findMatchingReturnControl(current, returnType, intent);
    if (control) return control;
  }
  return null;
}

function findMatchingReturnControl(
  container: Element,
  returnType: FiledReturnsReturnType,
  intent: "view",
): HTMLElement | null {
  const candidates = getClickableElements(container).filter((element) =>
    matchesGstr2bIntentControl(element, intent),
  );
  return candidates.find((element) => hasLocallyScopedReturnTypeText(element, returnType)) ?? null;
}

function findNearbyReturnIntentControl(
  documentRef: Document,
  returnType: FiledReturnsReturnType,
  intent: "view",
): HTMLElement | null {
  return (
    getClickableElements(documentRef).find((element) => {
      if (!matchesGstr2bIntentControl(element, intent)) return false;
      return hasLocallyScopedReturnTypeText(element, returnType);
    }) ?? null
  );
}

function matchesGstr2bIntentControl(element: HTMLElement, intent: "view"): boolean {
  if (!isVisible(element)) return false;
  const label = normaliseText(readElementText(element));
  if (intent === "view" && /^view$/.test(label)) return true;

  const action = normaliseText(
    [element.getAttribute("data-ng-click") ?? "", element.getAttribute("ng-click") ?? ""].join(" "),
  );
  return intent === "view" && action.includes("page_rtp") && !label.includes("download");
}

function hasLocallyScopedReturnTypeText(
  element: HTMLElement,
  returnType: FiledReturnsReturnType,
): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    const currentText = visibleElementText(current);
    if (containsReturnTypeText(currentText))
      return isSpecificReturnTypeText(currentText, returnType);
    const previous = current.previousElementSibling;
    const next = current.nextElementSibling;
    if (previous && isVisibleReturnTypeText(previous, returnType)) return true;
    if (next && isVisibleReturnTypeText(next, returnType)) return true;
  }
  return false;
}

function isVisibleReturnTypeText(element: Element, returnType: FiledReturnsReturnType): boolean {
  const HTMLElementConstructor = element.ownerDocument.defaultView?.HTMLElement;
  return Boolean(
    HTMLElementConstructor &&
    element instanceof HTMLElementConstructor &&
    isVisible(element as HTMLElement) &&
    isSpecificReturnTypeText(visibleElementText(element as HTMLElement), returnType),
  );
}

function visibleElementText(element: HTMLElement): string {
  if (!isVisible(element)) return "";
  return Array.from(element.childNodes)
    .map((node) => {
      if (node.nodeType === 3) return node.textContent ?? "";
      const HTMLElementConstructor = element.ownerDocument.defaultView?.HTMLElement;
      return HTMLElementConstructor && node instanceof HTMLElementConstructor
        ? visibleElementText(node as HTMLElement)
        : "";
    })
    .join(" ");
}

function containsReturnTypeText(text: string): boolean {
  return /gstr-?(?:1a?|2a|2b|3b)\b/.test(normaliseText(text));
}

function isSpecificReturnTypeText(text: string, returnType: FiledReturnsReturnType): boolean {
  const normalised = normaliseText(text);
  const requested =
    returnType === "GSTR-1"
      ? /gstr-?1\b/.test(normalised) && !/gstr-?1a\b/.test(normalised)
      : returnType === "GSTR-2B"
        ? /gstr-?2b\b/.test(normalised)
        : /gstr-?3b\b/.test(normalised);
  if (!requested) return false;
  return !otherReturnTypePattern(returnType).test(normalised);
}

function otherReturnTypePattern(returnType: FiledReturnsReturnType): RegExp {
  if (returnType === "GSTR-1") return /gstr-?1a\b|gstr-?2a\b|gstr-?2b\b|gstr-?3b\b/;
  if (returnType === "GSTR-2B") return /gstr-?1a?\b|gstr-?2a\b|gstr-?3b\b/;
  return /gstr-?1a?\b|gstr-?2a\b|gstr-?2b\b/;
}

function readElementText(element: HTMLElement): string {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  return [
    element.innerText || "",
    element.textContent || "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ].join(" ");
}
