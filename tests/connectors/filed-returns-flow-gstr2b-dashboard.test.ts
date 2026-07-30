import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import { markFiledReturnsSearchPending } from "../../src/connectors/gst/filed-returns-search-state";
import {
  createGstDocument,
  makeLayoutVisible,
  replaceGstr2bDashboardView,
  replaceDashboardView,
} from "./filed-returns-flow.test-helpers";

describe("filed returns flow — GSTR-2B dashboard selection", () => {
  it("selects GSTR-2B filters from the filed-returns page", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select data-year>
            <option>Select</option>
            <option>2026-27</option>
            <option>2025-26</option>
          </select>
          <label>Return Filing Period</label>
          <select data-period>
            <option>Select</option>
            <option>Annual</option>
            <option>Quarterly</option>
            <option>Monthly</option>
          </select>
          <label>Return Type</label>
          <select data-return-type>
            <option>Select</option>
            <option>GSTR1</option>
            <option>GSTR2B</option>
            <option>GSTR3B</option>
          </select>
          <button type="button">SEARCH</button>
        </form>
      </main>
    `);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(expect.arrayContaining(["search-clicked"]));
    expect(documentRef.querySelector<HTMLSelectElement>("[data-year]")?.value).toBe("2025-26");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-period]")?.value).toBe("Monthly");
    expect(documentRef.querySelector<HTMLSelectElement>("[data-return-type]")?.value).toBe(
      "GSTR2B",
    );
    expect(searchClicked).toBe(1);
  });

  it("leaves View Filed Returns for Return Dashboard when GSTR-2B is not an offered return type", async () => {
    const documentRef = createGstDocument(`
      <main>
        <nav><a data-dashboard href="/returns/auth/dashboard">Return Dashboard</a></nav>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select>
            <option>Select</option>
            <option>2025-26</option>
          </select>
          <label>Return Filing Period</label>
          <select>
            <option>Select</option>
            <option>Monthly</option>
          </select>
          <label>Month</label>
          <select>
            <option>Select</option>
            <option>April</option>
          </select>
          <label>Return Type</label>
          <select>
            <option>Select</option>
            <option>GSTR-1/IFF/GSTR-1A</option>
            <option>GSTR3B</option>
          </select>
          <button type="button">SEARCH</button>
        </form>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let dashboardClicked = 0;
    documentRef.querySelector("[data-dashboard]")?.addEventListener("click", (event) => {
      event.preventDefault();
      dashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-filed-returns-no-gstr2b-option",
        "return-dashboard-candidate-clicked",
      ]),
    );
    expect(dashboardClicked).toBe(1);
  });

  it("opens the matching GSTR-2B result row from the filed-returns page", async () => {
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead>
            <tr>
              <th>Financial Year</th>
              <th>Tax Period</th>
              <th>Return Type</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>2025-26</td>
              <td>April</td>
              <td>GSTR2B</td>
              <td><button type="button">View</button></td>
            </tr>
          </tbody>
        </table>
      </main>
    `);
    let viewClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "gstr2b-filed-return-result-view-clicked",
      ]),
    );
    expect(viewClicked).toBe(1);
  });

  it("waits for one pending GSTR-2B filed-return search instead of clicking Search again", async () => {
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-2B",
    };
    const documentRef = createGstDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <label>Financial Year</label>
          <select><option selected>2025-26</option></select>
          <label>Return Filing Period</label>
          <select><option selected>Monthly</option></select>
          <label>Month</label>
          <select><option selected>April</option></select>
          <label>Return Type</label>
          <select><option selected>GSTR-2B</option></select>
          <button type="button">Search</button>
        </form>
      </main>
    `);
    let searched = 0;
    documentRef.querySelector("button")?.addEventListener("click", () => {
      searched += 1;
    });
    markFiledReturnsSearchPending(documentRef, scope);

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining([
        "filed-return-search-results-pending",
        "gstr2b-filed-return-search-results-pending",
      ]),
    });
    expect(searched).toBe(0);
  });

  it("stages the GSTR-2B return dashboard quarter change before selecting the dependent period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>July</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    let viewClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(viewClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("#quarter")?.value).toContain("Quarter 1");
    expect(documentRef.querySelector<HTMLSelectElement>("#period")?.value).toBe("July");
  });

  it("resolves GSTR-2B dashboard controls from the full page when the search root is narrow", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>July</option>
            </select>
            <div><button type="button" data-search>Search</button></div>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    const narrowSearchRoot = documentRef.createElement("div");
    narrowSearchRoot.append(documentRef.querySelector("[data-search]") as HTMLElement);
    documentRef.body.append(narrowSearchRoot);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "gstr2b-dashboard-quarter-select-found",
        "quarter-selected",
      ]),
    );
    expect(documentRef.querySelector<HTMLSelectElement>("#quarter")?.value).toContain("Quarter 1");
  });

  it("stages the GSTR-2B return dashboard period change after Angular refreshes Q1 months", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
              <option>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option>April</option>
              <option>May</option>
              <option selected>June</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "period-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("#period")?.value).toBe("May");
  });

  it("clicks GSTR-2B dashboard search only after requested filters are already settled", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
              <option>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option>April</option>
              <option selected>May</option>
              <option>June</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr2b-return-dashboard-filters-selected", "search-clicked"]),
    );
    expect(searchClicked).toBe(1);
  });

  it("clicks the GSTR-2B View control instead of adjacent GSTR-1 dashboard controls", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>May</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
          <section class="return-grid">
            <article>
              <h3>Details of outward supplies of goods or services GSTR-1</h3>
              <button type="button" data-gstr1-view>VIEW</button>
              <button type="button">DOWNLOAD</button>
            </article>
            <article>
              <h3>Auto - drafted ITC Statement for the month GSTR-2B</h3>
              <button type="button" data-gstr2b-view>VIEW</button>
              <button type="button">DOWNLOAD</button>
            </article>
            <article>
              <h3>Monthly Return GSTR-3B</h3>
              <button type="button">VIEW GSTR3B</button>
              <button type="button">DOWNLOAD</button>
            </article>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let gstr1ViewClicked = 0;
    let gstr2bViewClicked = 0;
    let searchClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1ViewClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      gstr2bViewClicked += 1;
    });
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    const stabilizingResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(stabilizingResult.safeSignals).toContain(
      "gstr2b-return-dashboard-search-results-pending",
    );
    expect(stabilizingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1ViewClicked).toBe(0);
    expect(gstr2bViewClicked).toBe(1);
    expect(searchClicked).toBe(1);
  });

  it("opens only the card-contained GSTR-1 View after target-bound dashboard search", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin"><option selected>2026-27</option></select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <label for="period">Period</label>
            <select id="period" name="mon"><option selected>April</option></select>
            <button type="button" data-search>Search</button>
          </form>
          <section class="return-grid">
            <article>
              <h3>Details of outward supplies of goods or services GSTR-1</h3>
              <button type="button" data-gstr1-view>VIEW</button>
            </article>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <button type="button" data-gstr2b-view>VIEW</button>
            </article>
          </section>
        </main>
      `,
      "https://portal.example.test/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    let gstr1ViewClicked = 0;
    let gstr2bViewClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1ViewClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      gstr2bViewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-1",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceDashboardView(documentRef, "GSTR-1");
    const stabilizingResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const settlingResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(stabilizingResult.safeSignals).toContain(
      "gstr1-return-dashboard-search-results-pending",
    );
    expect(settlingResult.safeSignals).toContain("gstr1-return-dashboard-search-results-pending");
    expect(result.safeSignals).toContain("gstr1-dashboard-view-clicked");
    expect(searchClicked).toBe(1);
    expect(gstr1ViewClicked).toBe(1);
    expect(gstr2bViewClicked).toBe(0);
  });

  it("keeps the unchanged GSTR-2B View pending after an in-place status mutation", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
    expect(pendingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);

    const resultStatus = documentRef.createElement("span");
    resultStatus.textContent = "Generated";
    documentRef.querySelector("article")?.append(resultStatus);
    await Promise.resolve();
    const stabilizingResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const stillPendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(stabilizingResult.safeSignals).toContain(
      "gstr2b-return-dashboard-search-results-pending",
    );
    expect(stillPendingResult.safeSignals).toContain(
      "gstr2b-return-dashboard-search-results-pending",
    );
    expect(stillPendingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("requires manual recovery instead of releasing an unchanged pre-search GSTR-2B View", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(
        `
          <main>
            <form>
              <select name="fin"><option selected>2026-27</option></select>
              <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
              <select name="mon"><option selected>May</option></select>
              <button type="button">Search</button>
            </form>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </main>
        `,
        "https://return.gst.gov.in/returns/auth/dashboard",
      );
      makeLayoutVisible(documentRef);
      let viewClicked = 0;
      documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
        viewClicked += 1;
      });
      const scope: FiledReturnsDownloadScope = {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };

      const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
      const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(12_000);
      const recoveryResult = await runFiledReturnsDownloadStep(documentRef, scope);

      expect(searchResult.safeSignals).toContain("search-clicked");
      expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
      expect(recoveryResult.state).toBe("user-action-required");
      expect(recoveryResult.safeSignals).toContain("gstr2b-dashboard-view-unchanged-after-search");
      expect(recoveryResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
      expect(recoveryResult.userAction).toMatchObject({
        type: "NAVIGATE_TO_SUPPORTED_PAGE",
        canResume: true,
      });
      expect(viewClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores hidden GSTR-2B View templates after Search", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button" data-search>Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button hidden data-gstr2b-view data-ng-click="page_rtp()">VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };
    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
    expect(pendingResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("does not scope a visible View from a hidden GSTR-2B sibling", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button" data-search>Search</button>
          </form>
          <article>
            <span hidden>Auto-drafted ITC Statement GSTR-2B</span>
            <span>Another return</span>
            <button data-visible-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-visible-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
    expect(result.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("never releases an unchanged pre-search GSTR-2B View despite nearby mutations", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(
        `
          <main>
            <form>
              <select name="fin"><option selected>2026-27</option></select>
              <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
              <select name="mon"><option selected>May</option></select>
              <button type="button" data-search>Search</button>
            </form>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <span data-status>Loading</span>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </main>
        `,
        "https://return.gst.gov.in/returns/auth/dashboard",
      );
      makeLayoutVisible(documentRef);
      let searchClicked = 0;
      let viewClicked = 0;
      documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
        searchClicked += 1;
      });
      documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
        viewClicked += 1;
      });
      const scope: FiledReturnsDownloadScope = {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };

      await runFiledReturnsDownloadStep(documentRef, scope);
      let pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      for (let second = 1; second <= 11; second += 1) {
        const status = documentRef.querySelector("[data-status]");
        if (status) status.textContent = `Loading ${second}`;
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1_000);
        pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      }

      expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
      expect(searchClicked).toBe(1);
      expect(viewClicked).toBe(0);

      const status = documentRef.querySelector("[data-status]");
      if (status) status.textContent = "Loading 12";
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);
      const recoveryAfterBudget = await runFiledReturnsDownloadStep(documentRef, scope);
      expect(recoveryAfterBudget.state).toBe("user-action-required");
      expect(recoveryAfterBudget.safeSignals).toContain(
        "gstr2b-dashboard-view-unchanged-after-search",
      );
      expect(recoveryAfterBudget.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
      expect(searchClicked).toBe(1);
      expect(viewClicked).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a mutated GSTR-2B search when no usable View result appears", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createGstDocument(
        `
          <main>
            <form>
              <select name="fin"><option selected>2026-27</option></select>
              <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
              <select name="mon"><option selected>May</option></select>
              <button type="button" data-search>Search</button>
            </form>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <span data-status>Loading</span>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </main>
        `,
        "https://return.gst.gov.in/returns/auth/dashboard",
      );
      makeLayoutVisible(documentRef);
      let searchClicked = 0;
      documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
        searchClicked += 1;
      });
      const scope: FiledReturnsDownloadScope = {
        artifactType: "PDF",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      };

      await runFiledReturnsDownloadStep(documentRef, scope);
      const status = documentRef.querySelector("[data-status]");
      if (status) status.textContent = "No records";
      documentRef.querySelector("[data-gstr2b-view]")?.remove();
      await Promise.resolve();
      const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);
      await vi.advanceTimersByTimeAsync(12_000);
      const retryResult = await runFiledReturnsDownloadStep(documentRef, scope);

      expect(pendingResult.safeSignals).toContain("gstr2b-return-dashboard-search-results-pending");
      expect(retryResult.safeSignals).toContain("search-clicked");
      expect(searchClicked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the GSTR-2B return dashboard controls when the portal shell is still blank", async () => {
    const documentRef = createGstDocument("", "https://return.gst.gov.in/returns/auth/dashboard");

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-return-dashboard-loading");
    expect(result.userAction).toBeUndefined();
  });

  it("waits with redacted GSTR-2B dashboard diagnostics when controls are incomplete", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <div>Financial Year *</div>
            <select name="fin">
              <option selected>2026-27</option>
            </select>
            <div>Quarter *</div>
            <select name="quarter">
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <p>Period controls are still rendering.</p>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.userAction).toBeUndefined();
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-route",
        "gstr2b-dashboard-year-select-found",
        "gstr2b-dashboard-quarter-select-found",
        "gstr2b-dashboard-period-select-missing",
        "gstr2b-dashboard-search-missing",
        "gstr2b-dashboard-selected-year:2026-27",
      ]),
    );
    expect(result.safeMessage).toContain("waiting for target-bound dashboard controls");
    expect(result.safeMessage).toContain("Diagnostic signals:");
  });

  it("does not open an unscoped GSTR-2B View when dashboard filters are absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-unscoped");
    expect(result.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(0);
  });

  it("preserves GSTR-2B View recovery when scoped search controls disappear", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form data-filters>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector("[data-filters]")?.remove();
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("preserves target-bound GSTR-2B View recovery after the search retry window", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form data-filters>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector("[data-filters]")?.remove();
    now.mockReturnValue(20_000);
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    now.mockRestore();
    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("invalidates GSTR-2B View recovery when dashboard filters change after Search", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form data-filters>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option><option>June</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const period = documentRef.querySelector<HTMLSelectElement>("select[name='mon']");
    period!.value = "June";
    period!.dispatchEvent(new documentRef.defaultView!.Event("change", { bubbles: true }));
    const changedFilterResult = await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector("[data-filters]")?.remove();
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(changedFilterResult.safeSignals).toContain("period-selected");
    expect(changedFilterResult.safeSignals).not.toContain("gstr2b-dashboard-view-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-unscoped");
    expect(viewClicked).toBe(0);
  });

  it("selects GSTR-2B dashboard filters when the search button ancestor omits labels", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <div>
            <label for="fy">Financial Year</label>
            <select id="fy" name="finyr">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="period">
              <option>May</option>
              <option selected>July</option>
            </select>
          </div>
          <aside>
            <span><button type="button" data-search>SEARCH</button></span>
          </aside>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("#quarter")?.value).toContain("Quarter 1");
    expect(documentRef.querySelector<HTMLSelectElement>("#period")?.value).toBe("July");
  });

  it("selects GSTR-2B dashboard filters from the live portal ordered select layout", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <div>Financial Year *</div>
            <select>
              <option selected>2026-27</option>
            </select>
            <div>Quarter *</div>
            <select>
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <div>Period *</div>
            <select>
              <option>May</option>
              <option selected>July</option>
            </select>
            <button type="button" data-search>SEARCH</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[1]?.value).toContain(
      "Quarter 1",
    );
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[2]?.value).toBe("July");
  });

  it("clicks search when GSTR-2B dashboard filters already match but the card is absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <section>
            <div>Financial Year *</div>
            <select name="fin">
              <option selected>2026-27</option>
            </select>
            <div>Quarter *</div>
            <select name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <div>Period *</div>
            <select name="mon">
              <option selected>May</option>
            </select>
            <button type="button" data-search>Search</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filters-selected",
        "gstr2b-dashboard-selected-quarter:quarter-1-apr-jun",
        "gstr2b-dashboard-selected-period:may",
        "search-clicked",
      ]),
    );
    expect(
      result.safeSignals.some((signal) => signal.startsWith("gstr2b-dashboard-selected-quarter:")),
    ).toBe(true);
    expect(searchClicked).toBe(1);
  });

  it("waits for GSTR-2B dashboard results after searching instead of clicking Search repeatedly", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fin">Financial Year</label>
            <select name="fin">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon">
              <option selected>May</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    const pendingResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(pendingResult.state).toBe("clicked");
    expect(pendingResult.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filters-selected",
        "gstr2b-return-dashboard-search-results-pending",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("does not reuse a pending GSTR-2B dashboard search after the target period changes", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fin">Financial Year</label>
            <select name="fin"><option selected>2026-27</option></select>
            <label for="quarter">Quarter</label>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <label for="mon">Period</label>
            <select name="mon"><option>April</option><option selected>May</option></select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });
    const mayScope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };
    const aprilScope: FiledReturnsDownloadScope = { ...mayScope, period: "April" };

    const maySearch = await runFiledReturnsDownloadStep(documentRef, mayScope);
    const aprilSelection = await runFiledReturnsDownloadStep(documentRef, aprilScope);
    const aprilSearch = await runFiledReturnsDownloadStep(documentRef, aprilScope);

    expect(maySearch.safeSignals).toContain("search-clicked");
    expect(aprilSelection.safeSignals).toContain("period-selected");
    expect(aprilSelection.safeSignals).toContain("gstr2b-dashboard-selected-period:april");
    expect(aprilSelection.safeSignals).not.toContain("gstr2b-dashboard-selected-period:may");
    expect(new Set(aprilSelection.safeSignals).size).toBe(aprilSelection.safeSignals.length);
    expect(aprilSearch.safeSignals).toContain("search-clicked");
    expect(new Set(aprilSearch.safeSignals).size).toBe(aprilSearch.safeSignals.length);
    expect(aprilSearch.safeSignals).not.toContain("gstr2b-return-dashboard-search-results-pending");
    expect(searchClicked).toBe(2);
  });

  it("drops unrecognized selected-option values from GSTR-2B dashboard diagnostics", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard">
            <label for="fin">Financial Year</label>
            <select name="fin">
              <option selected>unrecognized-year-option</option>
              <option>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select name="quarter">
              <option selected>unrecognized-quarter-option</option>
              <option>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon">
              <option selected>unrecognized-period-option</option>
              <option>April</option>
            </select>
            <button type="button" data-search>Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2026-27",
      period: "April",
      returnType: "GSTR-2B",
    });

    expect(result.safeSignals).toContain("gstr2b-dashboard-selected-year:2026-27");
    expect(result.safeSignals.some((signal) => signal.includes("unrecognized"))).toBe(false);
    expect(result.safeMessage).not.toContain("unrecognized");
  });

  it("selects GSTR-2B prior-year dashboard filters when the quarter field is absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <label for="fin">Financial Year</label>
            <select name="fin" data-ng-model="dropdownValues.finyr">
              <option label="2026-27" value="object:187">2026-27</option>
              <option label="2025-26" value="object:188" selected>2025-26</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon" data-ng-model="dropdownValues.reqmonth">
              <option label="April" value="object:204" selected>April</option>
              <option label="May" value="object:205">May</option>
              <option label="June" value="object:203">June</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });

    const selectResult = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(selectResult.state).toBe("clicked");
    expect(selectResult.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-dashboard-quarter-select-missing",
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "period-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='mon']")?.value).toBe("object:205");

    const searchResult = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(searchResult.state).toBe("clicked");
    expect(searchResult.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-dashboard-quarter-select-missing",
        "gstr2b-return-dashboard-filters-selected",
        "search-clicked",
      ]),
    );
    expect(searchClicked).toBe(1);
  });

  it("re-resolves the live GST dashboard period select after quarter changes rebuild it", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <label for="fin">Financial Year</label>
            <select name="fin" data-ng-model="dropdownValues.finyr" data-ng-options="item.year for item in years">
              <option label="2026-27" value="object:187" selected>2026-27</option>
              <option label="2025-26" value="object:188">2025-26</option>
            </select>
            <label for="quarter">Quarter</label>
            <select name="quarter" ng-model="dropdownValues.quart" data-ng-options="item.name for item in quarters" ng-change="qtrfunc(quart)">
              <option label="Quarter 1 (Apr - Jun)" value="object:198">Quarter 1 (Apr - Jun)</option>
              <option label="Quarter 2 (Jul - Sep)" value="object:199" selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon" data-ng-model="dropdownValues.reqmonth" data-ng-options="item.month for item in reqmonths">
              <option label="July" value="object:200" selected>July</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });
    documentRef
      .querySelector<HTMLSelectElement>("[name='quarter']")
      ?.addEventListener("change", () => {
        const currentPeriod = documentRef.querySelector<HTMLSelectElement>("[name='mon']");
        const nextPeriod = documentRef.createElement("select");
        nextPeriod.name = "mon";
        nextPeriod.setAttribute("data-ng-model", "dropdownValues.reqmonth");
        nextPeriod.innerHTML = `
          <option label="April" value="object:200">April</option>
          <option label="May" value="object:201">May</option>
          <option label="June" value="object:202">June</option>
        `;
        currentPeriod?.replaceWith(nextPeriod);
      });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='quarter']")?.value).toBe(
      "object:198",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[name='mon']")?.value).toBe("object:200");
  });

  it("waits for the live GST dashboard period select when quarter changes rebuild it asynchronously", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <label for="fin">Financial Year</label>
            <select name="fin" data-ng-model="dropdownValues.finyr" data-ng-options="item.year for item in years">
              <option label="2026-27" value="object:187" selected>2026-27</option>
              <option label="2025-26" value="object:188">2025-26</option>
            </select>
            <label for="quarter">Quarter</label>
            <select name="quarter" ng-model="dropdownValues.quart" data-ng-options="item.name for item in quarters" ng-change="qtrfunc(quart)">
              <option label="Quarter 1 (Apr - Jun)" value="object:198">Quarter 1 (Apr - Jun)</option>
              <option label="Quarter 2 (Jul - Sep)" value="object:199" selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <label for="mon">Period</label>
            <select name="mon" data-ng-model="dropdownValues.reqmonth" data-ng-options="item.month for item in reqmonths">
              <option label="July" value="object:200" selected>July</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });
    documentRef
      .querySelector<HTMLSelectElement>("[name='quarter']")
      ?.addEventListener("change", () => {
        setTimeout(() => {
          const currentPeriod = documentRef.querySelector<HTMLSelectElement>("[name='mon']");
          const nextPeriod = documentRef.createElement("select");
          nextPeriod.name = "mon";
          nextPeriod.setAttribute("data-ng-model", "dropdownValues.reqmonth");
          nextPeriod.innerHTML = `
            <option label="April" value="object:200">April</option>
            <option label="May" value="object:201">May</option>
            <option label="June" value="object:202">June</option>
          `;
          currentPeriod?.replaceWith(nextPeriod);
        }, 25);
      });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='quarter']")?.value).toBe(
      "object:198",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[name='mon']")?.value).toBe("object:200");
  });

  it("resolves live GST dashboard controls from the dashboard form when page chrome has extra selects", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <select aria-label="Language">
            <option selected>English</option>
          </select>
          <form name="dashboard" data-ng-submit="returnPrd(dropdownValues.finyr,dropdownValues.reqmonth)">
            <select name="fin" data-ng-model="dropdownValues.finyr">
              <option label="2026-27" value="object:187" selected>2026-27</option>
            </select>
            <select name="quarter" data-ng-model="quart" ng-change="qtrfunc(quart)">
              <option label="Quarter 1 (Apr - Jun)" value="object:198">Quarter 1 (Apr - Jun)</option>
              <option label="Quarter 2 (Jul - Sep)" value="object:199" selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <select name="mon" data-ng-model="dropdownValues.reqmonth">
              <option label="May" value="object:201">May</option>
              <option label="July" value="object:200" selected>July</option>
            </select>
            <button class="btn btn-primary srchbtn" type="submit">Search</button>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-dashboard-root-found",
        "gstr2b-dashboard-quarter-select-found",
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(
      documentRef.querySelector<HTMLSelectElement>("form[name='dashboard'] [name='quarter']")
        ?.value,
    ).toBe("object:198");
    expect(
      documentRef.querySelector<HTMLSelectElement>("form[name='dashboard'] [name='mon']")?.value,
    ).toBe("object:200");
  });

  it("selects GSTR-2B dashboard filters from ordered selects when labels are not in the root", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <select>
            <option selected>2026-27</option>
          </select>
          <select>
            <option>Quarter 1 (Apr - Jun)</option>
            <option selected>Quarter 2 (Jul - Sep)</option>
          </select>
          <select>
            <option>May</option>
            <option selected>July</option>
          </select>
          <button type="button" data-search>SEARCH</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[1]?.value).toContain(
      "Quarter 1",
    );
    expect(documentRef.querySelectorAll<HTMLSelectElement>("select")[2]?.value).toBe("July");
  });

  it("selects hidden native GSTR-2B return dashboard filters behind custom portal controls", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <div>
            <select name="finyr" style="display: none">
              <option>2025-26</option>
              <option selected>2026-27</option>
            </select>
            <select name="quarter" style="display: none">
              <option>Quarter 1 (Apr - Jun)</option>
              <option selected>Quarter 2 (Jul - Sep)</option>
            </select>
            <select name="period" style="display: none">
              <option>April</option>
              <option>May</option>
              <option>June</option>
              <option selected>July</option>
            </select>
            <button type="button" data-search>SEARCH</button>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let searchClicked = 0;
    documentRef.querySelector("[data-search]")?.addEventListener("click", () => {
      searchClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-return-dashboard-filter-selection-in-progress",
        "quarter-selected",
      ]),
    );
    expect(searchClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("[name='quarter']")?.value).toContain(
      "Quarter 1",
    );
    expect(documentRef.querySelector<HTMLSelectElement>("[name='period']")?.value).toBe("July");
  });

  it("opens GSTR-2B from the searched return dashboard card", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <label for="fy">Financial Year</label>
            <select id="fy" name="finyr">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="period">
              <option selected>June</option>
            </select>
            <button type="button">Search</button>
          </form>
          <div class="row">
            <section class="col-sm-4 col-xs-12">
              <h3>Details of outward supplies of goods or services</h3>
              <p>GSTR-1</p>
              <button data-gstr1-view>VIEW</button>
              <button>DOWNLOAD</button>
            </section>
            <section class="col-sm-4 col-xs-12">
              <h3>Auto - drafted ITC Statement for the month</h3>
              <p>GSTR-2B</p>
              <button data-gstr2b-view>VIEW</button>
              <button data-gstr2b-download>DOWNLOAD</button>
            </section>
            <section class="col-sm-4 col-xs-12">
              <h3>Monthly Return</h3>
              <p>GSTR-3B</p>
              <button>VIEW GSTR3B</button>
              <button>DOWNLOAD</button>
            </section>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let gstr1Clicked = 0;
    let viewClicked = 0;
    let downloadClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-download]")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1Clicked).toBe(0);
    expect(viewClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("opens GSTR-2B from the nearest unclassed dashboard card ancestor", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>June</option></select>
            <button type="button">Search</button>
          </form>
          <div>
            <a>Details of outward supplies of goods or services GSTR-1</a>
            <button data-gstr1-view>VIEW</button>
            <button>DOWNLOAD</button>
          </div>
          <div>
            <a>Auto - drafted ITC Statement for the month GSTR-2B</a>
            <button data-gstr2b-view>VIEW</button>
            <button data-gstr2b-download>DOWNLOAD</button>
          </div>
          <div>
            <a>Monthly Return GSTR-3B</a>
            <button>VIEW GSTR3B</button>
            <button>DOWNLOAD</button>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let gstr1Clicked = 0;
    let viewClicked = 0;
    let downloadClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-download]")?.addEventListener("click", () => {
      downloadClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1Clicked).toBe(0);
    expect(viewClicked).toBe(1);
    expect(downloadClicked).toBe(0);
  });

  it("opens GSTR-2B when the live card label and view button are nearby siblings", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <label for="fy">Financial Year</label>
            <select id="fy" name="fin">
              <option selected>2026-27</option>
            </select>
            <label for="quarter">Quarter</label>
            <select id="quarter" name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
            </select>
            <label for="period">Period</label>
            <select id="period" name="mon">
              <option selected>May</option>
            </select>
            <button type="button">Search</button>
          </form>
          <section>
            <div class="hd">
              <p>Auto - drafted ITC Statement for the month</p>
              <p>GSTR-2B</p>
            </div>
            <div class="tile-actions">
              <button data-gstr2b-view>VIEW</button>
              <button>DOWNLOAD</button>
            </div>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("opens the locally scoped GSTR-2B view button from a broad portal dashboard row", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter"><option selected>Quarter 1 (Apr - Jun)</option></select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <div class="row">
            <div class="col-sm-4">
              <div class="hd"><p>Details of outward supplies</p><p>GSTR-1</p></div>
              <button data-gstr1-view>View</button>
            </div>
            <div class="col-sm-4">
              <div class="hd">
                <p>Auto - drafted ITC Statement for the month</p>
                <p>GSTR-2B</p>
              </div>
              <div class="ct">
                <div class="row">
                  <div class="col-sm-6">
                    <button data-gstr2b-view data-ng-click="page_rtp(x.return_ty,x.due_dt,x.status)">View</button>
                  </div>
                  <div class="col-sm-5">
                    <button data-ng-click="offlinepath(x.return_ty)">Download</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-sm-4">
              <div class="hd"><p>Monthly Return</p><p>GSTR-3B</p></div>
              <button data-gstr3b-view>View</button>
            </div>
          </div>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let gstr1Clicked = 0;
    let gstr2bClicked = 0;
    let gstr3bClicked = 0;
    documentRef.querySelector("[data-gstr1-view]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      gstr2bClicked += 1;
    });
    documentRef.querySelector("[data-gstr3b-view]")?.addEventListener("click", () => {
      gstr3bClicked += 1;
    });

    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(gstr1Clicked).toBe(0);
    expect(gstr2bClicked).toBe(1);
    expect(gstr3bClicked).toBe(0);
  });

  it("opens a searched GSTR-2B View when only the quarter label wording drifts", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
              <option>Qtr 1</option>
            </select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    const searchResult = await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector<HTMLSelectElement>("select[name='quarter']")!.value = "Qtr 1";
    const viewResult = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(searchResult.safeSignals).toContain("search-clicked");
    expect(viewResult.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("does not release a settled GSTR-2B View while the quarter control conflicts", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <select name="fin"><option selected>2026-27</option></select>
            <select name="quarter">
              <option selected>Quarter 1 (Apr - Jun)</option>
              <option>Quarter 4 (Jan - Mar)</option>
            </select>
            <select name="mon"><option selected>May</option></select>
            <button type="button">Search</button>
          </form>
          <article>
            <h3>Auto-drafted ITC Statement GSTR-2B</h3>
            <button data-gstr2b-view>VIEW</button>
          </article>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector<HTMLSelectElement>("select[name='quarter']")!.value =
      "Quarter 4 (Jan - Mar)";
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.safeSignals).toContain("quarter-selected");
    expect(viewClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("select[name='quarter']")?.value).toContain(
      "Quarter 1",
    );
  });

  it("ignores an unrelated quarter control outside the active GSTR-2B dashboard", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <label>Financial Year <select name="fin"><option selected>2026-27</option></select></label>
            <label>Period <select name="mon"><option selected>May</option></select></label>
            <button type="button">Search</button>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </form>
          <aside>
            <label>Quarter <select name="quarter"><option selected>Quarter 4</option></select></label>
          </aside>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-dashboard-view-clicked");
    expect(viewClicked).toBe(1);
  });

  it("reconciles a quarter control beside the nearest filter group in the owning form", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <form>
            <div>
              <label>Financial Year <select name="fin"><option selected>2026-27</option></select></label>
              <label>Period <select name="mon"><option selected>May</option></select></label>
              <button type="button">Search</button>
            </div>
            <label>Quarter
              <select name="quarter">
                <option selected>Quarter 1 (Apr - Jun)</option>
                <option>Quarter 4 (Jan - Mar)</option>
              </select>
            </label>
            <article>
              <h3>Auto-drafted ITC Statement GSTR-2B</h3>
              <button data-gstr2b-view>VIEW</button>
            </article>
          </form>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/dashboard",
    );
    makeLayoutVisible(documentRef);
    let viewClicked = 0;
    documentRef.querySelector("[data-gstr2b-view]")?.addEventListener("click", () => {
      viewClicked += 1;
    });
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    };

    await runFiledReturnsDownloadStep(documentRef, scope);
    replaceGstr2bDashboardView(documentRef);
    await runFiledReturnsDownloadStep(documentRef, scope);
    documentRef.querySelector<HTMLSelectElement>("select[name='quarter']")!.value =
      "Quarter 4 (Jan - Mar)";
    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.safeSignals).toContain("quarter-selected");
    expect(viewClicked).toBe(0);
    expect(documentRef.querySelector<HTMLSelectElement>("select[name='quarter']")?.value).toContain(
      "Quarter 1",
    );
  });
});
