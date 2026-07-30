import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLICKABLE_CONTROL_SELECTOR } from "../../src/connectors/gst/filed-returns-dom";
import { selectFiledReturnsFiltersInMainWorld } from "../../src/connectors/gst/main-world-filed-returns-filter-selection";

function selectFilters(scope: Parameters<typeof selectFiledReturnsFiltersInMainWorld>[0]) {
  return selectFiledReturnsFiltersInMainWorld(scope, CLICKABLE_CONTROL_SELECTOR);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("main-world filed-return filter selection", () => {
  it("selects GSTR-1 filing period and month despite unrelated page instructions", async () => {
    const windowRef = new JSDOM(`
      <main>
        <p>
          To view the filed GST ITC-01/02A/03 forms, please do not select any value in Return
          Filing Period.
        </p>
        <select id="finYr"><option>Select</option><option>2026-27</option></select>
        <select id="optValue"><option>Select</option><option>Monthly</option></select>
        <select id="month"><option>Select</option><option>May</option></select>
        <select id="retTyp">
          <option>Select</option><option>GSTR-10</option><option>GSTR-1/IFF/GSTR-1A</option>
        </select>
        <button>Search</button>
      </main>
    `).window;
    const browserGlobals = windowRef as unknown as {
      HTMLSelectElement: typeof HTMLSelectElement;
      Event: typeof Event;
    };
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLSelectElement", browserGlobals.HTMLSelectElement);
    vi.stubGlobal("Event", browserGlobals.Event);
    let searched = 0;
    windowRef.document.querySelector("button")?.addEventListener("click", () => {
      searched += 1;
    });
    windowRef.document.querySelector("#retTyp")?.addEventListener("change", () => {
      const month = windowRef.document.querySelector<HTMLSelectElement>("#month");
      if (month) month.value = "Select";
    });

    const outcome = await selectFilters({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(outcome.state).toBe("searched");
    expect(outcome.safeSignals).not.toContain("return-filing-period-left-unselected");
    expect(outcome.safeSignals).toContain("main-world-month-selected");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2026-27");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Monthly");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#month")?.value).toBe("May");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe(
      "GSTR-1/IFF/GSTR-1A",
    );
    expect(searched).toBe(1);
  });

  it("does not search when dependent filters lose stability", async () => {
    const windowRef = new JSDOM(`
      <main>
        <select id="finYr"><option>Select</option><option>2026-27</option></select>
        <select id="optValue"><option>Select</option><option>Monthly</option></select>
        <select id="month"><option>Select</option><option>May</option></select>
        <select id="retTyp"><option>Select</option><option>GSTR-1/IFF/GSTR-1A</option></select>
        <button>Search</button>
      </main>
    `).window;
    const browserGlobals = windowRef as unknown as {
      HTMLSelectElement: typeof HTMLSelectElement;
      Event: typeof Event;
    };
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLSelectElement", browserGlobals.HTMLSelectElement);
    vi.stubGlobal("Event", browserGlobals.Event);
    let searched = 0;
    windowRef.document.querySelector("button")?.addEventListener("click", () => {
      searched += 1;
    });
    windowRef.document.querySelector("#month")?.addEventListener("change", () => {
      const returnType = windowRef.document.querySelector<HTMLSelectElement>("#retTyp");
      if (returnType) returnType.value = "Select";
    });

    const outcome = await selectFilters({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(outcome).toEqual({
      state: "waiting",
      safeSignals: ["main-world-filter-selection-unstable"],
    });
    expect(searched).toBe(0);
  });

  it("honours an unselected-period instruction that explicitly names the requested return", async () => {
    const windowRef = new JSDOM(`
      <main>
        <p>For GSTR-2B, please do not select any value in Return Filing Period.</p>
        <select id="finYr"><option>Select</option><option>2026-27</option></select>
        <select id="optValue"><option>Select</option><option>Monthly</option></select>
        <select id="retTyp"><option>Select</option><option>GSTR-2B</option></select>
        <button>Search</button>
      </main>
    `).window;
    const browserGlobals = windowRef as unknown as {
      HTMLSelectElement: typeof HTMLSelectElement;
      Event: typeof Event;
    };
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLSelectElement", browserGlobals.HTMLSelectElement);
    vi.stubGlobal("Event", browserGlobals.Event);

    const outcome = await selectFilters({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(outcome.state).toBe("searched");
    expect(outcome.safeSignals).toContain("return-filing-period-left-unselected");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
  });

  it("clears a stale filing period before a GSTR-2B search that requires no period", async () => {
    const windowRef = new JSDOM(`
      <main>
        <p>For GSTR-2B, please do not select any value in Return Filing Period.</p>
        <select id="finYr"><option>Select</option><option>2026-27</option></select>
        <select id="optValue"><option>Select</option><option selected>Monthly</option></select>
        <select id="retTyp"><option>Select</option><option>GSTR-2B</option></select>
        <button>Search</button>
      </main>
    `).window;
    const browserGlobals = windowRef as unknown as {
      HTMLSelectElement: typeof HTMLSelectElement;
      Event: typeof Event;
    };
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLSelectElement", browserGlobals.HTMLSelectElement);
    vi.stubGlobal("Event", browserGlobals.Event);

    const outcome = await selectFilters({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(outcome.state).toBe("searched");
    expect(outcome.safeSignals).toContain("return-filing-period-left-unselected");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
  });

  it("uses the sole actionable exact Search control from a live-shaped GSTR-1 page", async () => {
    vi.useFakeTimers();
    const windowRef = new JSDOM(`
      <style>.ng-hide { display: none !important; }</style>
      <main>
        <form data-stale-form class="ng-hide" aria-hidden="true" name="efiledReturns">
          ${gstr1FilterFields()}
          <button data-rejected-search>Search</button>
        </form>
        <form data-live-form name="efiledReturns">
          ${gstr1FilterFields()}
          <button data-rejected-search hidden>Search</button>
          <div aria-hidden="true"><button data-rejected-search>Search</button></div>
          <div inert><button data-rejected-search>Search</button></div>
          <button data-rejected-search disabled>Search</button>
          <button data-rejected-search class="disabled">Search</button>
          <fieldset disabled>
            <span data-rejected-search role="button">Search</span>
          </fieldset>
          <div aria-disabled="true"><button data-rejected-search>Search</button></div>
          <div style="opacity: 0"><button data-rejected-search>Search</button></div>
          <div style="pointer-events: none"><button data-rejected-search>Search</button></div>
          <button data-live-search type="button">Search</button>
        </form>
      </main>
    `).window;
    const browserGlobals = windowRef as unknown as {
      HTMLSelectElement: typeof HTMLSelectElement;
      Event: typeof Event;
    };
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLSelectElement", browserGlobals.HTMLSelectElement);
    vi.stubGlobal("Event", browserGlobals.Event);
    let rejectedSearchClicks = 0;
    let liveSearchClicks = 0;
    for (const search of windowRef.document.querySelectorAll("[data-rejected-search]")) {
      search.addEventListener("click", () => {
        rejectedSearchClicks += 1;
      });
    }
    windowRef.document.querySelector("[data-live-search]")?.addEventListener("click", () => {
      liveSearchClicks += 1;
    });

    const outcomePromise = selectFilters({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-1",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await outcomePromise;

    expect(outcome.state).toBe("searched");
    expect(outcome.safeSignals).toContain("main-world-search-clicked");
    expect(rejectedSearchClicks).toBe(0);
    expect(liveSearchClicks).toBe(1);
    const staleForm = windowRef.document.querySelector("[data-stale-form]");
    const liveForm = windowRef.document.querySelector("[data-live-form]");
    expect(staleForm?.querySelector<HTMLSelectElement>("select[id='finYr']")?.value).toBe("Select");
    expect(liveForm?.querySelector<HTMLSelectElement>("select[id='finYr']")?.value).toBe("2026-27");
    expect(liveForm?.querySelector<HTMLSelectElement>("select[id='optValue']")?.value).toBe(
      "Monthly",
    );
    expect(liveForm?.querySelector<HTMLSelectElement>("select[id='month']")?.value).toBe("May");
    expect(liveForm?.querySelector<HTMLSelectElement>("select[id='retTyp']")?.value).toBe(
      "GSTR-1/IFF/GSTR-1A",
    );
  });

  it("fails closed when multiple actionable controls have the exact Search label", async () => {
    vi.useFakeTimers();
    const windowRef = new JSDOM(`
      <main>
        ${gstr1FilterFields()}
        <button data-first-search>Search</button>
        <input data-second-search type="button" value="Search" />
      </main>
    `).window;
    const browserGlobals = windowRef as unknown as {
      HTMLSelectElement: typeof HTMLSelectElement;
      Event: typeof Event;
    };
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLSelectElement", browserGlobals.HTMLSelectElement);
    vi.stubGlobal("Event", browserGlobals.Event);
    let searchClicks = 0;
    for (const search of windowRef.document.querySelectorAll(
      "[data-first-search], [data-second-search]",
    )) {
      search.addEventListener("click", () => {
        searchClicks += 1;
      });
    }

    const outcomePromise = selectFilters({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-1",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await outcomePromise;

    expect(outcome).toEqual({
      state: "unavailable",
      safeSignals: ["main-world-search-ambiguous"],
    });
    expect(searchClicks).toBe(0);
  });

  it("fails closed when no exact Search control is actionable", async () => {
    vi.useFakeTimers();
    const windowRef = new JSDOM(`
      <main>
        ${gstr1FilterFields()}
        <button disabled>Search</button>
        <button aria-disabled="true">Search</button>
        <div style="pointer-events: none"><button>Search</button></div>
      </main>
    `).window;
    const browserGlobals = windowRef as unknown as {
      HTMLSelectElement: typeof HTMLSelectElement;
      Event: typeof Event;
    };
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLSelectElement", browserGlobals.HTMLSelectElement);
    vi.stubGlobal("Event", browserGlobals.Event);

    const outcomePromise = selectFilters({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-1",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await outcomePromise;

    expect(outcome).toEqual({
      state: "unavailable",
      safeSignals: ["main-world-search-not-found"],
    });
  });
});

function gstr1FilterFields(): string {
  return `
    <select id="finYr"><option>Select</option><option>2026-27</option></select>
    <select id="optValue"><option>Select</option><option>Monthly</option></select>
    <select id="month"><option>Select</option><option>May</option></select>
    <select id="retTyp">
      <option>Select</option><option>GSTR-1/IFF/GSTR-1A</option>
    </select>
  `;
}
