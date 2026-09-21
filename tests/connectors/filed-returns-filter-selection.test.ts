import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  readFilterSelectionState,
  FINANCIAL_YEAR_LABEL,
  RETURN_TYPE_LABEL,
  acceptedReturnTypeOptions,
  selectFieldOption,
  waitForFieldSelection,
} from "../../src/connectors/gst/filed-returns-filter-selection";

describe("filed-return filter selection", () => {
  it("allows GST dependent controls to settle after a selected financial year", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = new JSDOM(`
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select id="finYr"><option selected>2026-27</option></select>
        </form>
      `).window.document;
      let settled = false;
      const selection = waitForFieldSelection(documentRef, FINANCIAL_YEAR_LABEL, ["2026-27"]).then(
        () => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await selection;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not select GSTR-10 for a requested GSTR-1 return", async () => {
    const documentRef = new JSDOM(`
      <form name="efiledReturns">
        <label>Return Type</label>
        <select id="retTyp">
          <option>Select</option>
          <option>GSTR-10</option>
          <option>GSTR-1A</option>
          <option>GSTR-1/IFF/GSTR-1A</option>
        </select>
      </form>
    `).window.document;

    await expect(
      selectFieldOption(
        documentRef,
        RETURN_TYPE_LABEL,
        acceptedReturnTypeOptions({
          financialYear: "2025-26",
          period: "April",
          returnType: "GSTR-1",
        }),
      ),
    ).resolves.toBe(true);
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe(
      "GSTR-1/IFF/GSTR-1A",
    );
  });
});

// Live, 2026-09-21: on a taxpayer whose filed-return API search returned nothing, GSTR-3B April
// stopped at the dropdowns for every retry. A qualification probe showed every field's selected
// text read twice ("gstr3bgstr3b"): the reader joined `innerText` and `textContent`, which a browser
// both fills. The loose matchers still passed; the exact return-type matcher never did. jsdom has no
// `innerText`, which is why no test saw it -- this one gives options a browser-like `innerText`.
describe("reading a selected option as a browser renders it", () => {
  it("confirms an already-selected GSTR-3B return type when options expose innerText", () => {
    const dom = new JSDOM(`
      <form name="efiledReturns">
        <div class="col-sm-3"><div><label>Financial year</label></div>
          <div class="col-sm-12"><select id="finYr" ng-model="efiledReturns_financialYear_val"><option>Select</option><option selected>2025-26</option></select></div></div>
        <div class="col-sm-3"><div><label>Return Filing Period</label></div>
          <div class="col-sm-12"><select id="optValue" ng-model="efiledReturns_filingPeriod_val"><option>Select</option><option selected>Monthly</option></select></div></div>
        <div class="col-sm-3"><div><label>Month</label></div>
          <div class="col-sm-12"><select ng-model="efiledReturns_months_val"><option>Select</option><option selected>April</option></select></div></div>
        <div class="col-sm-3"><div><label>Return Type</label></div>
          <div class="col-sm-12"><select id="retTyp" ng-model="efiledReturns_gstValue_val"><option>Select</option><option>GSTR-1/IFF/GSTR-1A</option><option selected>GSTR3B</option></select></div></div>
        <button type="button">SEARCH</button>
      </form>
    `);
    Object.defineProperty(
      (dom.window as unknown as typeof globalThis).HTMLElement.prototype,
      "innerText",
      {
        configurable: true,
        get(this: HTMLElement) {
          return this.textContent ?? "";
        },
      },
    );

    expect(
      readFilterSelectionState(dom.window.document, {
        artifactType: "PDF",
        financialYear: "2025-26",
        period: "April",
        returnType: "GSTR-3B",
      }),
    ).toEqual({
      financialYearSelected: true,
      periodSelected: true,
      monthFieldPresent: true,
      monthSelected: true,
      returnTypeSelected: true,
    });
  });
});
