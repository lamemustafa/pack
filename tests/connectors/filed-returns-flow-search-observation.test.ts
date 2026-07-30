import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import {
  consumeSettledFiledReturnsSearchForScope,
  hasPendingFiledReturnsSearchForScope,
  hasSettledFiledReturnsSearchForScope,
  hasUnchangedFiledReturnsSearchForScope,
  markFiledReturnsSearchPending,
} from "../../src/connectors/gst/filed-returns-search-state";
import {
  DEFAULT_SCOPE,
  createDocument,
  createGstDocument,
  markPackSubmittedSearch,
} from "./filed-returns-flow.test-helpers";

describe("filed returns flow — search and no-record observation", () => {
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

  it("does not treat no-record text inside an outer busy result panel as not-filed", async () => {
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
            <tbody>
              <tr><td>No records found</td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    documentRef.querySelector("section")?.setAttribute("aria-busy", "true");

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

  it("does not mark not-filed when a matching result row has no actionable view control", async () => {
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
              <tr><td>GSTR3B</td><td>2025-26</td><td>March</td><td><button disabled>Open</button></td></tr>
            </tbody>
          </table>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("opens result rows whose tax period uses a GST month abbreviation", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Tax Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>Mar</td><td><a href="#view">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "filed-return-result-period:March",
      ]),
    );
    expect(viewClicked).toBe(1);
  });

  it("opens headerless result rows whose tax period uses a GST month abbreviation", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <caption>View/Download</caption>
          <tbody>
            <tr><td>GSTR3B</td><td>2025-26</td><td>Mar</td><td><a href="#view">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let viewClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", () => {
      viewClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-result-view-clicked",
        "filed-return-result-period:March",
      ]),
    );
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

  it("accepts native abbreviated month selection before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <select id="month"><option selected>Mar</option></select>
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

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
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

  it("accepts custom September abbreviation before accepting no-record evidence", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <div><label>Financial Year</label><select id="finYr"><option selected>2025-26</option></select></div>
          <div><label>Return Filing Period</label><select id="optValue"><option selected>Monthly</option></select></div>
          <div><span>Month</span><button type="button" data-month>Sept</button></div>
          <div><label>Return Type</label><select id="retTyp"><option selected>GSTR3B</option></select></div>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, {
      ...DEFAULT_SCOPE,
      period: "September",
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...DEFAULT_SCOPE,
      period: "September",
    });

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
    vi.useFakeTimers();
    try {
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

      const firstResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const firstResult = await firstResultPromise;
      const secondResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const secondResult = await secondResultPromise;

      expect(firstResult.state).toBe("clicked");
      expect(secondResult.safeSignals).not.toContain("filed-return-positively-not-filed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark not-filed when unrelated pre-search loading disappears without result changes", async () => {
    vi.useFakeTimers();
    try {
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
          <div data-unrelated-loading>Loading...</div>
          <section aria-label="Search results">
            <p>No records found</p>
          </section>
        </main>
      `);

      const firstResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const firstResult = await firstResultPromise;
      documentRef.querySelector("[data-unrelated-loading]")?.remove();
      const secondResultPromise = runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(10_000);
      const secondResult = await secondResultPromise;

      expect(firstResult.state).toBe("clicked");
      expect(secondResult.safeSignals).not.toContain("filed-return-positively-not-filed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not settle a stale no-record search from unrelated post-click page loading", async () => {
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

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    const unrelatedLoading = documentRef.createElement("div");
    unrelatedLoading.setAttribute("aria-busy", "true");
    unrelatedLoading.textContent = "Loading...";
    documentRef.body.append(unrelatedLoading);

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    unrelatedLoading.remove();
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
  });

  it("does not settle a plain no-record section from unrelated body mutations", async () => {
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
        <section>
          <p>No records found</p>
        </section>
      </main>
    `);

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    const unrelatedStatus = documentRef.createElement("aside");
    unrelatedStatus.textContent = "Search finished elsewhere";
    documentRef.body.append(unrelatedStatus);

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
  });

  it("does not settle when result-surface loading leaves the same no-record evidence", async () => {
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
    const resultSurface = documentRef.querySelector("section");

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasUnchangedFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-search-results-unchanged");
    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
    expect(hasPendingFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
  });

  it("makes unchanged GSTR-2B search results explicitly retryable", async () => {
    const scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-2B",
    };
    const documentRef = createGstDocument(`
      <main>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected></option></select>
          <select id="retTyp"><option selected>GSTR-2B</option></select>
          <button id="lotsearch" type="button">Search</button>
        </form>
        <section aria-label="Search results"><p>No records found</p></section>
      </main>
    `);
    const resultSurface = documentRef.querySelector("section");

    markFiledReturnsSearchPending(documentRef, scope);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, scope)).toBe(false);

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("gstr2b-filed-return-search-results-unchanged");
    expect(hasPendingFiledReturnsSearchForScope(documentRef, scope)).toBe(false);
  });

  it("settles an identical refresh only after the same scope previously settled", async () => {
    const documentRef = createDocument(`
      <main>
        <section aria-label="Search results"><p>No records found</p></section>
      </main>
    `);
    const resultSurface = documentRef.querySelector("section");

    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    consumeSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE);

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
  });

  it("expires same-scope identical-refresh trust", async () => {
    vi.useFakeTimers();
    try {
      const documentRef = createDocument(`
        <main><section aria-label="Search results"><p>No records found</p></section></main>
      `);
      const resultSurface = documentRef.querySelector("section");

      markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
      consumeSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE);
      await vi.advanceTimersByTimeAsync(30_001);

      markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
      resultSurface?.setAttribute("aria-busy", "true");
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
      resultSurface?.removeAttribute("aria-busy");
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
      expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
      expect(hasUnchangedFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
      await vi.advanceTimersByTimeAsync(120_001);
      expect(hasUnchangedFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles when a post-loading result changes text without changing its shape", async () => {
    const documentRef = createDocument(`
      <main>
        <section aria-label="Search results">
          <table><tbody><tr><td data-period>May</td><td>Filed</td><td><button>View</button></td></tr></tbody></table>
        </section>
      </main>
    `);
    const resultSurface = documentRef.querySelector("section");

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    resultSurface?.setAttribute("aria-busy", "true");
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    resultSurface?.removeAttribute("aria-busy");
    const period = documentRef.querySelector("[data-period]");
    if (period) period.textContent = "Apr";

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
  });

  it("does not treat an identical replacement DOM node as fresh result evidence", async () => {
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
    const oldSurface = documentRef.querySelector("section");
    const replacement = documentRef.createElement("section");
    replacement.setAttribute("aria-label", "Search results");
    replacement.innerHTML = "<p>No records found</p>";

    markFiledReturnsSearchPending(documentRef, DEFAULT_SCOPE);
    oldSurface?.replaceWith(replacement);

    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(false);
    expect(hasUnchangedFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
  });

  it("consumes settled not-filed evidence after returning a terminal result", async () => {
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

    const firstResult = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);
    const secondResult = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(firstResult.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
    expect(secondResult.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("does not reuse settled not-filed evidence after a new refresh starts", async () => {
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
    expect(hasSettledFiledReturnsSearchForScope(documentRef, DEFAULT_SCOPE)).toBe(true);
    documentRef.querySelector("section")?.setAttribute("aria-busy", "true");

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
  });

  it("rejects no-record evidence when the scoped month differs despite a stale global match", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Month</label>
        <select data-stale-month><option selected>March</option></select>
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

  it("accepts no-record evidence when the scoped month matches despite a stale global mismatch", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Month</label>
        <select data-stale-month><option selected>February</option></select>
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

    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-positively-not-filed"]),
    );
  });

  it("rejects no-record evidence when visible scoped month controls conflict", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <form name="efiledReturns">
          <select id="finYr"><option selected>2025-26</option></select>
          <select id="optValue"><option selected>Monthly</option></select>
          <label>Month</label>
          <select data-first-month><option selected>March</option></select>
          <label>Tax Period</label>
          <select data-second-month><option selected>February</option></select>
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

  it("allows one unambiguous global field when no filed-return form field exists", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option selected>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option selected>Monthly</option></select>
        <label>Month</label>
        <select><option selected>March</option></select>
        <label>Return Type</label>
        <select><option selected>GSTR3B</option></select>
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

  it("rejects no-record evidence when fallback global fields conflict", async () => {
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <label>Financial Year</label>
        <select><option selected>2025-26</option></select>
        <label>Return Filing Period</label>
        <select><option selected>Monthly</option></select>
        <label>Month</label>
        <select id="month"><option selected>March</option></select>
        <label>Month</label>
        <select><option selected>February</option></select>
        <label>Return Type</label>
        <select><option selected>GSTR3B</option></select>
        <section aria-label="Search results">
          <p>No records found</p>
        </section>
      </main>
    `);
    markPackSubmittedSearch(documentRef, DEFAULT_SCOPE);

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result.safeSignals).not.toContain("filed-return-positively-not-filed");
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
});
