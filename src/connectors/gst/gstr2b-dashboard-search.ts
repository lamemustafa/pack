import { getClickableElements, normaliseText } from "./filed-returns-dom";

export function findSearchButton(root: ParentNode): HTMLElement | null {
  return findSearchButtons(root)[0] ?? null;
}

export function findSearchButtons(root: ParentNode): HTMLElement[] {
  const textMatches = getClickableElements(root).filter((element) =>
    /^search$/i.test(normaliseText(readElementText(element))),
  );
  const selectorMatches = Array.from(
    root.querySelectorAll(
      [
        "button",
        "input[type='button']",
        "input[type='submit']",
        "[role='button']",
        "[class*='srchbtn']",
        "[class*='search']",
        "[id*='search']",
      ].join(","),
    ),
  ).filter((element): element is HTMLElement => {
    if (!isClickableHtmlElement(element)) return false;
    const identity = normaliseText(
      [
        readElementText(element),
        element.id,
        element.className,
        element.getAttribute("name") ?? "",
        element.getAttribute("value") ?? "",
      ].join(" "),
    );
    return /\bsearch\b|srchbtn/.test(identity);
  });
  return [...new Set([...textMatches, ...selectorMatches])];
}

function isClickableHtmlElement(element: Element): element is HTMLElement {
  if (element.namespaceURI && element.namespaceURI !== "http://www.w3.org/1999/xhtml") {
    return false;
  }
  return typeof (element as Partial<HTMLElement>).click === "function";
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
