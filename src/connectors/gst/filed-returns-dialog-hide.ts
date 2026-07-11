const SUMMARY_MODAL_PATTERN = /system generated summary for gstr[\s-]?3b/i;

export function forceHideLingeringFiledReturnsSummaryModal(element: Element): boolean {
  return forceHideLingeringModal(element, SUMMARY_MODAL_PATTERN, { requireVisible: true });
}

function forceHideLingeringModal(
  element: Element,
  pattern: RegExp,
  options: { requireVisible?: boolean } = {},
): boolean {
  if (options.requireVisible && !isElementStillConnectedAndVisible(element)) return false;
  if (!isHtmlElement(element.ownerDocument, element)) return false;
  if (!pattern.test(element.innerText || element.textContent || "")) return false;

  element.classList.remove("show", "in");
  element.setAttribute("aria-hidden", "true");
  element.style.display = "none";
  element.ownerDocument.body?.classList.remove("modal-open");
  for (const backdrop of Array.from(element.ownerDocument.querySelectorAll(".modal-backdrop"))) {
    backdrop.remove();
  }
  return true;
}

function isElementStillConnectedAndVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  return isHtmlElement(element.ownerDocument, element) && isVisible(element);
}

function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.offsetParent !== null;
}

function isHtmlElement(root: ParentNode, element: Element): element is HTMLElement {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  if (!documentRef) return false;
  const HTMLElementConstructor = documentRef.defaultView?.HTMLElement;
  return HTMLElementConstructor ? element instanceof HTMLElementConstructor : false;
}
