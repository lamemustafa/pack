import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";

const DEFAULT_SCOPE: FiledReturnsDownloadScope = {
  financialYear: "2025-26",
  period: "March",
  returnType: "GSTR-3B",
};

const FULL_YEAR_SCOPE: FiledReturnsDownloadScope = {
  financialYear: "2025-26",
  period: "ALL",
  returnType: "GSTR-3B",
};

describe("filed returns guided flow", () => {
  it("selects the requested filing filters and clicks search", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option>2024-25</option><option>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option>February</option><option>March</option></select>
        <label>Return Type</label>
        <select><option>GSTR-1</option><option>GSTR-3B</option></select>
        <button>Search</button>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-filters-selected",
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects native GST form controls by field label and waits for dependent return types", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <section>
          <div>
            <p>Financial year</p>
            <select data-field="financial-year">
              <option>Select</option>
              <option>2025-26</option>
            </select>
          </div>
          <div>
            <p>Return Filing Period</p>
            <select data-field="period">
              <option>Select</option>
              <option>February</option>
              <option>March</option>
            </select>
          </div>
          <div>
            <p>Return Type</p>
            <select data-field="return-type">
              <option>Select</option>
            </select>
          </div>
          <button data-search>Search</button>
        </section>
      </main>
    `);
    const period = documentRef.querySelector<HTMLSelectElement>("[data-field='period']");
    const returnType = documentRef.querySelector<HTMLSelectElement>("[data-field='return-type']");
    const eventLog: string[] = [];
    let searchClicked = 0;

    for (const field of [period, returnType]) {
      for (const eventName of ["focus", "input", "change", "blur"]) {
        field?.addEventListener(eventName, () => {
          eventLog.push(`${field.dataset.field}:${eventName}`);
        });
      }
    }
    period?.addEventListener("change", () => {
      globalThis.setTimeout(() => {
        const option = documentRef.createElement("option");
        option.textContent = "GSTR-3B";
        option.value = "GSTR-3B";
        returnType?.append(option);
      }, 100);
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(period?.value).toBe("March");
    expect(returnType?.value).toBe("GSTR-3B");
    expect(eventLog).toEqual(
      expect.arrayContaining([
        "period:focus",
        "period:input",
        "period:change",
        "period:blur",
        "return-type:focus",
        "return-type:input",
        "return-type:change",
        "return-type:blur",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects the GST filed-returns frequency field before searching for the monthly GSTR-3B row", async () => {
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div>
          <label>Financial year</label>
          <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
            <option>Select</option>
            <option>2026-27</option>
            <option>2025-26</option>
            <option>2024-25</option>
          </select>
        </div>
        <div>
          <label>Return Filing Period</label>
          <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
            <option>Select</option>
            <option>Annual</option>
            <option>Half Yearly</option>
            <option>Quarterly</option>
            <option>Monthly</option>
          </select>
        </div>
        <div>
          <label>Return Type</label>
          <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
            <option>Select</option>
            <option>GSTR1</option>
            <option>GSTR3B</option>
            <option>CMP08</option>
          </select>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2025-26");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("GSTR3B");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("leaves the month field unselected when searching the entire financial year", async () => {
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div>
          <label>Financial year</label>
          <select id="finYr">
            <option>Select</option>
            <option>2025-26</option>
          </select>
        </div>
        <div>
          <label>Return Filing Period</label>
          <select id="optValue">
            <option>Select</option>
            <option>Monthly</option>
          </select>
        </div>
        <div>
          <label>Month</label>
          <select id="month">
            <option>Select</option>
            <option>March</option>
          </select>
        </div>
        <div>
          <label>Return Type</label>
          <select id="retTyp">
            <option>Select</option>
            <option>GSTR3B</option>
          </select>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, FULL_YEAR_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#month")?.value).toBe("Select");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "period-selected",
        "month-left-unselected-for-financial-year",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(result.safeSignals).not.toContain("month-selected");
    expect(searchClicked).toBe(1);
  });

  it("waits for GST Angular controls to repopulate after selecting the financial year", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option>2026-27</option>
              <option>2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Month</label>
            <select id="month" data-ng-model="efiledReturns_month_val">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const financialYear = documentRef.querySelector<HTMLSelectElement>("#finYr");
      const period = documentRef.querySelector<HTMLSelectElement>("#optValue");
      const month = documentRef.querySelector<HTMLSelectElement>("#month");
      const returnType = documentRef.querySelector<HTMLSelectElement>("#retTyp");
      let searchClicked = 0;

      financialYear?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(documentRef, period, "Annual");
          appendNativeOption(documentRef, period, "Monthly");
        }, 1_300);
      });
      period?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(documentRef, month, "February");
          appendNativeOption(documentRef, month, "March");
        }, 1_300);
      });
      month?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(documentRef, returnType, "GSTR1");
          appendNativeOption(documentRef, returnType, "GSTR3B");
        }, 1_300);
      });
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(financialYear?.value).toBe("2025-26");
      expect(period?.value).toBe("Monthly");
      expect(month?.value).toBe("March");
      expect(returnType?.value).toBe("GSTR3B");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "month-selected",
          "return-type-selected",
          "search-clicked",
        ]),
      );
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the filed GSTR-3B result row for the requested period", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR-3B</td><td>2024-25</td><td>March</td><td><button>View</button></td></tr>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><a href="#view">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    const gstr1View = documentRef.querySelector("button");
    const gstr3bView = documentRef.querySelector("a");
    let gstr1Clicked = 0;
    let gstr3bClicked = 0;
    gstr1View?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    gstr3bView?.addEventListener("click", () => {
      gstr3bClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked", "result-row-gstr3b"]),
    );
    expect(gstr1Clicked).toBe(0);
    expect(gstr3bClicked).toBe(1);
  });

  it("opens the next unprocessed result row for an entire financial year search", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>Acknowledgement Number</th><th>View/Download</th></tr>
          </thead>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td>AA1</td><td><a href="#march">View</a></td></tr>
            <tr><td>GSTR3B</td><td>2025-26</td><td>February</td><td>AA2</td><td><a href="#february">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    const marchView = documentRef.querySelector<HTMLAnchorElement>("a[href='#march']");
    const februaryView = documentRef.querySelector<HTMLAnchorElement>("a[href='#february']");
    let marchClicked = 0;
    let februaryClicked = 0;
    marchView?.addEventListener("click", () => {
      marchClicked += 1;
    });
    februaryView?.addEventListener("click", () => {
      februaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...FULL_YEAR_SCOPE,
      completedPeriods: ["March"],
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "filed-return-result-period:February",
      ]),
    );
    expect(marchClicked).toBe(0);
    expect(februaryClicked).toBe(1);
  });

  it("moves to the next results page after visible full-year rows are complete", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>Acknowledgement Number</th><th>View/Download</th></tr>
          </thead>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td>AA1</td><td><a>View</a></td></tr>
          </tbody>
        </table>
        <ul class="pagination ng-table-pagination">
          <li class="page-item active"><a class="page-link">1</a></li>
          <li class="page-item"><a class="page-link" data-next>»</a></li>
        </ul>
      </main>
    `);
    let nextClicked = 0;
    documentRef.querySelector("[data-next]")?.addEventListener("click", () => {
      nextClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...FULL_YEAR_SCOPE,
      completedPeriods: ["March"],
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-results-next-page-clicked"]),
    );
    expect(nextClicked).toBe(1);
  });

  it("triggers the filed PDF download when the detail page is ready", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Return Period - March</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr3b-download-clicked", "filed-return-detail-period:March"]),
    );
    expect(downloadClicked).toBe(1);
  });

  it("returns from an already downloaded full-year detail page without redownloading", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Return Period - March</div>
        <button>BACK</button>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    let backClicked = 0;
    let downloadClicked = 0;
    const [backButton, downloadButton] = Array.from(documentRef.querySelectorAll("button"));
    backButton?.addEventListener("click", () => {
      backClicked += 1;
    });
    downloadButton?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...DEFAULT_SCOPE,
      period: "ALL",
      completedPeriods: ["March"],
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-detail-back-clicked"]),
    );
    expect(backClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("handles scoped custom dropdown controls without leaving the filter form", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <section>
          <div>
            <span>Financial Year</span>
            <button data-field="financial-year">2025-26</button>
          </div>
          <div>
            <span>Return Filing Period</span>
            <button data-field="period">Select</button>
          </div>
          <div>
            <span>Return Type</span>
            <button data-field="return-type">Select</button>
          </div>
          <button data-search>Search</button>
        </section>
      </main>
    `);
    makeLayoutVisible(documentRef);
    const period = documentRef.querySelector<HTMLElement>("[data-field='period']");
    const returnType = documentRef.querySelector<HTMLElement>("[data-field='return-type']");
    let searchClicked = 0;

    period?.addEventListener("click", () => {
      appendOption(documentRef, "March", () => {
        period.textContent = "March";
      });
    });
    returnType?.addEventListener("click", () => {
      appendOption(documentRef, "GSTR-3B", () => {
        returnType.textContent = "GSTR-3B";
      });
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "financial-year-selected",
        "period-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("does not click unrelated controls when the filter widgets cannot be resolved", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <button data-logout>Logout</button>
        <section>
          <p>
            To view records, click Search post selection of Financial Year and
            Return Type. Please do not select any value in Return Filing Period.
          </p>
          <button data-search>Search</button>
        </section>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let logoutClicked = 0;
    documentRef.querySelector("[data-logout]")?.addEventListener("click", () => {
      logoutClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(logoutClicked).toBe(0);
  });

  it("does not change unrelated native selects outside the filed-return form", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <aside>
          <select data-unrelated>
            <option>Select</option>
            <option>March</option>
          </select>
        </aside>
        <section>
          <p>Financial Year</p>
          <p>Return Filing Period</p>
          <p>Return Type</p>
          <button data-search>Search</button>
        </section>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-unrelated]")?.value).toBe("Select");
  });
});

function createDocument(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    pretendToBeVisual: true,
  }).window.document;
}

function makeLayoutVisible(documentRef: Document) {
  Object.defineProperty(documentRef.defaultView?.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 10,
      height: 10,
      left: 0,
      right: 10,
      top: 0,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function appendOption(documentRef: Document, text: string, onClick: () => void) {
  const option = documentRef.createElement("button");
  option.setAttribute("role", "option");
  option.textContent = text;
  option.addEventListener("click", () => {
    onClick();
    option.remove();
  });
  documentRef.body.append(option);
}

function appendNativeOption(documentRef: Document, select: HTMLSelectElement | null, text: string) {
  const option = documentRef.createElement("option");
  option.textContent = text;
  option.value = text;
  select?.append(option);
}
