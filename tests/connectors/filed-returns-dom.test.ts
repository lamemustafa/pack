import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { clickPortalElement } from "../../src/connectors/gst/filed-returns-dom";

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
