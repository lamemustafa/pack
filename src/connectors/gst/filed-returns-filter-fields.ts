import {
  findFieldRoot,
  findFiledReturnsFilterRoot,
  getCustomDropdownControls,
} from "./filed-returns-custom-dropdown";
import { matchesAcceptedText, normaliseText } from "./filed-returns-dom";

export interface FiledReturnsFilterFieldState {
  present: boolean;
  selectedText: string | null;
}

export function readFiledReturnsFilterFieldState(
  documentRef: Document,
  labelPattern: RegExp,
): FiledReturnsFilterFieldState {
  const formRoot = findFiledReturnsFilterRoot(documentRef);
  const knownSelect =
    (formRoot ? findKnownGstSelect(formRoot, labelPattern) : null) ??
    findKnownGstSelect(documentRef, labelPattern);
  if (knownSelect) return readNativeSelectState(knownSelect);

  const fieldRoot = formRoot ? findFieldRoot(formRoot, labelPattern) : null;
  const scopedSelect = fieldRoot?.querySelector("select");
  if (scopedSelect) return readNativeSelectState(scopedSelect);

  const labelledSelect = findLabelledSelect(documentRef, labelPattern);
  if (labelledSelect) return readNativeSelectState(labelledSelect);

  const customText = fieldRoot
    ? normaliseText(getCustomDropdownControls(fieldRoot).map(readElementText).join(" "))
    : "";
  if (customText) return { present: true, selectedText: customText };

  return { present: false, selectedText: null };
}

export function filedReturnsFilterFieldMatches(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): boolean {
  const state = readFiledReturnsFilterFieldState(documentRef, labelPattern);
  return Boolean(state.selectedText && matchesAcceptedText(state.selectedText, acceptedTexts));
}

export function hasFiledReturnsFilterFieldControl(
  documentRef: Document,
  labelPattern: RegExp,
): boolean {
  return readFiledReturnsFilterFieldState(documentRef, labelPattern).present;
}

export function findKnownGstSelect(
  root: ParentNode,
  labelPattern: RegExp,
): HTMLSelectElement | null {
  const ids = knownGstSelectIds(labelPattern);
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  const HTMLSelectElementConstructor = documentRef?.defaultView?.HTMLSelectElement;
  if (!HTMLSelectElementConstructor) return null;

  for (const id of ids) {
    const candidate = root.querySelector(`#${id}`);
    if (candidate instanceof HTMLSelectElementConstructor) return candidate;
  }

  return null;
}

export function findLabelledSelect(
  documentRef: Document,
  labelPattern: RegExp,
): HTMLSelectElement | null {
  const labels = Array.from(documentRef.querySelectorAll("label")).filter((label) =>
    labelPattern.test(label.textContent || ""),
  );
  const HTMLSelectElementConstructor = documentRef.defaultView?.HTMLSelectElement;
  if (!HTMLSelectElementConstructor) return null;

  for (const label of labels) {
    const forId = label.getAttribute("for");
    if (forId) {
      const target = documentRef.getElementById(forId);
      if (target instanceof HTMLSelectElementConstructor) return target;
    }

    let sibling = label.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLSelectElementConstructor) return sibling;
      const nested = sibling.querySelector("select");
      if (nested instanceof HTMLSelectElementConstructor) return nested;
      sibling = sibling.nextElementSibling;
    }
  }

  return null;
}

function knownGstSelectIds(labelPattern: RegExp): string[] {
  if (labelPattern.test("financial year")) return ["finYr"];
  if (labelPattern.test("return filing period")) return ["optValue"];
  if (labelPattern.test("month")) return ["month"];
  if (labelPattern.test("return type")) return ["retTyp"];
  return [];
}

function readNativeSelectState(select: HTMLSelectElement): FiledReturnsFilterFieldState {
  return {
    present: true,
    selectedText: readElementText(select.selectedOptions[0]) || select.value || null,
  };
}

function readElementText(element: Element | null | undefined): string {
  if (!element) return "";
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
