import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectFiledReturnsFiltersInMainWorld } from "../../src/background/main-world-filed-returns-filter-selection";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("main-world filed-return filter selection", () => {
  it("follows the portal instruction to leave filing period unselected", async () => {
    const windowRef = new JSDOM(`
      <main>
        <p>Please do not select any value in Return Filing Period.</p>
        <select id="finYr"><option>Select</option><option>2026-27</option></select>
        <select id="optValue"><option>Select</option><option>Monthly</option></select>
        <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
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
      returnType: "GSTR-3B",
    });

    expect(outcome.state).toBe("searched");
    expect(outcome.safeSignals).toContain("return-filing-period-left-unselected");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2026-27");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
    expect(windowRef.document.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("GSTR3B");
    expect(searched).toBe(1);
  });
});
