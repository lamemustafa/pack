import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  CLICKABLE_CONTROL_SELECTOR,
  clickPortalElement,
  findUniqueActionableExactSearchControl,
  getActionableExactSearchControls,
  getClickableElements,
} from "../../src/connectors/gst/filed-returns-dom";
import { getCustomDropdownControls } from "../../src/connectors/gst/filed-returns-custom-dropdown";
import { getNavigationElements } from "../../src/connectors/gst/filed-returns-navigation-dom";
import { findSearchButtons } from "../../src/connectors/gst/gstr2b-dashboard-search";

describe("filed-return clickable controls", () => {
  it("uses the canonical set while preserving navigation's named form-input exclusion", () => {
    const documentRef = new JSDOM(`
      <a data-canonical="anchor"></a>
      <button data-canonical="button"></button>
      <span data-canonical="role" role="button"></span>
      <span data-canonical="ng-click" ng-click="run()"></span>
      <span data-canonical="data-ng-click" data-ng-click="run()"></span>
      <input data-canonical="input-button" type="button" />
      <input data-canonical="input-submit" type="submit" />
      <input data-canonical="input-role" type="button" role="button" />
      <span data-navigation-only="mouseenter" ng-mouseenter="open()"></span>
      <span data-navigation-only="dismiss" data-dismiss="modal"></span>
    `).window.document;

    const canonical = getClickableElements(documentRef);
    const navigation = getNavigationElements(documentRef, { includeHidden: true });

    expect(CLICKABLE_CONTROL_SELECTOR).toBe(
      "a,button,[role='button'],[ng-click],[data-ng-click],input[type='button'],input[type='submit']",
    );
    expect(canonical.map((element) => element.getAttribute("data-canonical"))).toEqual([
      "anchor",
      "button",
      "role",
      "ng-click",
      "data-ng-click",
      "input-button",
      "input-submit",
      "input-role",
    ]);
    expect(
      navigation
        .filter((element) => element.hasAttribute("data-canonical"))
        .map((element) => element.getAttribute("data-canonical")),
    ).toEqual(["anchor", "button", "role", "ng-click", "data-ng-click", "input-role"]);
    expect(
      navigation
        .filter((element) => element.hasAttribute("data-navigation-only"))
        .map((element) => element.getAttribute("data-navigation-only")),
    ).toEqual(["mouseenter", "dismiss"]);
  });

  it("keeps custom-dropdown resolution unchanged while composing from the canonical set", () => {
    const documentRef = new JSDOM(`
      <a data-rejected="anchor"></a>
      <input data-rejected="input" type="button" />
      <button data-control="button"></button>
      <a data-control="role" role="button"></a>
      <input data-control="ng-click" type="button" ng-click="open()" />
      <span data-control="aria" aria-haspopup="listbox"></span>
      <span data-control="class" class="select2-choice"></span>
    `).window.document;

    expect(
      getCustomDropdownControls(documentRef).map((element) => element.getAttribute("data-control")),
    ).toEqual(["button", "role", "ng-click", "aria", "class"]);
  });

  it("keeps GSTR-2B fallback search identity limited to its former control types", () => {
    const documentRef = new JSDOM(`
      <a name="search">Go</a>
      <span ng-click="run()" name="search">Go</span>
      <button data-search name="search">Go</button>
    `).window.document;

    expect(findSearchButtons(documentRef)).toEqual([documentRef.querySelector("[data-search]")]);
  });
});

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
