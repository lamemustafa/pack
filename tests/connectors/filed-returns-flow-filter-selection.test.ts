import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import {
  DEFAULT_SCOPE,
  createDocument,
  createGstDocument,
  makeLayoutVisible,
  appendOption,
  appendOwnedOption,
  appendNativeOption,
  stubFiledReturnsApi,
  stubFormSubmit,
} from "./filed-returns-flow.test-helpers";

describe("filed returns flow — filter selection and API search", () => {
  it("uses the filed-return API before slow dependent dropdown selection on the GST route", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option>2026-27</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [{ rtntype: "GSTR3B", fy: "2026-27", taxp: "May", arn: "SYNTHETIC", dof: "" }],
    });
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("Select");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("Select");
    expect(searchClicked).toBe(0);
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
  });

  it("uses the filed-return API from a different GSTR-3B detail page", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-3B - Monthly Return</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Return Period - April</p>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr3b",
    );
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [{ rtntype: "GSTR3B", fy: "2025-26", taxp: "May" }],
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-3B",
    });

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining(["filed-return-api-result-posted"]),
    });
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
  });

  it("uses monthly preference for pre-quarterly GSTR-3B API handoff when role status omits userPref", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option>2020-21</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2020-21",
      period: "December",
      returnType: "GSTR-3B",
    };
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: {},
      rows: [{ rtntype: "GSTR3B", fy: "2020-21", taxp: "December" }],
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBe("122020");
    expect(documentRef.defaultView?.localStorage.getItem("uPref")).toBe("M");
    expect(documentRef.defaultView?.localStorage.getItem("gstr3bPref")).toBe("M");
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
  });

  it("uses the filed-return API when the GST route casing changes", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <form name="efiledReturns">
            <label>Financial year</label>
            <select id="finYr"><option>Select</option><option>2025-26</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option>Monthly</option></select>
            <label>Month</label>
            <select id="month"><option>Select</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/efiledreturns",
    );
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [{ rtntype: "GSTR3B", fy: "2025-26", taxp: "March", arn: "SYNTHETIC", dof: "" }],
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
  });

  it("opens filed-return API rows when GST wraps data and varies field names", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option>2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option>Monthly</option></select>
          <label>Month</label>
          <select id="month"><option>Select</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option>GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      </main>
    `);
    const submittedForms = stubFormSubmit(documentRef);
    stubFiledReturnsApi(documentRef, {
      roleStatus: { data: { userPref: "M" } },
      rows: {
        data: [
          {
            rtnTyp: "GSTR3B",
            financialYear: "2025-26",
            taxPeriod: "March",
            ackNo: "SYNTHETIC",
            dateOfFiling: "18/04/2025",
          },
        ],
      },
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["filed-return-api-result-posted"]));
    expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
    expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBe("032026");
    const efileData = documentRef.defaultView?.localStorage.getItem("efile_data") ?? "";
    expect(efileData).toContain("March");
    expect(efileData).not.toContain("SYNTHETIC");
    expect(efileData).not.toContain("18/04/2025");
  });

  it("falls back to visible filter selection when the GST API returns no matching rows", async () => {
    const documentRef = createGstDocument(`
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
    stubFiledReturnsApi(documentRef, {
      roleStatus: { userPref: "M" },
      rows: [],
    });
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
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
    expect(result.safeSignals).not.toContain("filed-return-api-result-not-found");
    expect(searchClicked).toBe(1);
  });

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

  it("selects monthly frequency and month before searching for a GSTR-1 row", async () => {
    const mayGstr1Scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div>
          <label>Financial year</label>
          <select id="finYr" title="Select Financial Year">
            <option>Select</option>
            <option value="string:2025-26">2025-26</option>
          </select>
        </div>
        <div>
          <label>Return Filing Period</label>
          <select id="optValue" title="Return Filing Period">
            <option>Select</option>
            <option value="string:Annual">Annual</option>
            <option value="string:Quarterly">Quarterly</option>
            <option value="string:Monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label>Month</label>
          <select id="taxPeriodValue" title="Month">
            <option>Select</option>
            <option value="string:April">April</option>
            <option value="string:May">May</option>
          </select>
        </div>
        <div>
          <label>Return Type</label>
          <select id="retTyp" title="Return Type">
            <option>Select</option>
            <option value="string:GSTR1">GSTR1</option>
            <option value="string:GSTR3B">GSTR3B</option>
          </select>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, mayGstr1Scope);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("string:Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("#taxPeriodValue")?.value).toBe(
      "string:May",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("string:GSTR1");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "period-selected",
        "month-selected",
        "return-type-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects a visible GST month select by title when the generated id changes", async () => {
    const mayScope: FiledReturnsDownloadScope = {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div class="row">
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Financial year</label></div>
            <div class="col-sm-12">
              <select id="finYr" title="Select Financial Year" data-ng-model="efiledReturns_financialYear_val">
                <option>Select</option>
                <option value="string:2026-27">2026-27</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Filing Period</label></div>
            <div class="col-sm-12">
              <select id="optValue" title="Return Filing Period" data-ng-model="efiledReturns_filingPeriod_val">
                <option>Select</option>
                <option value="string:Monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12">Month</div>
            <div class="col-sm-12">
              <select id="taxPeriodValue" title="Month" data-ng-model="efiledReturns_taxPeriod_val">
                <option>Select</option>
                <option value="string:April">April</option>
                <option value="string:May">May</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Type</label></div>
            <div class="col-sm-12">
              <select id="retTyp" title="Return Type" data-ng-model="efiledReturns_gstValue_val">
                <option>Select</option>
                <option value="string:GSTR3B">GSTR3B</option>
              </select>
            </div>
          </div>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, mayScope);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#taxPeriodValue")?.value).toBe(
      "string:May",
    );
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["month-selected", "search-clicked"]),
    );
    expect(searchClicked).toBe(1);
  });

  it("selects the month select between period and return type when GST omits stable month metadata", async () => {
    const mayScope: FiledReturnsDownloadScope = {
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-3B",
    };
    const documentRef = createDocument(`
      <form name="efiledReturns">
        <h1>View Filed Returns</h1>
        <div class="row">
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Financial year</label></div>
            <div class="col-sm-12">
              <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
                <option>Select</option>
                <option value="string:2026-27">2026-27</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Filing Period</label></div>
            <div class="col-sm-12">
              <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
                <option>Select</option>
                <option value="string:Monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12">Month</div>
            <div class="col-sm-12">
              <select id="periodValue">
                <option>Select</option>
                <option value="string:April">April</option>
                <option value="string:May">May</option>
              </select>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="col-sm-12"><label>Return Type</label></div>
            <div class="col-sm-12">
              <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
                <option>Select</option>
                <option value="string:GSTR3B">GSTR3B</option>
              </select>
            </div>
          </div>
        </div>
        <button id="lotsearch" type="button">Search</button>
      </form>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, mayScope);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#periodValue")?.value).toBe("string:May");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["month-selected", "search-clicked"]),
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

  it("retries month selection after GST populates month options from return type selection", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2026-27">2026-27</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      };
      const returnType = documentRef.querySelector<HTMLSelectElement>("#retTyp");
      let searchClicked = 0;

      returnType?.addEventListener("change", () => {
        globalThis.setTimeout(() => {
          appendNativeOption(
            documentRef,
            documentRef.querySelector<HTMLSelectElement>("#periodValue"),
            "April",
          );
          appendNativeOption(
            documentRef,
            documentRef.querySelector<HTMLSelectElement>("#periodValue"),
            "May",
          );
        }, 1_300);
      });
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(documentRef.querySelector<HTMLSelectElement>("#periodValue")?.value).toBe("May");
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

  it("keeps portal option text out of the pending month-selection status", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2026-27">2026-27</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue">
              <option>Synthetic Taxpayer GSTIN 00XXXXX0000X0Z0</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "return-type-selected",
        ]),
      );
      expect(result.safeSignals).not.toContain("month-selected");
      expect(result.safeMessage).toContain("Missing: month selection still pending.");
      expect(result.safeMessage).not.toContain("00XXXXX0000X0Z0");
      expect(result.safeMessage).not.toContain("Synthetic Taxpayer");
      expect(searchClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("opens the filed return through the GST API when the month dropdown stays stuck", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2025-26">2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue" title="Month">
              <option>Select</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const submittedForms = stubFormSubmit(documentRef);
      stubFiledReturnsApi(documentRef, {
        rows: [
          {
            rtntype: "GSTR3B",
            fy: "2025-26",
            taxp: "March",
            arn: "synthetic-arn",
            dof: "18/04/2025",
          },
        ],
        roleStatus: { userPref: "Q" },
      });
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(45_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-return-api-searched",
          "filed-return-api-result-found",
          "filed-return-api-result-posted",
          "filed-return-result-period:March",
        ]),
      );
      expect(searchClicked).toBe(0);
      expect(submittedForms).toEqual([{ action: "/returns/auth/gstr3b", method: "POST" }]);
      expect(documentRef.defaultView?.localStorage.getItem("rtn_prd")).toBe("032026");
      expect(documentRef.defaultView?.localStorage.getItem("gstr3bPref")).toBe("Q");
      expect(documentRef.defaultView?.sessionStorage.getItem("viewFiled")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("blocks GSTR-3B acquisition when the API detail handoff cannot verify role status", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2025-26">2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue" title="Month">
              <option>Select</option>
              <option value="string:March">March</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      stubFiledReturnsApi(documentRef, {
        rows: [
          {
            rtntype: "GSTR3B",
            fy: "2025-26",
            taxp: "March",
            arn: "synthetic-arn",
            dof: "18/04/2025",
          },
        ],
        roleStatus: null,
      });
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(47_000);
      const result = await resultPromise;

      expect(result.state).toBe("blocked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-return-api-searched",
          "filed-return-api-result-found",
          "filed-return-api-result-role-status-unavailable",
        ]),
      );
      expect(searchClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("blocks GSTR-3B acquisition when a quarterly-era role response omits user preference", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <label>Financial year</label>
          <select id="finYr"><option>Select</option><option value="string:2025-26">2025-26</option></select>
          <label>Return Filing Period</label>
          <select id="optValue"><option>Select</option><option value="string:Monthly">Monthly</option></select>
          <select id="periodValue" title="Month"><option>Select</option><option value="string:March">March</option></select>
          <label>Return Type</label>
          <select id="retTyp"><option>Select</option><option value="string:GSTR3B">GSTR3B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      stubFiledReturnsApi(documentRef, {
        rows: [{ rtntype: "GSTR3B", fy: "2025-26", taxp: "March" }],
        roleStatus: {},
      });
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(47_000);
      const result = await resultPromise;

      expect(result.state).toBe("blocked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining(["filed-return-api-result-role-status-unavailable"]),
      );
      expect(searchClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  it("waits for GST dependent field resets before searching", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <form name="efiledReturns">
          <h1>View Filed Returns</h1>
          <div>
            <label>Financial year</label>
            <select id="finYr" data-ng-model="efiledReturns_financialYear_val">
              <option>Select</option>
              <option value="string:2026-27">2026-27</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select id="optValue" data-ng-model="efiledReturns_filingPeriod_val">
              <option>Select</option>
              <option value="string:Monthly">Monthly</option>
            </select>
          </div>
          <div>
            <div>Month</div>
            <select id="periodValue" title="Month">
              <option>Select</option>
              <option value="string:May">May</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select id="retTyp" data-ng-model="efiledReturns_gstValue_val">
              <option>Select</option>
              <option value="string:GSTR3B">GSTR3B</option>
            </select>
          </div>
          <button id="lotsearch" type="button">Search</button>
        </form>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-3B",
      };
      const month = documentRef.querySelector<HTMLSelectElement>("#periodValue");
      const returnType = documentRef.querySelector<HTMLSelectElement>("#retTyp");
      let resetReturnType = true;
      let searchClicked = 0;

      month?.addEventListener("change", () => {
        if (!resetReturnType) return;
        resetReturnType = false;
        globalThis.setTimeout(() => {
          if (!returnType) return;
          returnType.value = "Select";
          returnType.selectedIndex = 0;
          returnType.dispatchEvent(new documentRef.defaultView!.Event("change", { bubbles: true }));
        }, 700);
      });
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(month?.value).toBe("string:May");
      expect(returnType?.value).toBe("string:GSTR3B");
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

  it("selects GSTR-1 filing period when the page instruction belongs to unrelated forms", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <main>
          <h1>View Filed Returns</h1>
          <p>
            To view the filed GST ITC-01/02A/03 forms, please click on Search post selection of
            Financial Year and Return Type. Please do not select any value in Return Filing Period.
          </p>
          <form name="efiledReturns">
            <label>Financial Year</label>
            <select id="finYr"><option>Select</option><option>2026-27</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option>Monthly</option></select>
            <label>Month</label>
            <select id="month"><option>Select</option><option>May</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR-1/IFF/GSTR-1A</option></select>
            <button id="lotsearch" type="button">Search</button>
          </form>
        </main>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-1",
      };
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "financial-year-selected",
          "period-selected",
          "month-selected",
          "return-type-selected",
          "search-clicked",
        ]),
      );
      expect(result.safeSignals).not.toContain("return-filing-period-left-unselected");
      expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("2026-27");
      expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Monthly");
      expect(documentRef.querySelector<HTMLSelectElement>("#month")?.value).toBe("May");
      expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe(
        "GSTR-1/IFF/GSTR-1A",
      );
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a stale isolated-world filing period when GSTR-2B requires it blank", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(`
        <main>
          <h1>View Filed Returns</h1>
          <p>For GSTR-2B, please do not select any value in Return Filing Period.</p>
          <form name="efiledReturns">
            <label>Financial Year</label>
            <select id="finYr"><option>Select</option><option>2026-27</option></select>
            <label>Return Filing Period</label>
            <select id="optValue"><option>Select</option><option selected>Monthly</option></select>
            <label>Return Type</label>
            <select id="retTyp"><option>Select</option><option>GSTR-2B</option></select>
            <button id="lotsearch" type="button">Search</button>
          </form>
        </main>
      `);
      const scope: FiledReturnsDownloadScope = {
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };
      let searchClicked = 0;
      documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
        searchClicked += 1;
      });

      const resultPromise = runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.state).toBe("clicked");
      expect(result.safeSignals).toContain("return-filing-period-left-unselected");
      expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("Select");
      expect(searchClicked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects stable GST native selects when labels and selects are split across columns", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div class="row">
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Financial year</label></div>
              <div class="col-sm-12">
                <select id="finYr">
                  <option value="string:Select">Select</option>
                  <option value="string:2025-26">2025-26</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Filing Period</label></div>
              <div class="col-sm-12">
                <select id="optValue">
                  <option value="string:Select">Select</option>
                  <option value="string:Monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Type</label></div>
              <div class="col-sm-12">
                <select id="retTyp">
                  <option value="string:Select">Select</option>
                  <option value="string:GSTR3B">GSTR3B</option>
                </select>
              </div>
            </div>
          </div>
        </form>
        <button id="lotsearch" type="button">Search</button>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(documentRef.querySelector<HTMLSelectElement>("#finYr")?.value).toBe("string:2025-26");
    expect(documentRef.querySelector<HTMLSelectElement>("#optValue")?.value).toBe("string:Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("#retTyp")?.value).toBe("string:GSTR3B");
    expect(searchClicked).toBe(1);
  });

  it("clicks search when the live GSTR-1 filter form is already populated", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div class="row">
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Financial year</label></div>
              <div class="col-sm-12">
                <select id="finYr">
                  <option value="string:Select">Select</option>
                  <option selected value="string:2025-26">2025-26</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Filing Period</label></div>
              <div class="col-sm-12">
                <select id="optValue">
                  <option value="string:Select">Select</option>
                  <option selected value="string:Monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Month</label></div>
              <div class="col-sm-12">
                <select id="month">
                  <option value="string:Select">Select</option>
                  <option selected value="string:May">May</option>
                </select>
              </div>
            </div>
            <div class="col-sm-3">
              <div class="col-sm-12"><label>Return Type</label></div>
              <div class="col-sm-12">
                <select id="retTyp">
                  <option value="string:Select">Select</option>
                  <option selected value="string:GSTR1">GSTR-1/IFF/GSTR-1A</option>
                </select>
              </div>
            </div>
          </div>
        </form>
        <button id="lotsearch" type="button">Search</button>
      </main>
    `);
    Object.defineProperty(documentRef.querySelector("#lotsearch"), "innerText", {
      configurable: true,
      value: "Search",
    });
    const gstr1Scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    let searchClicked = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
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
  });

  it("prefers filed-return form selects before matching controls elsewhere on the page", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <aside>
          <select id="finYr" data-outside-financial-year>
            <option>Select</option>
            <option>2025-26</option>
          </select>
          <select id="optValue" data-outside-period>
            <option>Select</option>
            <option>Monthly</option>
          </select>
          <select id="retTyp" data-outside-return-type>
            <option>Select</option>
            <option>GSTR3B</option>
          </select>
        </aside>
        <form name="efiledReturns">
          <div>
            <label>Financial year</label>
            <select data-form-financial-year>
              <option>Select</option>
              <option>2025-26</option>
            </select>
          </div>
          <div>
            <label>Return Filing Period</label>
            <select data-form-period>
              <option>Select</option>
              <option>Monthly</option>
            </select>
          </div>
          <div>
            <label>Return Type</label>
            <select data-form-return-type>
              <option>Select</option>
              <option>GSTR3B</option>
            </select>
          </div>
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
    expect(documentRef.querySelector<HTMLSelectElement>("[data-form-financial-year]")?.value).toBe(
      "2025-26",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[data-form-period]")?.value).toBe(
      "Monthly",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[data-form-return-type]")?.value).toBe(
      "GSTR3B",
    );
    expect(
      documentRef.querySelector<HTMLSelectElement>("[data-outside-financial-year]")?.value,
    ).toBe("Select");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-outside-period]")?.value).toBe(
      "Select",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[data-outside-return-type]")?.value).toBe(
      "Select",
    );
    expect(searchClicked).toBe(1);
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
