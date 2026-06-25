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
  const evaluation = evaluateFiledReturnsFilterField(documentRef, labelPattern, []);
  if (evaluation.status !== "unresolved") return evaluation.state;

  const fallbackSelects = findFallbackSelects(documentRef, labelPattern);
  const fallbackSelect = fallbackSelects.length === 1 ? fallbackSelects[0] : null;
  if (fallbackSelect) return readNativeSelectState(fallbackSelect);

  return { present: false, selectedText: null };
}

export function filedReturnsFilterFieldMatches(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): boolean {
  const evaluation = evaluateFiledReturnsFilterField(documentRef, labelPattern, acceptedTexts);
  if (evaluation.status === "matched") return true;
  if (evaluation.status === "mismatched") return false;

  const fallbackSelects = findFallbackSelects(documentRef, labelPattern);
  if (fallbackSelects.length !== 1) return false;

  const fallbackSelect = fallbackSelects[0];
  if (!fallbackSelect) return false;

  const selectedText = readElementText(fallbackSelect.selectedOptions[0]) || fallbackSelect.value;
  return matchesAcceptedText(selectedText, acceptedTexts);
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
    if (candidate instanceof HTMLSelectElementConstructor && !isHidden(candidate)) return candidate;
  }

  return null;
}

export function findLabelledSelect(
  documentRef: Document,
  labelPattern: RegExp,
): HTMLSelectElement | null {
  return findLabelledSelects(documentRef, labelPattern)[0] ?? null;
}

export function findLabelledSelects(root: ParentNode, labelPattern: RegExp): HTMLSelectElement[] {
  const documentRef = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
  const HTMLSelectElementConstructor = documentRef?.defaultView?.HTMLSelectElement;
  if (!documentRef || !HTMLSelectElementConstructor) return [];

  const labels = Array.from(root.querySelectorAll("label")).filter((label) =>
    labelPattern.test(label.textContent || ""),
  );

  const selects: HTMLSelectElement[] = [];
  for (const label of labels) {
    const forId = label.getAttribute("for");
    if (forId) {
      const target = documentRef.getElementById(forId);
      if (target instanceof HTMLSelectElementConstructor && !isHidden(target)) {
        selects.push(target);
        continue;
      }
    }

    let sibling = label.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLSelectElementConstructor && !isHidden(sibling)) {
        selects.push(sibling);
        break;
      }
      const nested = sibling.querySelector("select");
      if (nested instanceof HTMLSelectElementConstructor && !isHidden(nested)) {
        selects.push(nested);
        break;
      }
      sibling = sibling.nextElementSibling;
    }
  }

  return Array.from(new Set(selects));
}

type FieldEvaluationStatus = "matched" | "mismatched" | "unresolved";

interface FieldEvaluation {
  status: FieldEvaluationStatus;
  state: FiledReturnsFilterFieldState;
}

function evaluateFiledReturnsFilterField(
  documentRef: Document,
  labelPattern: RegExp,
  acceptedTexts: readonly string[],
): FieldEvaluation {
  const formRoot = findScopedFilterRoot(documentRef);
  const scopedSelects = formRoot
    ? uniqueSelects([
        findKnownGstSelect(formRoot, labelPattern),
        ...findLabelledSelects(formRoot, labelPattern),
      ])
    : [];
  if (scopedSelects.length > 0) {
    return evaluateSelectedTexts(
      scopedSelects.map((select) => readElementText(select.selectedOptions[0]) || select.value),
      acceptedTexts,
    );
  }

  const fieldRoot = formRoot ? findFieldRoot(formRoot, labelPattern) : null;
  const scopedSelect = fieldRoot?.querySelector("select");
  if (scopedSelect && !isHidden(scopedSelect)) {
    return evaluateSelectedTexts(
      [readElementText(scopedSelect.selectedOptions[0]) || scopedSelect.value],
      acceptedTexts,
    );
  }

  const customText = fieldRoot
    ? normaliseText(getCustomDropdownControls(fieldRoot).map(readElementText).join(" "))
    : "";
  if (customText) return evaluateSelectedTexts([customText], acceptedTexts);

  return {
    status: "unresolved",
    state: { present: false, selectedText: null },
  };
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

function evaluateSelectedTexts(
  selectedTexts: readonly string[],
  acceptedTexts: readonly string[],
): FieldEvaluation {
  const nonEmptyTexts = selectedTexts.map(normaliseText).filter(Boolean);
  if (nonEmptyTexts.length === 0) {
    return {
      status: "mismatched",
      state: { present: true, selectedText: null },
    };
  }

  const hasOnlyMatches =
    acceptedTexts.length > 0 &&
    nonEmptyTexts.every((text) => matchesAcceptedText(text, acceptedTexts));
  return {
    status: hasOnlyMatches ? "matched" : "mismatched",
    state: { present: true, selectedText: nonEmptyTexts.join(" ") },
  };
}

function findFallbackSelects(documentRef: Document, labelPattern: RegExp): HTMLSelectElement[] {
  if (findScopedFilterRoot(documentRef)) return [];
  return uniqueSelects([
    findKnownGstSelect(documentRef, labelPattern),
    ...findLabelledSelects(documentRef, labelPattern),
  ]);
}

function findScopedFilterRoot(documentRef: Document): HTMLElement | null {
  const discoveredRoot = findFiledReturnsFilterRoot(documentRef);
  if (discoveredRoot) return discoveredRoot;
  return documentRef.querySelector<HTMLElement>('form[name="efiledReturns"]');
}

function uniqueSelects(selects: Array<HTMLSelectElement | null | undefined>): HTMLSelectElement[] {
  return Array.from(new Set(selects.filter(Boolean) as HTMLSelectElement[]));
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

function isHidden(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if (element.getAttribute("aria-hidden") === "true") return true;
  if (htmlElement.hidden) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  return Boolean(element.parentElement && isHidden(element.parentElement));
}
