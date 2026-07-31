import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findFiledReturnsFilterRoot } from "../../src/connectors/gst/filed-returns-custom-dropdown";
import { selectFiledReturnsFiltersAndSearch } from "../../src/connectors/gst/filed-returns-filter-form";

const GSTR1_SCOPE = {
  financialYear: "2026-27",
  period: "May",
  returnType: "GSTR-1",
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("filed-return Search selection", () => {
  it("ignores a hidden stale Angular form and clicks the sole actionable live Search control", async () => {
    vi.useFakeTimers();
    const documentRef = createDocument(`
      <style>.ng-hide { display: none !important; }</style>
      <main>
        <form data-stale-form class="ng-hide" aria-hidden="true" name="efiledReturns">
          ${gstr1FilterFields()}
          <button data-stale-search type="button">Search</button>
        </form>
        <form data-live-form name="efiledReturns">
          ${gstr1FilterFields()}
          <button data-live-search type="button">Search</button>
        </form>
      </main>
    `);
    const staleForm = documentRef.querySelector<HTMLElement>("[data-stale-form]");
    const liveForm = documentRef.querySelector<HTMLElement>("[data-live-form]");
    let staleSearchClicks = 0;
    let liveSearchClicks = 0;
    documentRef.querySelector("[data-stale-search]")?.addEventListener("click", () => {
      staleSearchClicks += 1;
    });
    documentRef.querySelector("[data-live-search]")?.addEventListener("click", () => {
      liveSearchClicks += 1;
    });

    expect(staleForm).not.toBeNull();
    expect(findFiledReturnsFilterRoot(documentRef)).toBe(liveForm);

    const resultPromise = selectFiledReturnsFiltersAndSearch(
      documentRef,
      GSTR1_SCOPE,
      "synthetic-gstr1-scope",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.safeSignals).toContain("search-clicked");
    expect(staleSearchClicks).toBe(0);
    expect(liveSearchClicks).toBe(1);
  });

  it("fails closed when the live filter root exposes multiple actionable exact Search controls", async () => {
    vi.useFakeTimers();
    const documentRef = createDocument(`
      <main>
        <form name="efiledReturns">
          ${gstr1FilterFields()}
          <button data-first-search type="button">Search</button>
          <input data-second-search type="submit" value="Search" />
        </form>
      </main>
    `);
    let searchClicks = 0;
    for (const search of documentRef.querySelectorAll(
      "[data-first-search], [data-second-search]",
    )) {
      search.addEventListener("click", (event) => {
        event.preventDefault();
        searchClicks += 1;
      });
    }

    const resultPromise = selectFiledReturnsFiltersAndSearch(
      documentRef,
      GSTR1_SCOPE,
      "synthetic-gstr1-scope",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.safeSignals).toContain("filed-return-filter-selection-in-progress");
    expect(result.safeSignals).not.toContain("search-clicked");
    expect(result.safeMessage).toContain("Missing: search button.");
    expect(searchClicks).toBe(0);
  });

  it("does not choose between separate actionable filed-return filter roots", () => {
    const documentRef = createDocument(`
      <main>
        <form data-first-form name="efiledReturns">
          ${gstr1FilterFields()}
          <button type="button">Search</button>
        </form>
        <form data-second-form name="efiledReturns">
          ${gstr1FilterFields()}
          <button type="button">Search</button>
        </form>
      </main>
    `);

    expect(findFiledReturnsFilterRoot(documentRef)).toBeNull();
  });

  it("does not narrow nested actionable filter-root candidates to the inner Search", () => {
    const documentRef = createDocument(`
      <main>
        <p>Financial Year</p>
        <p>Return Filing Period</p>
        <p>Return Type</p>
        <button data-outer-search type="button">Search</button>
        <section>
          <p>Financial Year</p>
          <p>Return Filing Period</p>
          <p>Return Type</p>
          <button data-inner-search type="button">Search</button>
        </section>
      </main>
    `);

    expect(findFiledReturnsFilterRoot(documentRef)).toBeNull();
  });

  it("fails closed when every exact Search control is non-actionable", async () => {
    vi.useFakeTimers();
    const documentRef = createDocument(`
      <main>
        <form name="efiledReturns">
          ${gstr1FilterFields()}
          <button data-disabled-search type="button" disabled>Search</button>
          <button data-aria-disabled-search type="button" aria-disabled="true">Search</button>
          <div style="pointer-events: none">
            <button data-no-pointer-search type="button">Search</button>
          </div>
        </form>
      </main>
    `);
    let searchClicks = 0;
    for (const search of documentRef.querySelectorAll("button")) {
      search.addEventListener("click", () => {
        searchClicks += 1;
      });
    }

    const resultPromise = selectFiledReturnsFiltersAndSearch(
      documentRef,
      GSTR1_SCOPE,
      "synthetic-gstr1-scope",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(findFiledReturnsFilterRoot(documentRef)).toBeNull();
    expect(result.safeSignals).toContain("filed-return-filter-selection-in-progress");
    expect(result.safeSignals).not.toContain("search-clicked");
    expect(searchClicks).toBe(0);
  });
});

function createDocument(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
  }).window.document;
}

function gstr1FilterFields(): string {
  return `
    <label>Financial Year</label>
    <select id="finYr">
      <option>Select</option>
      <option selected>2026-27</option>
    </select>
    <label>Return Filing Period</label>
    <select id="optValue">
      <option>Select</option>
      <option selected>Monthly</option>
    </select>
    <label>Month</label>
    <select id="month">
      <option>Select</option>
      <option selected>May</option>
    </select>
    <label>Return Type</label>
    <select id="retTyp">
      <option>Select</option>
      <option selected>GSTR-1/IFF/GSTR-1A</option>
    </select>
  `;
}
