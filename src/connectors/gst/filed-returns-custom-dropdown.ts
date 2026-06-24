import {
  activateElement,
  delay,
  isHtmlElement,
  isVisible,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";

const CLICK_SETTLE_DELAY_MS = 250;

export async function selectCustomOptionNearLabel(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): Promise<boolean> {
  const formRoot = findFiledReturnsFilterRoot(documentRef);
  if (!formRoot) return false;

  const fieldRoot = findFieldRoot(formRoot, labelPattern);
  if (!fieldRoot) return false;

  const currentText = normaliseText(fieldRoot.textContent || "");
  if (matchesAcceptedText(currentText, acceptedTexts)) return true;

  const control = getCustomDropdownControls(fieldRoot).find((candidate) => isVisible(candidate));
  if (!control) return false;

  const beforeOpenElements = new Set(Array.from(documentRef.body.querySelectorAll("*")));
  activateElement(control);
  await delay(CLICK_SETTLE_DELAY_MS);

  const option = findVisibleOption(documentRef, acceptedTexts, control, beforeOpenElements);
  if (!option) return false;

  activateElement(option);
  await delay(CLICK_SETTLE_DELAY_MS);
  return matchesAcceptedText(normaliseText(fieldRoot.textContent || ""), acceptedTexts);
}

export function findFiledReturnsFilterRoot(documentRef: Document): HTMLElement | null {
  const searchButton = getClickableSearchButton(documentRef);
  if (!searchButton) return null;

  let current: HTMLElement | null = searchButton;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const text = normaliseText(current.innerText || current.textContent || "");
    if (
      /financial\s+year/i.test(text) &&
      /return\s+filing\s+period/i.test(text) &&
      /return\s+type/i.test(text)
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return searchButton.parentElement;
}

export function findFieldRoot(root: ParentNode, labelPattern: RegExp): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("label, div, span, p")).filter(
    (element) => {
      const text = normaliseText(element.textContent || "");
      return text.length > 0 && text.length <= 80 && labelPattern.test(text);
    },
  );

  for (const candidate of candidates) {
    let current: HTMLElement | null = candidate;
    for (let depth = 0; current && depth < 4; depth += 1) {
      const controls = getCustomDropdownControls(current);
      const selects = current.querySelectorAll("select");
      const text = normaliseText(current.innerText || current.textContent || "");
      if (
        ((controls.length > 0 && controls.length <= 2) || selects.length === 1) &&
        text.length <= 160
      ) {
        return current;
      }
      current = current.parentElement;
    }
  }

  return null;
}

export function getCustomDropdownControls(root: ParentNode): HTMLElement[] {
  const selector = [
    "button",
    "[role='button']",
    "[aria-haspopup]",
    "[ng-click]",
    "[data-ng-click]",
    ".select2-choice",
    ".ui-select-match",
    ".chosen-single",
    ".dropdown-toggle",
  ].join(",");

  return Array.from(root.querySelectorAll(selector)).filter((element) =>
    isHtmlElement(root, element),
  );
}

function getClickableSearchButton(documentRef: Document): HTMLElement | null {
  const selector = [
    "button",
    "a",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
  ].join(",");

  return (
    Array.from(documentRef.querySelectorAll(selector))
      .filter((element): element is HTMLElement => isHtmlElement(documentRef, element))
      .find((element) =>
        /^search$/i.test(normaliseText(element.innerText || element.textContent || "")),
      ) ?? null
  );
}

function findVisibleOption(
  documentRef: Document,
  acceptedTexts: readonly string[],
  openedControl: HTMLElement,
  beforeOpenElements: ReadonlySet<Element>,
): HTMLElement | null {
  const optionRoots = candidateOptionRoots(documentRef, openedControl, beforeOpenElements);
  const selector = [
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

  for (const root of optionRoots) {
    const candidates = root.matches(selector)
      ? [root, ...Array.from(root.querySelectorAll(selector))]
      : Array.from(root.querySelectorAll(selector));
    for (const element of candidates) {
      if (!isHtmlElement(documentRef, element)) continue;
      if (element === openedControl || openedControl.contains(element)) continue;
      if (!isVisible(element)) continue;
      const text = normaliseText(element.innerText || element.textContent || "");
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
  const overlaySelector = [
    "[role='listbox']",
    ".ui-select-choices",
    ".select2-drop",
    ".select2-results",
    ".chosen-drop",
    ".dropdown-menu",
  ].join(",");
  const fieldRoot = openedControl.closest("div, section, form");
  const candidate = fieldRoot?.querySelector(overlaySelector);
  return candidate && isHtmlElement(openedControl.ownerDocument, candidate) && isVisible(candidate)
    ? candidate
    : null;
}

function newOverlayRoots(
  documentRef: Document,
  beforeOpenElements: ReadonlySet<Element>,
): HTMLElement[] {
  const overlaySelector = [
    "[role='listbox']",
    ".ui-select-choices",
    ".select2-drop",
    ".select2-results",
    ".chosen-drop",
    ".dropdown-menu",
  ].join(",");

  return Array.from(documentRef.body.querySelectorAll(overlaySelector)).filter(
    (element): element is HTMLElement =>
      isHtmlElement(documentRef, element) && !beforeOpenElements.has(element) && isVisible(element),
  );
}

function newOptionRoots(
  documentRef: Document,
  beforeOpenElements: ReadonlySet<Element>,
): HTMLElement[] {
  const optionSelector = [
    "[role='option']",
    ".ui-select-choices-row",
    ".select2-results li",
    ".chosen-results li",
  ].join(",");

  return Array.from(documentRef.body.querySelectorAll(optionSelector)).filter(
    (element): element is HTMLElement =>
      isHtmlElement(documentRef, element) && !beforeOpenElements.has(element) && isVisible(element),
  );
}
