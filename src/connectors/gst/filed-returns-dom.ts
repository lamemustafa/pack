const CLICK_SETTLE_DELAY_MS = 250;
const CLICKABLE_SELECTOR = [
  "a",
  "button",
  "[role='button']",
  "[ng-click]",
  "[data-ng-click]",
  "input[type='button']",
  "input[type='submit']",
].join(",");

export function getClickableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(CLICKABLE_SELECTOR)).filter((element) =>
    isHtmlElement(root, element),
  );
}

export function activateElement(element: HTMLElement) {
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
  element.click();
  void delay(CLICK_SETTLE_DELAY_MS);
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
    return comparableText === comparableAccepted || comparableText.includes(comparableAccepted);
  });
}

export function isVisible(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || Boolean(element.offsetParent);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function normaliseComparable(value: string): string {
  return normaliseText(value).replace(/[^a-z0-9]/g, "");
}
