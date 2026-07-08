import {
  delay,
  isHtmlElement,
  isVisible,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";

const DROPDOWN_POLL_MS = 50;
const DROPDOWN_OPEN_TIMEOUT_MS = 400;
const OPTION_SELECTOR = [
  "[role='option']",
  ".ui-select-choices-row",
  ".select2-results li",
  ".chosen-results li",
  "li",
  "a",
  "button",
  "span",
  "[role='listbox'] div",
  ".dropdown-menu div",
  ".ui-select-choices div",
  ".select2-results div",
].join(",");
const OVERLAY_SELECTOR = [
  "[role='listbox']",
  ".ui-select-choices",
  ".select2-drop",
  ".select2-results",
  ".chosen-drop",
  ".dropdown-menu",
].join(",");
const NEW_OPTION_ROOT_SELECTOR = [
  "[role='option']",
  ".ui-select-choices-row",
  ".select2-results li",
  ".chosen-results li",
].join(",");

export async function waitForVisibleCustomDropdownOption(
  documentRef: Document,
  acceptedTexts: readonly string[],
  openedControl: HTMLElement,
  beforeOpenElements: ReadonlySet<Element>,
): Promise<HTMLElement | null> {
  const startedAt = Date.now();
  do {
    const option = findVisibleOption(documentRef, acceptedTexts, openedControl, beforeOpenElements);
    if (option) return option;
    await delay(DROPDOWN_POLL_MS);
  } while (Date.now() - startedAt < DROPDOWN_OPEN_TIMEOUT_MS);
  return null;
}

function findVisibleOption(
  documentRef: Document,
  acceptedTexts: readonly string[],
  openedControl: HTMLElement,
  beforeOpenElements: ReadonlySet<Element>,
): HTMLElement | null {
  for (const root of candidateOptionRoots(documentRef, openedControl, beforeOpenElements)) {
    const candidates = root.matches(OPTION_SELECTOR)
      ? [root, ...Array.from(root.querySelectorAll(OPTION_SELECTOR))]
      : Array.from(root.querySelectorAll(OPTION_SELECTOR));
    for (const element of candidates) {
      if (!isHtmlElement(documentRef, element)) continue;
      if (element === openedControl || openedControl.contains(element)) continue;
      if (!isVisible(element)) continue;
      const text = normaliseText(readElementText(element));
      if (text.length > 0 && text.length <= 80 && matchesAcceptedText(text, acceptedTexts)) {
        return element;
      }
    }
  }

  return null;
}

function candidateOptionRoots(
  documentRef: Document,
  openedControl: HTMLElement,
  beforeOpenElements: ReadonlySet<Element>,
): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const controlledRoot = findAriaControlledRoot(documentRef, openedControl);
  if (controlledRoot) roots.push(controlledRoot);

  const fieldOverlay = closestOptionContainer(openedControl);
  if (fieldOverlay) roots.push(fieldOverlay);

  roots.push(...newOverlayRoots(documentRef, beforeOpenElements));
  roots.push(...newOptionRoots(documentRef, beforeOpenElements));

  return Array.from(new Set(roots));
}

function findAriaControlledRoot(
  documentRef: Document,
  openedControl: HTMLElement,
): HTMLElement | null {
  const controls = openedControl.getAttribute("aria-controls");
  if (!controls) return null;

  for (const id of controls.split(/\s+/)) {
    if (!id) continue;
    const candidate = documentRef.getElementById(id);
    if (candidate && isHtmlElement(documentRef, candidate) && isVisible(candidate)) {
      return candidate;
    }
  }

  return null;
}

function closestOptionContainer(openedControl: HTMLElement): HTMLElement | null {
  const fieldRoot = openedControl.closest("div, section, form");
  const candidate = fieldRoot?.querySelector(OVERLAY_SELECTOR);
  return candidate && isHtmlElement(openedControl.ownerDocument, candidate) && isVisible(candidate)
    ? candidate
    : null;
}

function newOverlayRoots(
  documentRef: Document,
  beforeOpenElements: ReadonlySet<Element>,
): HTMLElement[] {
  return Array.from(documentRef.body.querySelectorAll(OVERLAY_SELECTOR)).filter(
    (element): element is HTMLElement =>
      isHtmlElement(documentRef, element) && !beforeOpenElements.has(element) && isVisible(element),
  );
}

function newOptionRoots(
  documentRef: Document,
  beforeOpenElements: ReadonlySet<Element>,
): HTMLElement[] {
  return Array.from(documentRef.body.querySelectorAll(NEW_OPTION_ROOT_SELECTOR)).filter(
    (element): element is HTMLElement =>
      isHtmlElement(documentRef, element) && !beforeOpenElements.has(element) && isVisible(element),
  );
}

function readElementText(element: Element): string {
  const HTMLInputElementConstructor = element.ownerDocument.defaultView?.HTMLInputElement;
  const inputValue =
    HTMLInputElementConstructor && element instanceof HTMLInputElementConstructor
      ? element.value
      : "";
  return [
    "innerText" in element ? (element as HTMLElement).innerText : "",
    element.textContent ?? "",
    inputValue,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
