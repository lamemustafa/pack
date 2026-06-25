import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/core/contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import { triggerFiledGstr3bFiledPdfDownload } from "../../src/connectors/gst/filed-returns-download";
import { markFiledReturnsSearchPending } from "../../src/connectors/gst/filed-returns-search-state";

const DEFAULT_SCOPE: FiledReturnsDownloadScope = {
  financialYear: "2025-26",
  period: "March",
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

  it("opens the requested row when GST reorders result columns", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr><th>#</th><th>Acknowledgement Number</th><th>Tax Period</th><th>Financial Year</th><th>Return Type</th><th>View/Download</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>AA1</td><td>February</td><td>2025-26</td><td>GSTR3B</td><td><a href="#february">View</a></td></tr>
            <tr><td>2</td><td>AA2</td><td>March</td><td>2025-26</td><td>GSTR3B</td><td><a href="#march">View</a></td></tr>
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

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "filed-return-result-period:March",
      ]),
    );
    expect(marchClicked).toBe(1);
    expect(februaryClicked).toBe(0);
  });

  it("blocks duplicate matching result rows instead of guessing which period to open", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>Acknowledgement Number</th><th>View/Download</th></tr>
          </thead>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td>AA1</td><td><a href="#first">View</a></td></tr>
            <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td>AA2</td><td><a href="#second">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let clicked = 0;
    for (const link of Array.from(documentRef.querySelectorAll("a"))) {
      link.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-row-ambiguous"]),
    );
    expect(clicked).toBe(0);
  });

  it("treats a settled no-records result as positive not-filed evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result).toMatchObject({
      state: "candidate-not-found",
      safeSignals: expect.arrayContaining(["filed-return-positively-not-filed"]),
    });
    expect(result.safeSignals).not.toContain("filed-return-result-row-not-found");
  });

  it("checks no-record evidence before reselecting an already matching filter form", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select id="finYr"><option selected>2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option selected>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option selected>March</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
    expect(searchClicked).toBe(0);
  });

  it("does not treat stale hidden no-record text as positive not-filed evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p style="display: none">No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not treat no-record text while loading as positive not-filed evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results" aria-busy="true">
          <p>Loading...</p>
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed when a matching result row exists with a no-record footer", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <table>
            <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
            <tbody>
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><a href="#view">View</a></td></tr>
            </tbody>
          </table>
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked"]),
    );
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(viewClicked).toBe(1);
  });

  it("does not mark not-filed when a matching result row exists outside the no-record panel", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Prior result status">
          <p>No records found</p>
        </section>
        <section aria-label="Search results">
          <table>
            <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
            <tbody>
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><a href="#view">View</a></td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked"]),
    );
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(viewClicked).toBe(1);
  });

  it("does not mark not-filed when a matching result row has an accessible icon action", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Prior result status">
          <p>No records found</p>
        </section>
        <section aria-label="Search results">
          <table>
            <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
            <tbody>
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><button aria-label="View"></button></td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    let viewClicked = 0;
    documentRef.querySelector("button[aria-label='View']")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-result-view-clicked"]),
    );
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(viewClicked).toBe(1);
  });

  it("verifies native month selection before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>February</option><option>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("verifies custom month selection before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div><label>Financial Year</label><select id="finYr"><option selected>2025-26</option></select></div>
          <div><label>Return Filing Period</label><select id="optValue"><option selected>Monthly</option></select></div>
          <div><span>Month</span><button type="button" data-month>March</button></div>
          <div><label>Return Type</label><select id="retTyp"><option selected>GSTR3B</option></select></div>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
  });

  it("rejects no-record evidence when the custom month selection differs", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div><label>Financial Year</label><select id="finYr"><option selected>2025-26</option></select></div>
          <div><label>Return Filing Period</label><select id="optValue"><option selected>Monthly</option></select></div>
          <div><span>Month</span><button type="button" data-month>February</button></div>
          <div><label>Return Type</label><select id="retTyp"><option selected>GSTR3B</option></select></div>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("requires a present month control before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed from a stale no-record panel without a submitted-search marker", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed from a stale no-record panel before the search result settles", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select id="finYr"><option selected>2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option selected>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option selected>March</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option selected>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);

    const firstResult = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
    const secondResult = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(firstResult.state).toBe("clicked");
    expect(secondResult.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not mark not-filed from non-filed-returns GST pages", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>Other GST Search</h1>
        <form>
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>March</option></select>
          <select id="retTyp"><option selected>GSTR3B</option></select>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("scopes the final search click to the filed-return filter form", async () => {
    const documentRef = createDocument(`
      <main>
        <button data-unrelated-search type="button">Search</button>
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr"><option>Select</option><option>2025-26</option></select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option>Monthly</option></select>
          </div>
          <div>
            <label>Month</label>
            <select id="month"><option>Select</option><option>March</option></select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          </div>
          <input id="lotsearch" type="button" value="Search" />
        </form>
      </main>
    `);
    let unrelatedClicked = 0;
    let formSearchClicked = 0;
    documentRef.querySelector("[data-unrelated-search]")?.addEventListener("click", () => {
      unrelatedClicked += 1;
    });
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      formSearchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["financial-year-selected", "month-selected", "search-clicked"]),
    );
    expect(unrelatedClicked).toBe(0);
    expect(formSearchClicked).toBe(1);
  });

  it("preflights the filed PDF download without clicking from the retryable step", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr3b-download-ready",
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
    expect(downloadClicked).toBe(0);
  });

  it("parses colon and line-separated detail identity from the download detail component", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <aside>
          <p>Financial Year - 2024-25</p>
          <p>Return Period - February</p>
        </aside>
        <section>
          <h1>GSTR-3B - Monthly Return</h1>
          <div>Status - Filed</div>
          <dl>
            <dt>Financial Year:</dt>
            <dd>2025-26</dd>
            <dt>Return Period</dt>
            <dd>March</dd>
          </dl>
          <button>DOWNLOAD FILED GSTR-3B</button>
        </section>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:March",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
    expect(result.safeSignals).not.toContain("filed-return-detail-period:February");
    expect(result.safeSignals).not.toContain("filed-return-detail-financial-year:2024-25");
  });

  it("refuses an explicit trigger when the detail page identity does not match the target", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - February</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    let downloadClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const trigger = triggerFiledGstr3bFiledPdfDownload as unknown as (
      documentRef: Document,
      target: {
        actionId: string;
        financialYear: string;
        period: string;
        returnType: "GSTR-3B";
      },
    ) => ReturnType<typeof triggerFiledGstr3bFiledPdfDownload>;

    const result = await trigger(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:February",
        "filed-return-download-target-mismatch",
      ]),
    );
    expect(downloadClicked).toBe(0);
  });

  it("refuses an explicit trigger when the detail page has duplicate visible download controls", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button data-primary>DOWNLOAD FILED GSTR-3B</button>
        <button data-secondary>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let clicked = 0;
    for (const button of Array.from(documentRef.querySelectorAll("button"))) {
      button.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const trigger = triggerFiledGstr3bFiledPdfDownload as unknown as (
      documentRef: Document,
      target: {
        actionId: string;
        financialYear: string;
        period: string;
        returnType: "GSTR-3B";
      },
    ) => ReturnType<typeof triggerFiledGstr3bFiledPdfDownload>;

    const result = await trigger(documentRef, {
      actionId: "test-action",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-3B",
    });

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr3b-download-candidate-ambiguous"]),
    );
    expect(clicked).toBe(0);
  });

  it("returns from a mismatched detail page before running the requested exact period", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
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
      period: "February",
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

  it("does not choose a matching custom option from an unrelated page overlay", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <button data-unrelated-option role="option">Monthly</button>
        <section>
          <div>
            <span>Financial Year</span>
            <button data-field="financial-year">2025-26</button>
          </div>
          <div>
            <span>Return Filing Period</span>
            <button data-field="period" aria-controls="period-options">Select</button>
          </div>
          <div>
            <span>Return Type</span>
            <button data-field="return-type" aria-controls="return-type-options">Select</button>
          </div>
          <button data-search>Search</button>
        </section>
      </main>
    `);
    makeLayoutVisible(documentRef);
    const period = documentRef.querySelector<HTMLElement>("[data-field='period']");
    const returnType = documentRef.querySelector<HTMLElement>("[data-field='return-type']");
    let unrelatedClicked = 0;
    let searchClicked = 0;

    documentRef.querySelector("[data-unrelated-option]")?.addEventListener("click", () => {
      unrelatedClicked += 1;
    });
    period?.addEventListener("click", () => {
      appendOwnedOption(documentRef, "period-options", "March", () => {
        period.textContent = "March";
      });
    });
    returnType?.addEventListener("click", () => {
      appendOwnedOption(documentRef, "return-type-options", "GSTR-3B", () => {
        returnType.textContent = "GSTR-3B";
      });
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["period-selected", "return-type-selected", "search-clicked"]),
    );
    expect(unrelatedClicked).toBe(0);
    expect(searchClicked).toBe(1);
  });

  it("continues past an earlier labelled select that does not contain the requested option", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select data-stale-fy><option>2024-25</option></select>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select id="finYr"><option>Select</option><option>2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option><option>March</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2025-26");
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

function appendOwnedOption(documentRef: Document, id: string, text: string, onClick: () => void) {
  const listbox = documentRef.createElement("div");
  listbox.id = id;
  listbox.setAttribute("role", "listbox");
  const option = documentRef.createElement("button");
  option.setAttribute("role", "option");
  option.textContent = text;
  option.addEventListener("click", () => {
    onClick();
    listbox.remove();
  });
  listbox.append(option);
  documentRef.body.append(listbox);
}

function appendNativeOption(documentRef: Document, select: HTMLSelectElement | null, text: string) {
  const option = documentRef.createElement("option");
  option.textContent = text;
  option.value = text;
  select?.append(option);
}

function markPackSubmittedSearch(documentRef: Document, scope: FiledReturnsDownloadScope) {
  const settledContainers = detachSettledResults(documentRef);
  markFiledReturnsSearchPending(documentRef, scope);
  for (const container of settledContainers) {
    container.parent.append(container.element);
  }
}

function detachSettledResults(documentRef: Document): Array<{ parent: Element; element: Element }> {
  const selectors = [
    "[aria-label*='result' i]",
    "[id*='result' i]",
    "[class*='result' i]",
    "table",
  ].join(",");
  return Array.from(documentRef.querySelectorAll(selectors))
    .filter((element) => element.parentElement)
    .map((element) => {
      const parent = element.parentElement as Element;
      element.remove();
      return { parent, element };
    });
}
