import { getClickableElements, isVisible, normaliseText } from "./filed-returns-dom";

export function findGstr2bDashboardControl(
  documentRef: Document,
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
    if (!text.includes("gstr-2b") && !text.includes("gstr2b")) continue;
    const control = findMatchingGstr2bControl(container, intent);
    if (control) return control;
  }

  const gstr2bControls = getClickableElements(documentRef).filter((element) => {
    const text = normaliseText(readElementText(element));
    return text.includes("gstr-2b") || text.includes("gstr2b");
  });
  for (const gstr2bControl of gstr2bControls) {
    const control = findNearestGstr2bControl(gstr2bControl, intent);
    if (control) return control;
  }
  const nearbyIntentControl = findNearbyGstr2bIntentControl(documentRef, intent);
  if (nearbyIntentControl) return nearbyIntentControl;
  return null;
}

function findNearestGstr2bControl(element: HTMLElement, intent: "view"): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    if (!normaliseText(current.textContent ?? "").match(/gstr-?2b/)) continue;
    const control = findMatchingGstr2bControl(current, intent);
    if (control) return control;
  }
  return null;
}

function findMatchingGstr2bControl(container: Element, intent: "view"): HTMLElement | null {
  const candidates = getClickableElements(container).filter((element) =>
    matchesGstr2bIntentControl(element, intent),
  );
  return candidates.find(hasLocallyScopedGstr2bText) ?? null;
}

function findNearbyGstr2bIntentControl(documentRef: Document, intent: "view"): HTMLElement | null {
  return (
    getClickableElements(documentRef).find((element) => {
      if (!matchesGstr2bIntentControl(element, intent)) return false;
      return hasLocallyScopedGstr2bText(element);
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

function hasLocallyScopedGstr2bText(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    const currentText = current.textContent ?? "";
    if (containsReturnTypeText(currentText)) return isSpecificGstr2bText(currentText);
    const previous = current.previousElementSibling;
    const next = current.nextElementSibling;
    if (previous && isSpecificGstr2bText(previous.textContent ?? "")) return true;
    if (next && isSpecificGstr2bText(next.textContent ?? "")) return true;
  }
  return false;
}

function containsReturnTypeText(text: string): boolean {
  return /gstr-?(?:1a?|2a|2b|3b)\b/.test(normaliseText(text));
}

function isSpecificGstr2bText(text: string): boolean {
  const normalised = normaliseText(text);
  if (!/gstr-?2b/.test(normalised)) return false;
  return !/gstr-?1a?\b|gstr-?2a\b|gstr-?3b\b/.test(normalised);
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
