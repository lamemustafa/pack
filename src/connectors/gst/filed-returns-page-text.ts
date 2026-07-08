export function getBodyText(documentRef: Document): string {
  const body = documentRef.body;
  if (!body) return "";

  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  if (!HTMLElementConstructor) return body.innerText || body.textContent || "";

  return getVisibleText(body, HTMLElementConstructor);
}

function getVisibleText(element: HTMLElement, HTMLElementConstructor: typeof HTMLElement): string {
  if (!isTextVisible(element)) return "";

  const childText = Array.from(element.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElementConstructor)
    .map((child) => getVisibleText(child, HTMLElementConstructor))
    .filter(Boolean)
    .join(" ");

  const ownText = Array.from(element.childNodes)
    .filter((child) => child.nodeType === child.TEXT_NODE)
    .map((child) => child.textContent ?? "")
    .join(" ");

  return [ownText, childText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function isTextVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !(style?.display === "none" || style?.visibility === "hidden");
}
