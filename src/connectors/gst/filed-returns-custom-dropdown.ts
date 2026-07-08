import {
  activateElement,
  delay,
  isHtmlElement,
  isVisible,
  matchesAcceptedText,
  normaliseText,
} from "./filed-returns-dom";
import { waitForVisibleCustomDropdownOption } from "./filed-returns-custom-dropdown-options";

const DROPDOWN_POLL_MS = 50;
const DROPDOWN_SELECTION_TIMEOUT_MS = 400;

export async function selectCustomOptionNearLabel(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): Promise<boolean> {
  const formRoot = findFiledReturnsFilterRoot(documentRef);
  if (!formRoot) return false;

  const fieldRoot = findFieldRoot(formRoot, labelPattern);
  if (!fieldRoot) return false;

  const currentText = normaliseText(
    getCustomDropdownControls(fieldRoot).map(readElementText).join(" "),
  );
  if (matchesAcceptedText(currentText, acceptedTexts)) return true;

  const control = getCustomDropdownControls(fieldRoot).find((candidate) => isVisible(candidate));
  if (!control) return false;

  const beforeOpenElements = new Set(Array.from(documentRef.body.querySelectorAll("*")));
  activateElement(control);

  const option = await waitForVisibleCustomDropdownOption(
    documentRef,
    acceptedTexts,
    control,
    beforeOpenElements,
  );
  if (!option) return false;

  activateElement(option);
  return waitForFieldTextMatch(fieldRoot, acceptedTexts);
}

export function findFiledReturnsFilterRoot(documentRef: Document): HTMLElement | null {
  const candidates: Array<{ element: HTMLElement; score: number }> = [];
  for (const searchButton of getClickableSearchButtons(documentRef)) {
    let current: HTMLElement | null = searchButton;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const text = normaliseText(current.innerText || current.textContent || "");
      if (
        /financial\s+year/i.test(text) &&
        /return\s+filing\s+period/i.test(text) &&
        /return\s+type/i.test(text)
      ) {
        candidates.push({
          element: current,
          score: (current.tagName.toLowerCase() === "form" ? -1_000 : 0) + text.length,
        });
        break;
      }
      current = current.parentElement;
    }
  }

  return candidates.sort((left, right) => left.score - right.score)[0]?.element ?? null;
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

function getClickableSearchButtons(documentRef: Document): HTMLElement[] {
  const selector = [
    "button",
    "a",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
  ].join(",");

  return Array.from(documentRef.querySelectorAll(selector))
    .filter((element): element is HTMLElement => isHtmlElement(documentRef, element))
    .filter((element) => /^search$/i.test(normaliseText(readElementText(element))));
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

async function waitForFieldTextMatch(
  fieldRoot: HTMLElement,
  acceptedTexts: readonly string[],
): Promise<boolean> {
  const startedAt = Date.now();
  do {
    if (matchesAcceptedText(normaliseText(fieldRoot.textContent || ""), acceptedTexts)) return true;
    await delay(DROPDOWN_POLL_MS);
  } while (Date.now() - startedAt < DROPDOWN_SELECTION_TIMEOUT_MS);
  return false;
}
