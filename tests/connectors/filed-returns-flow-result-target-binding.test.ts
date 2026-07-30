import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import {
  hasPendingFiledReturnsSearchForScope,
  markFiledReturnsSearchPending,
} from "../../src/connectors/gst/filed-returns-search-state";
import {
  DEFAULT_SCOPE,
  createDocument,
  markPackSubmittedSearch,
  createFilterBoundGstr1Results,
} from "./filed-returns-flow.test-helpers";

describe("filed returns flow — result identity and target binding", () => {
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

  it("automatically clicks only the exact filed GSTR-1 result row once", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-1",
    };
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR-3B</td><td>2025-26</td><td>March</td><td><button data-gstr3b>View</button></td></tr>
            <tr><td>GSTR1</td><td>2025-26</td><td>March</td><td><button data-gstr1>View</button></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let gstr3bClicked = 0;
    let gstr1Clicked = 0;
    documentRef.querySelector("[data-gstr3b]")?.addEventListener("click", () => {
      gstr3bClicked += 1;
    });
    Object.defineProperty(documentRef.querySelector("[data-gstr1]"), "innerText", {
      configurable: true,
      value: "View",
    });
    documentRef.querySelector("[data-gstr1]")?.addEventListener("click", () => {
      gstr1Clicked += 1;
    });

    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const result = await runFiledReturnsDownloadStep(documentRef, scope);

      expect(result.state).toBe("clicked");
      expect(result.scopeId).toBe("gst-filed-returns-gstr1-pdf-private-v0");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-gstr1-result-view-auto-clicked",
          "filed-return-result-view-clicked",
          "result-row-gstr1",
          "filed-return-result-period:March",
        ]),
      );
      expect(gstr3bClicked).toBe(0);
      expect(gstr1Clicked).toBe(1);

      const pending = await runFiledReturnsDownloadStep(documentRef, scope);
      expect(pending.state).toBe("clicked");
      expect(pending.safeSignals).toContain("filed-gstr1-result-view-navigation-pending");
      expect(gstr1Clicked).toBe(1);

      now.mockReturnValue(4_000);
      const retry = await runFiledReturnsDownloadStep(documentRef, scope);
      expect(retry.state).toBe("user-action-required");
      expect(retry.safeSignals).toEqual(
        expect.arrayContaining([
          "filed-gstr1-result-view-user-action-required",
          "filed-gstr1-result-view-auto-attempt-failed",
        ]),
      );
      expect(retry.userAction).toMatchObject({ canResume: true });
      expect(gstr1Clicked).toBe(1);
    } finally {
      now.mockRestore();
    }
  });

  it("automatically activates a target-bound filed GSTR-1 JavaScript View anchor", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "March",
      returnType: "GSTR-1",
    };
    const documentRef = createDocument(`
      <main>
        <h1>View Filed Returns</h1>
        <table>
          <thead><tr><th>Return Type</th><th>Financial Year</th><th>Period</th><th>View/Download</th></tr></thead>
          <tbody>
            <tr><td>GSTR1</td><td>2025-26</td><td>March</td><td><a data-view href="javascript:void(0)">View</a></td></tr>
          </tbody>
        </table>
      </main>
    `);
    let clicked = 0;
    documentRef.querySelector("[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-result-view-auto-clicked");
    expect(clicked).toBe(1);
  });

  it("automatically clicks one exact filter-bound GSTR-1 row", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results();
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-result-view-auto-clicked", "result-row-gstr1"]),
    );
    expect(clicked).toBe(1);
  });

  it("resubmits GSTR-1 filters instead of trusting an untracked result row", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results();
    let clicked = 0;
    let searched = 0;
    documentRef.querySelector("button[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searched += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-return-filters-selected", "search-clicked"]),
    );
    expect(clicked).toBe(0);
    expect(searched).toBe(1);
  });

  it("waits for one pending GSTR-1 search instead of submitting it again", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0);
    let searched = 0;
    documentRef.querySelector("#lotsearch")?.addEventListener("click", () => {
      searched += 1;
    });
    markFiledReturnsSearchPending(documentRef, scope);

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(hasPendingFiledReturnsSearchForScope(documentRef, scope)).toBe(true);
    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: ["filed-return-search-results-pending"],
    });
    expect(searched).toBe(0);
  });

  it("does not trust a filter-bound GSTR-1 row after the selected period changes", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results();
    markPackSubmittedSearch(documentRef, scope);
    const month = documentRef.querySelector<HTMLSelectElement>("#month");
    if (month) month.value = "May";
    let clicked = 0;
    documentRef.querySelector("button[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("blocks ambiguous filter-bound GSTR-1 rows instead of choosing one", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(2);
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    for (const view of Array.from(documentRef.querySelectorAll("button[data-view]"))) {
      view.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toContain("filed-return-result-row-ambiguous");
    expect(clicked).toBe(0);
  });

  it("automatically clicks one exact filter-bound GSTR-1 result card", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-result-view-auto-clicked",
        "filed-return-filter-bound-result-view-clicked",
      ]),
    );
    expect(clicked).toBe(1);

    const pending = await runFiledReturnsDownloadStep(documentRef, scope);
    expect(pending.safeSignals).toContain("filed-gstr1-result-view-navigation-pending");
  });

  it("rejects a filter-bound GSTR-1 card with a conflicting explicit period and FY", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef.querySelector("article")?.append(" Return period: May FY 2024-25");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("rejects a filter-bound GSTR-1 card when a cadence label precedes a conflicting month", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef
      .querySelector("article")
      ?.append(" Return Filing Period: Monthly Tax Period: May FY 2025-26");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("rejects malformed explicit scope labels on a filter-bound GSTR-1 card", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef.querySelector("article")?.append(" Tax Period: Unknown FY 2025/27");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("rejects a filter-bound GSTR-1 row with a conflicting slash-form FY", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results();
    documentRef.querySelector("tbody tr td:nth-child(2)")?.append(" FY 2024/25");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
  });

  it("accepts a filter-bound GSTR-1 card with matching explicit period and FY", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef
      .querySelector("article")
      ?.append(" Return period: Apr FY 2025-26 Filed on 15 May 2025");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("clicked");
    expect(clicked).toBe(1);
  });

  it("blocks duplicate filter-bound GSTR-1 result cards", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 2);
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    for (const view of Array.from(documentRef.querySelectorAll("button[data-card-view]"))) {
      view.addEventListener("click", () => {
        clicked += 1;
      });
    }

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("blocked");
    expect(result.safeSignals).toContain("filed-return-result-row-ambiguous");
    expect(clicked).toBe(0);
  });

  it("rejects a filter-bound card that mixes GSTR-1 with another return identity", async () => {
    const scope: FiledReturnsDownloadScope = {
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    };
    const documentRef = createFilterBoundGstr1Results(0, 1);
    documentRef.querySelector("article")?.append(" GSTR-3B");
    markPackSubmittedSearch(documentRef, scope);
    let clicked = 0;
    documentRef.querySelector("button[data-card-view]")?.addEventListener("click", () => {
      clicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, scope);

    expect(result.state).toBe("candidate-not-found");
    expect(result.safeSignals).toContain("filed-return-result-row-not-found");
    expect(clicked).toBe(0);
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
});
