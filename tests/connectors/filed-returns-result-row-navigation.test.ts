import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";
import {
  openFiledReturnResultRow,
  resolveGstr1FiledReturnViewPoint,
} from "../../src/connectors/gst/filed-returns-result-row-navigation";
import {
  findMatchingFiledReturnRows,
  findMatchingFilterBoundGstr1Results,
} from "../../src/connectors/gst/filed-returns-result-rows";
import {
  hasSettledFiledReturnsSearchForScope,
  markFiledReturnsSearchPending,
} from "../../src/connectors/gst/filed-returns-search-state";

const SCOPE: FiledReturnsDownloadScope = {
  artifactType: "PDF",
  financialYear: "2025-26",
  period: "April",
  returnType: "GSTR-1",
};

describe("target-bound filed GSTR-1 View point", () => {
  it("rejects a filter-bound table row with a conflicting slash-form FY", () => {
    const documentRef = createFilterBoundResultDocument("table");
    documentRef.querySelector("tbody tr td:nth-child(2)")?.append(" FY 2024/25");

    expect(
      findMatchingFiledReturnRows(documentRef, SCOPE, { allowFilterBoundScope: true }),
    ).toEqual([]);
  });

  it("rejects a filter-bound table row containing requested and conflicting FY values", () => {
    const documentRef = createFilterBoundResultDocument("table");
    documentRef.querySelector("tbody tr td:nth-child(2)")?.append(" FY 2025-26 FY 2024/25");

    expect(
      findMatchingFiledReturnRows(documentRef, SCOPE, { allowFilterBoundScope: true }),
    ).toEqual([]);
  });

  it("rejects a malformed four-digit FY end year", () => {
    const documentRef = createFilterBoundResultDocument("table");
    documentRef.querySelector("tbody tr td:nth-child(2)")?.append(" FY 2025/2126");

    expect(
      findMatchingFiledReturnRows(documentRef, SCOPE, { allowFilterBoundScope: true }),
    ).toEqual([]);
  });

  it("rejects a dedicated FY cell when another row cell conflicts", () => {
    const documentRef = createTableResultDocument(
      ["Return Type", "Financial Year", "Status", "View"],
      ["GSTR-1 / IFF", "2025-26", "Filed FY 2024/25", "View"],
    );

    expect(
      findMatchingFiledReturnRows(documentRef, SCOPE, { allowFilterBoundScope: true }),
    ).toEqual([]);
  });

  it("rejects an explicit conflicting period before filter-binding a row", () => {
    const documentRef = createTableResultDocument(
      ["Return Type", "Status", "View"],
      ["GSTR-1 / IFF", "Filed Tax Period: May", "View"],
    );

    expect(
      findMatchingFiledReturnRows(documentRef, SCOPE, { allowFilterBoundScope: true }),
    ).toEqual([]);
  });

  it("preserves an exact quarterly-cadence GSTR-3B row", () => {
    const documentRef = createTableResultDocument(
      ["Return Type", "Financial Year", "Tax Period", "Status", "View"],
      ["GSTR-3B", "2025-26", "April", "Return Filing Period: Quarterly", "View"],
    );

    expect(
      findMatchingFiledReturnRows(documentRef, {
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-3B",
      }),
    ).toHaveLength(1);
  });

  it("accepts decorated month values in an explicit Tax Period cell", () => {
    for (const period of ["April 2025", "Apr-2025"]) {
      const documentRef = createTableResultDocument(
        ["Return Type", "Financial Year", "Tax Period", "Status", "View"],
        ["GSTR-1 / IFF", "2025-26", period, "Filed", "View"],
      );

      expect(findMatchingFiledReturnRows(documentRef, SCOPE)).toHaveLength(1);
    }
  });

  it("rejects a decorated explicit period cell containing a conflicting month", () => {
    const documentRef = createTableResultDocument(
      ["Return Type", "Financial Year", "Tax Period", "Status", "View"],
      ["GSTR-1 / IFF", "2025-26", "April / May 2025", "Filed", "View"],
    );

    expect(findMatchingFiledReturnRows(documentRef, SCOPE)).toEqual([]);
  });

  it("ignores ISO filing dates when a dedicated FY cell matches", () => {
    const documentRef = createTableResultDocument(
      ["Return Type", "Financial Year", "Tax Period", "Status", "View"],
      ["GSTR-1 / IFF", "2025-26", "April", "Filed on 2025-04-20", "View"],
    );

    expect(findMatchingFiledReturnRows(documentRef, SCOPE)).toHaveLength(1);
  });

  it("ignores en-dash filing dates when a dedicated FY cell matches", () => {
    const documentRef = createTableResultDocument(
      ["Return Type", "Financial Year", "Tax Period", "Status", "View"],
      ["GSTR-1 / IFF", "2025-26", "April", "Filed on 2025–04–20", "View"],
    );

    expect(findMatchingFiledReturnRows(documentRef, SCOPE)).toHaveLength(1);
  });

  it("rejects a date-shaped value when it is explicitly labeled as FY", () => {
    const documentRef = createTableResultDocument(
      ["Return Type", "Financial Year", "Tax Period", "Status", "View"],
      ["GSTR-1 / IFF", "2025-26", "April", "Filed FY 2025-04-20", "View"],
    );

    expect(findMatchingFiledReturnRows(documentRef, SCOPE)).toEqual([]);
  });

  it("uses the outer result card identity instead of an inner View wrapper", () => {
    const documentRef = createFilterBoundResultDocument();
    const article = documentRef.querySelector("article");
    if (!article) throw new Error("Expected result card.");
    article.innerHTML = `
      <div><h2>GSTR-1 / IFF</h2><button data-view>View</button></div>
      <p>Tax Period: May</p><p>FY 2024/25</p>
    `;

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("does not promote a valid card into its unrelated search-results surface", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef
      .querySelector("section")
      ?.append(" Instructions for GSTR-2B and FY 2024/25 results");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toHaveLength(1);
  });

  it("does not promote a semantic card into an unlabeled outer section", () => {
    const documentRef = createFilterBoundResultDocument();
    const section = documentRef.querySelector("section");
    section?.removeAttribute("aria-label");
    section?.append(" Instructions for GSTR-2B and FY 2024/25 results");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toHaveLength(1);
  });

  it("evaluates identity on an unlabeled section card around an inner View wrapper", () => {
    const documentRef = createFilterBoundResultDocument();
    const section = documentRef.querySelector("section");
    if (!section) throw new Error("Expected result section.");
    section.removeAttribute("aria-label");
    section.innerHTML = `
      <div><h2>GSTR-1 / IFF</h2><button data-view>View</button></div>
      <p>Tax Period: May</p><p>FY 2024/25</p>
    `;

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("does not mistake a result-card class for the surrounding results surface", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef.querySelector("article")?.setAttribute("class", "result-card");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toHaveLength(1);
  });

  it("does not mistake singular search-result item metadata for a results surface", () => {
    for (const value of ["search-result", "search-results-item", "results-card"]) {
      for (const attribute of ["class", "id", "aria-label"]) {
        const documentRef = createFilterBoundResultDocument();
        documentRef.querySelector("article")?.setAttribute(attribute, value);

        expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toHaveLength(1);
      }
    }
  });

  it("recognizes an exact search-results token among unrelated classes", () => {
    const documentRef = createFilterBoundResultDocument();
    const section = documentRef.querySelector("section");
    section?.removeAttribute("aria-label");
    section?.setAttribute("class", "gst-shell search-results ng-scope");
    section?.append(" Instructions for GSTR-2B and FY 2024/25 results");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toHaveLength(1);
  });

  it("does not treat prose mentioning results as a surface name", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef
      .querySelector("article")
      ?.setAttribute("aria-label", "GSTR-1 results for the selected period");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toHaveLength(1);
  });

  it("rejects every conflicting month in labeled card period evidence", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef
      .querySelector("article")
      ?.append(
        " Tax Period: April, additional portal explanatory copy that exceeds the old field cap, then May 2025 FY 2025-26",
      );

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("stops labeled period parsing before Date of Filing", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef
      .querySelector("article")
      ?.append(" Tax Period: April Date of Filing: May 11, 2025 FY 2025-26");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toHaveLength(1);
  });

  it("rejects standalone GSTR-1A while preserving a combined GSTR-1 identity", () => {
    const standalone = createFilterBoundResultDocument();
    const standaloneHeading = standalone.querySelector("article h2");
    if (standaloneHeading) standaloneHeading.textContent = "GSTR-1A";
    expect(findMatchingFilterBoundGstr1Results(standalone, SCOPE)).toEqual([]);

    const combined = createFilterBoundResultDocument();
    const combinedHeading = combined.querySelector("article h2");
    if (combinedHeading) combinedHeading.textContent = "GSTR-1 / IFF / GSTR-1A";
    expect(findMatchingFilterBoundGstr1Results(combined, SCOPE)).toHaveLength(1);
  });

  it("rejects a conflicting space-separated labeled FY", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef.querySelector("article")?.append(" Tax Period: April FY 2024 25");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("rejects another return identity on the outer card around a GSTR-1 View wrapper", () => {
    const documentRef = createFilterBoundResultDocument();
    const article = documentRef.querySelector("article");
    if (!article) throw new Error("Expected result card.");
    article.innerHTML = `
      <div><h2>GSTR-1 / IFF</h2><button data-view>View</button></div>
      <p>Related return: GSTR-12</p>
    `;

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("rejects a GSTR-10 card for a filter-bound GSTR-1 target", () => {
    const documentRef = createFilterBoundResultDocument();
    const heading = documentRef.querySelector("article h2");
    if (heading) heading.textContent = "GSTR-10";

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("rejects a View control inside a hidden result ancestor", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef.querySelector("section")?.setAttribute("hidden", "");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("rejects quarterly cadence on a monthly filter-bound card", () => {
    const documentRef = createFilterBoundResultDocument();
    documentRef
      .querySelector("article")
      ?.append(" Return Filing Period: Quarterly Tax Period: April FY 2025-26");

    expect(findMatchingFilterBoundGstr1Results(documentRef, SCOPE)).toEqual([]);
  });

  it("returns the center of one visible unobscured exact result action", async () => {
    const documentRef = createExactResultDocument(1);
    const view = documentRef.querySelector<HTMLElement>("[data-view='0']");
    if (!view) throw new Error("Expected View control.");
    setLayout(documentRef, view, { left: 100, top: 200, width: 80, height: 40 });

    const result = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(result).toEqual({ ok: true, point: { x: 140, y: 220 } });
  });

  it("refuses to resolve an ambiguous filed result", async () => {
    const documentRef = createExactResultDocument(2);

    const result = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(result).toMatchObject({
      ok: false,
      flowStep: {
        state: "blocked",
        safeSignals: ["filed-return-result-row-ambiguous"],
      },
    });
  });

  it("refuses an obscured or offscreen View action", async () => {
    const documentRef = createExactResultDocument(1);
    const view = documentRef.querySelector<HTMLElement>("[data-view='0']");
    const obstruction = documentRef.querySelector<HTMLElement>("[data-obstruction]");
    if (!view || !obstruction) throw new Error("Expected test controls.");
    setLayout(documentRef, view, { left: 100, top: 200, width: 80, height: 40 }, obstruction);

    const result = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(result).toMatchObject({
      ok: false,
      flowStep: {
        state: "user-action-required",
        safeSignals: expect.arrayContaining(["filed-gstr1-result-view-point-unavailable"]),
      },
    });
  });

  it("preserves a filter-bound card across debugger point preflight and re-resolution", async () => {
    const documentRef = createFilterBoundResultDocument();
    const resultSurface = documentRef.querySelector("section");
    const view = documentRef.querySelector<HTMLElement>("[data-view]");
    if (!resultSurface || !view) throw new Error("Expected filter-bound result controls.");
    resultSurface.remove();
    markFiledReturnsSearchPending(documentRef, SCOPE);
    documentRef.querySelector("main")?.append(resultSurface);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(true);
    setLayout(documentRef, view, { left: 100, top: 200, width: 80, height: 40 });

    const preflight = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);
    const attached = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

    expect(preflight).toEqual({ ok: true, point: { x: 140, y: 220 } });
    expect(attached).toEqual(preflight);
  });

  it("preserves a filter-bound table row after an automatic View attempt expires", async () => {
    const now = vi.spyOn(Date, "now");
    let currentTime = 1_000;
    now.mockImplementation(() => currentTime);
    try {
      const documentRef = createFilterBoundResultDocument("table");
      const resultSurface = documentRef.querySelector("section");
      const view = documentRef.querySelector<HTMLElement>("[data-view]");
      if (!resultSurface || !view) throw new Error("Expected filter-bound result controls.");
      resultSurface.remove();
      markFiledReturnsSearchPending(documentRef, SCOPE);
      documentRef.querySelector("main")?.append(resultSurface);
      expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(false);
      expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(false);
      expect(hasSettledFiledReturnsSearchForScope(documentRef, SCOPE)).toBe(true);

      const clicked = openFiledReturnResultRow(documentRef, SCOPE, true);
      expect(clicked.safeSignals).toContain("filed-return-filter-bound-result-view-clicked");

      currentTime += 3_001;
      setLayout(documentRef, view, { left: 100, top: 200, width: 80, height: 40 });
      const retry = await resolveGstr1FiledReturnViewPoint(documentRef, SCOPE);

      expect(retry).toEqual({ ok: true, point: { x: 140, y: 220 } });
    } finally {
      now.mockRestore();
    }
  });
});

function createExactResultDocument(resultCount: number): Document {
  const dom = new JSDOM(
    `<!doctype html><html><body><main>
      <h1>View Filed Returns</h1>
      <table>
        <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>Status</th><th>View</th></tr></thead>
        <tbody>
          ${Array.from(
            { length: resultCount },
            (_, index) =>
              `<tr><td>GSTR-1 / IFF</td><td>2025-26</td><td>April</td><td>Filed</td><td><button data-view="${index}">View</button></td></tr>`,
          ).join("")}
        </tbody>
      </table>
      <div data-obstruction></div>
    </main></body></html>`,
    { url: "https://return.gst.gov.in/returns/auth/efiledReturns" },
  );
  return dom.window.document;
}

function createTableResultDocument(headers: string[], cells: string[]): Document {
  return new JSDOM(
    `<!doctype html><html><body><main><table>
      <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
      <tbody><tr>${cells
        .map((cell, index) =>
          index === cells.length - 1 ? `<td><button>${cell}</button></td>` : `<td>${cell}</td>`,
        )
        .join("")}</tr></tbody>
    </table></main></body></html>`,
    { url: "https://return.gst.gov.in/returns/auth/efiledReturns" },
  ).window.document;
}

function createFilterBoundResultDocument(surface: "card" | "table" = "card"): Document {
  const result =
    surface === "card"
      ? `<article><h2>GSTR-1 / IFF</h2><p>Filed return</p><button data-view>View</button></article>`
      : `<table><thead><tr><th>Return Type</th><th>Status</th><th>View</th></tr></thead><tbody><tr><td>GSTR-1 / IFF</td><td>Filed</td><td><button data-view>View</button></td></tr></tbody></table>`;
  return new JSDOM(
    `<!doctype html><html><body><main>
      <form name="efiledReturns">
        <label>Financial Year</label><select><option selected>2025-26</option></select>
        <label>Return Filing Period</label><select><option selected>Monthly</option></select>
        <label>Month</label><select><option selected>April</option></select>
        <label>Return Type</label><select><option selected>GSTR-1/IFF/GSTR-1A</option></select>
      </form>
      <section aria-label="Search results">
        ${result}
      </section>
    </main></body></html>`,
    { url: "https://return.gst.gov.in/returns/auth/efiledReturns" },
  ).window.document;
}

function setLayout(
  documentRef: Document,
  view: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
  hitTarget: Element = view,
): void {
  const windowRef = documentRef.defaultView;
  if (!windowRef) throw new Error("Expected window.");
  Object.defineProperty(windowRef, "innerWidth", { configurable: true, value: 1000 });
  Object.defineProperty(windowRef, "innerHeight", { configurable: true, value: 800 });
  view.scrollIntoView = vi.fn();
  view.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  }));
  Object.defineProperty(documentRef, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => hitTarget),
  });
}
