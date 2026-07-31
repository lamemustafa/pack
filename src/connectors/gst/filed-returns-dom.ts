export const CLICKABLE_CONTROL_SELECTOR = [
  "a",
  "button",
  "[role='button']",
  "[ng-click]",
  "[data-ng-click]",
  "input[type='button']",
  "input[type='submit']",
].join(",");

export function getClickableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(CLICKABLE_CONTROL_SELECTOR)).filter((element) =>
    isHtmlElement(root, element),
  );
}

export function isPlainFormActionInput(element: HTMLElement): boolean {
  return (
    element.matches("input[type='button'],input[type='submit']") &&
    !element.matches("[role='button'],[ng-click],[data-ng-click]")
  );
}

export function getActionableExactSearchControls(root: ParentNode): HTMLElement[] {
  return getClickableElements(root).filter(
    (element) => isActionablePortalControl(element) && hasExactSearchText(element),
  );
}

export function findUniqueActionableExactSearchControl(root: ParentNode): HTMLElement | null {
  const matches = getActionableExactSearchControls(root);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function activateElement(element: HTMLElement) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  dispatchPointerSequence(element);
  clickPortalElement(element);
}

export function dispatchPointerSequence(element: HTMLElement): void {
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
}

export function clickPortalElement(element: HTMLElement): void {
  if (!hasJavascriptUrlActivation(element)) {
    element.click();
    return;
  }

  const MouseEventConstructor = element.ownerDocument.defaultView?.MouseEvent;
  const EventConstructor = element.ownerDocument.defaultView?.Event;
  if (!EventConstructor) return;
  const clickEvent = MouseEventConstructor
    ? new MouseEventConstructor("click", {
        bubbles: true,
        cancelable: true,
        view: element.ownerDocument.defaultView,
      })
    : new EventConstructor("click", { bubbles: true, cancelable: true });
  clickEvent.preventDefault();
  element.dispatchEvent(clickEvent);
}

function hasJavascriptUrlActivation(element: HTMLElement): boolean {
  const activationElement = element.closest<HTMLElement>("a[href]") ?? element;
  return /^javascript:/i.test(activationElement.getAttribute("href")?.trim() ?? "");
}

export function dispatchChange(element: HTMLElement) {
  const EventConstructor = element.ownerDocument.defaultView?.Event;
  if (!EventConstructor) return;
  const FocusEventConstructor = element.ownerDocument.defaultView?.FocusEvent;
  element.dispatchEvent(
    FocusEventConstructor
      ? new FocusEventConstructor("focus", { bubbles: false, cancelable: false })
      : new EventConstructor("focus", { bubbles: false, cancelable: false }),
  );
  for (const eventName of ["input", "change"]) {
    element.dispatchEvent(new EventConstructor(eventName, { bubbles: true, cancelable: true }));
  }
  element.dispatchEvent(
    FocusEventConstructor
      ? new FocusEventConstructor("blur", { bubbles: false, cancelable: false })
      : new EventConstructor("blur", { bubbles: false, cancelable: false }),
  );
}

export function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  if (element.namespaceURI && element.namespaceURI !== "http://www.w3.org/1999/xhtml") {
    return false;
  }
  const view = documentRef.defaultView;
  const HTMLElementConstructor = view?.HTMLElement;
  return HTMLElementConstructor && element instanceof HTMLElementConstructor
    ? true
    : typeof (element as Partial<HTMLElement>).click === "function";
}

export function normaliseText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function matchesAcceptedText(text: string, acceptedTexts: readonly string[]): boolean {
  const comparableText = normaliseComparable(text);
  return acceptedTexts.some((accepted) => {
    const comparableAccepted = normaliseComparable(accepted);
    if (comparableText === comparableAccepted) return true;
    return containsComparableWithoutNumericPrefixCollision(comparableText, comparableAccepted);
  });
}

export function isVisible(
  element: HTMLElement,
  options: { requireRenderedBox?: boolean } = {},
): boolean {
  if (element.hidden) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  const rect = element.getBoundingClientRect();
  const hasRenderedBox = rect.width > 0 || rect.height > 0;
  return options.requireRenderedBox
    ? hasRenderedBox
    : hasRenderedBox || Boolean(element.offsetParent);
}

export function isActionablePortalControl(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const view = element.ownerDocument.defaultView;
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.matches(":disabled") ||
      current.hidden ||
      current.classList.contains("disabled") ||
      current.hasAttribute("inert") ||
      normaliseText(current.getAttribute("aria-hidden") ?? "") === "true" ||
      normaliseText(current.getAttribute("aria-disabled") ?? "") === "true"
    ) {
      return false;
    }

    const style = view?.getComputedStyle(current);
    if (
      style &&
      (style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0" ||
        style.pointerEvents === "none")
    ) {
      return false;
    }

    current = current.parentElement;
  }

  return true;
}

function normaliseComparable(value: string): string {
  return normaliseText(value).replace(/[^a-z0-9]/g, "");
}

function hasExactSearchText(element: HTMLElement): boolean {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  const textCandidates = [
    element.innerText || "",
    element.textContent || "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ];
  return textCandidates.some((text) => normaliseText(text) === "search");
}

function containsComparableWithoutNumericPrefixCollision(
  comparableText: string,
  comparableAccepted: string,
): boolean {
  if (!comparableAccepted) return false;
  let index = comparableText.indexOf(comparableAccepted);
  while (index >= 0) {
    const followingCharacter = comparableText[index + comparableAccepted.length] ?? "";
    if (!/\d$/.test(comparableAccepted) || !/^\d$/.test(followingCharacter)) return true;
    index = comparableText.indexOf(comparableAccepted, index + 1);
  }
  return false;
}
