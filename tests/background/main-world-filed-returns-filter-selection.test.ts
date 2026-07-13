import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectFiledReturnsFiltersInMainWorld } from "../../src/background/main-world-filed-returns-filter-selection";

afterEach(() => {
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

    const outcome = await selectFiledReturnsFiltersInMainWorld({
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

    const outcome = await selectFiledReturnsFiltersInMainWorld({
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(outcome.state).toBe("searched");
    expect(outcome.safeSignals).toContain("return-filing-period-left-unselected");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
  });
});
