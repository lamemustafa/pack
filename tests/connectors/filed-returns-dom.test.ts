import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  clickPortalElement,
  findUniqueActionableExactSearchControl,
  getActionableExactSearchControls,
} from "../../src/connectors/gst/filed-returns-dom";

describe("filed-return portal clicks", () => {
  it("dispatches a cancelled click for a JavaScript URL without activating the URL", () => {
    const documentRef = new JSDOM(
      '<a data-link href="javascript:void(0)"><span data-control role="button">Download</span></a>',
    ).window.document;
    const control = documentRef.querySelector<HTMLElement>("[data-control]");
    const link = documentRef.querySelector<HTMLElement>("[data-link]");
    if (!control || !link) throw new Error("Expected synthetic portal controls.");
    let clickCount = 0;
    let defaultPrevented = false;
    link.addEventListener("click", (event) => {
      clickCount += 1;
      defaultPrevented = event.defaultPrevented;
    });

    clickPortalElement(control);

    expect(clickCount).toBe(1);
    expect(defaultPrevented).toBe(true);
  });

  it("keeps ordinary portal button activation unchanged", () => {
    const documentRef = new JSDOM('<button data-control type="button">Search</button>').window
      .document;
    const control = documentRef.querySelector<HTMLElement>("[data-control]");
    if (!control) throw new Error("Expected a synthetic portal control.");
    let clickCount = 0;
    let defaultPrevented = false;
    control.addEventListener("click", (event) => {
      clickCount += 1;
      defaultPrevented = event.defaultPrevented;
    });

    clickPortalElement(control);

    expect(clickCount).toBe(1);
    expect(defaultPrevented).toBe(false);
  });
});

describe("filed-return Search controls", () => {
  it("keeps only an exact Search control with an actionable ancestor chain", () => {
    const documentRef = new JSDOM(`
      <style>.ng-hide { display: none; }</style>
      <form class="ng-hide"><button data-hidden-css>Search</button></form>
      <section aria-hidden="true"><button data-aria-hidden>Search</button></section>
      <section inert><button data-inert>Search</button></section>
      <button data-disabled disabled>Search</button>
      <button data-class-disabled class="disabled">Search</button>
      <fieldset disabled><span data-disabled-ancestor role="button">Search</span></fieldset>
      <section aria-disabled="true"><button data-aria-disabled>Search</button></section>
      <section style="opacity: 0"><button data-transparent>Search</button></section>
      <section style="pointer-events: none"><button data-no-pointer>Search</button></section>
      <button data-non-exact>Search returns</button>
      <button data-actionable>Search</button>
    `).window.document;

    expect(getActionableExactSearchControls(documentRef)).toEqual([
      documentRef.querySelector("[data-actionable]"),
    ]);
    expect(findUniqueActionableExactSearchControl(documentRef)).toBe(
      documentRef.querySelector("[data-actionable]"),
    );
  });

  it("fails closed when multiple actionable controls have the exact Search label", () => {
    const documentRef = new JSDOM(`
      <button data-first>Search</button>
      <input data-second type="submit" value="Search" />
    `).window.document;

    expect(getActionableExactSearchControls(documentRef)).toHaveLength(2);
    expect(findUniqueActionableExactSearchControl(documentRef)).toBeNull();
  });

  it("fails closed when no exact Search control is actionable", () => {
    const documentRef = new JSDOM(`
      <button hidden>Search</button>
      <button disabled>Search</button>
      <button>Search returns</button>
    `).window.document;

    expect(getActionableExactSearchControls(documentRef)).toEqual([]);
    expect(findUniqueActionableExactSearchControl(documentRef)).toBeNull();
  });
});
