import { describe, expect, it, vi } from "vitest";
import type { FiledReturnsDownloadScope } from "../../src/connectors/gst/filed-returns-contracts";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import { detectPostClickBlockedState } from "../../src/connectors/gst/filed-returns-post-click-blocked-state";
import {
  DEFAULT_SCOPE,
  createDocument,
  createGstDocument,
  makeLayoutVisible,
} from "./filed-returns-flow.test-helpers";

describe("filed returns flow — GSTR-1 artifact acquisition", () => {
  it("does not click Back from a filed GSTR-1 page without recognized download controls", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <a href="#">[Go Back]</a>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let backClicked = 0;
    documentRef.querySelector("a")?.addEventListener("click", (event) => {
      event.preventDefault();
      backClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr-1-detail-route", "filed-gstr1-summary-view-pending"]),
    );
    expect(backClicked).toBe(0);
  });

  it("waits for GSTR-1 controls on an authenticated partial subroute", async () => {
    const documentRef = createGstDocument(
      `<main><h1>GSTR-1</h1><p>The return workspace is loading.</p></main>`,
      "https://return.gst.gov.in/returns/auth/gstr1/dashboard",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: expect.arrayContaining(["filed-gstr1-controls-pending"]),
    });
    expect(result.userAction).toBeUndefined();
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

  it("dismisses the GST summary overlay even when it is not marked as a modal", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns / GSTR-3B</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button data-download>DOWNLOAD FILED GSTR-3B</button>
        <section data-summary-overlay>
          <h2>System generated summary for GSTR-3B:</h2>
          <table><tbody><tr><td>Summary status</td><td>Yes</td></tr></tbody></table>
          <button data-close>CLOSE</button>
        </section>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let downloadClicked = 0;
    documentRef.querySelector("[data-download]")?.addEventListener("click", () => {
      downloadClicked += 1;
    });
    documentRef.querySelector("[data-close]")?.addEventListener("click", () => {
      documentRef.querySelector("[data-summary-overlay]")?.remove();
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
    expect(documentRef.querySelector("[data-summary-overlay]")).toBeNull();
    expect(downloadClicked).toBe(0);
  });

  it("returns a retryable block without mutating a portal-owned summary overlay", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns / GSTR-3B</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - March</div>
        <button data-download>DOWNLOAD FILED GSTR-3B</button>
        <section class="modal show" style="display:block">
          <h2>System generated summary for GSTR-3B:</h2>
          <button aria-label="Close">x</button>
        </section>
        <div class="modal-backdrop show"></div>
      </main>
    `);
    makeLayoutVisible(documentRef);
    documentRef.body.classList.add("modal-open");
    const modal = documentRef.querySelector<HTMLElement>(".modal");
    const backdrop = documentRef.querySelector<HTMLElement>(".modal-backdrop");
    const modalStyle = modal?.getAttribute("style");

    const result = await runFiledReturnsDownloadStep(documentRef, DEFAULT_SCOPE);

    expect(result).toMatchObject({
      state: "blocked",
      safeSignals: expect.arrayContaining([
        "detail-summary-modal-close-blocked",
        "detail-summary-modal",
      ]),
      userAction: { type: "WAIT_FOR_PORTAL_AVAILABILITY", canResume: true },
    });
    expect(modal?.isConnected).toBe(true);
    expect(modal?.getAttribute("style")).toBe(modalStyle);
    expect(documentRef.body.classList.contains("modal-open")).toBe(true);
    expect(backdrop?.isConnected).toBe(true);
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

  it("canonicalizes abbreviated detail periods before declaring the download ready", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - Mar</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
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
  });

  it("canonicalizes September detail abbreviations before declaring the download ready", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-3B - Monthly Return</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - Sept</div>
        <button>DOWNLOAD FILED GSTR-3B</button>
      </main>
    `);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      ...DEFAULT_SCOPE,
      period: "September",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-detail-period:September",
        "filed-return-detail-financial-year:2025-26",
      ]),
    );
  });

  it("treats the filed GSTR-1 View Summary page as PDF-download ready", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <nav>Returns / Filed Returns</nav>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-download-ready",
        "filed-return-detail-period:May",
        "filed-return-detail-financial-year:2025-26",
        "filed-return-detail-type:GSTR-1",
      ]),
    );
  });

  it("returns from the filed GSTR-1 View Summary page before an Excel-only trigger", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <nav>Returns / Filed Returns</nav>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    makeLayoutVisible(documentRef);
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-back-clicked"]),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("requires the Returns Dashboard when a mismatched GSTR-1 summary has no dashboard control", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    makeLayoutVisible(documentRef);
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result).toMatchObject({
      state: "candidate-not-found",
      safeSignals: expect.arrayContaining([
        "filed-gstr1-scope-switch-navigation",
        "filed-return-detail-period:May",
        "no-return-dashboard-candidate",
      ]),
      userAction: { type: "NAVIGATE_TO_SUPPORTED_PAGE", canResume: true },
    });
    expect(back).not.toHaveBeenCalled();
  });

  it("prefers portal navigation over history when switching from a prior GSTR-1 summary", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <a data-return-dashboard href="/returns/auth/dashboard">Returns Dashboard</a>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    makeLayoutVisible(documentRef);
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);
    let returnDashboardClicked = 0;
    documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", (event) => {
      event.preventDefault();
      returnDashboardClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-scope-switch-navigation",
        "return-dashboard-candidate-clicked",
        "filed-return-detail-period:May",
      ]),
    );
    expect(returnDashboardClicked).toBe(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("prefers portal navigation over Back when switching from a prior GSTR-1 detail", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <a data-return-dashboard href="/returns/auth/dashboard">Returns Dashboard</a>
          <h1>GSTR-1</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - May</div>
          <button data-back>BACK</button>
          <button>Download Details from E-Invoices (Excel)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    makeLayoutVisible(documentRef);
    let returnDashboardClicked = 0;
    let backClicked = 0;
    documentRef.querySelector("[data-return-dashboard]")?.addEventListener("click", (event) => {
      event.preventDefault();
      returnDashboardClicked += 1;
    });
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      backClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-gstr1-scope-switch-navigation",
        "return-dashboard-candidate-clicked",
      ]),
    );
    expect(returnDashboardClicked).toBe(1);
    expect(backClicked).toBe(0);
  });

  it("does not leave a filed GSTR-1 summary for the requested period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <div>Financial Year - 2025-26</div>
          <div>Tax Period - April</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum/",
    );
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toContain("filed-return-download-ready");
    expect(back).not.toHaveBeenCalled();
  });

  it("does not leave a filed GSTR-1 summary when its visible scope is incomplete", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1 Summary</h1>
          <div>Status - Filed</div>
          <button>DOWNLOAD SUMMARY (PDF)</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/gstr1sum",
    );
    const view = documentRef.defaultView;
    if (!view) throw new Error("Expected JSDOM window.");
    const back = vi.spyOn(view.history, "back").mockImplementation(() => undefined);

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("ready");
    expect(back).not.toHaveBeenCalled();
  });

  it("classifies the GSTR-1 e-invoice no-details modal after the capture click", async () => {
    const documentRef = createDocument(`
      <main>
        <nav>Returns / Filed Returns</nav>
        <h1>GSTR-1</h1>
        <div>Status - Filed</div>
        <div>Financial Year - 2025-26</div>
        <div>Return Period - May</div>
        <button data-excel>Download Details from E-Invoices (Excel)</button>
      </main>
    `);
    makeLayoutVisible(documentRef);
    let excelClicked = 0;
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
      globalThis.setTimeout(() => {
        const modal = documentRef.createElement("section");
        modal.setAttribute("role", "dialog");
        modal.innerHTML = `
          <h2>Information</h2>
          <p>No details available for download (This is relevant only if you have reported e-invoices).</p>
          <button>OK</button>
        `;
        documentRef.body.append(modal);
      }, 400);
    });

    const target = {
      actionId: "test-action",
      artifactType: "EXCEL" as const,
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1" as const,
    };
    documentRef.querySelector<HTMLElement>("[data-excel]")?.click();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 450));
    const result = detectPostClickBlockedState(documentRef, target, [
      "filed-return-download-clicked",
      "filed-gstr1-download-clicked",
    ]);

    expect(result?.state).toBe("blocked");
    expect(result?.safeSignals).toEqual(
      expect.arrayContaining([
        "filed-return-download-clicked",
        "filed-gstr1-download-clicked",
        "filed-gstr1-excel-no-details-available",
      ]),
    );
    expect(excelClicked).toBe(1);
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

  it("opens the filed GSTR-1 View Summary page before the PDF download", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let excelClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-view-clicked"]),
    );
    expect(summaryClicked).toBe(1);
    expect(excelClicked).toBe(0);
  });

  it("waits for GSTR-1 View Summary instead of treating an early Excel control as PDF-ready", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - April</p>
          <button data-excel type="button">Download details of E-invoices in Excel</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/dashboard",
    );
    let excelClicked = 0;
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual([
      "filed-gstr1-target-bound-detail",
      "filed-gstr1-summary-view-pending",
    ]);
    expect(excelClicked).toBe(0);
  });

  it("opens GSTR-1 View Summary when the detail page has no Excel control", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
  });

  it("opens GSTR-1 View Summary on a target-bound portal detail subroute", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - April</p>
          <button data-summary type="button">VIEW SUMMARY</button>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1/dashboard",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "April",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
  });

  it("opens a GSTR-1 View Summary input control on the detail page", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - May</p>
          <input data-summary type="button" value="VIEW SUMMARY" />
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
  });

  it("opens a GSTR-1 View Summary JavaScript anchor without running its URL", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Status - Filed</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - May</p>
          <a data-summary href="javascript:void(0)">VIEW SUMMARY</a>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let defaultPrevented = false;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", (event) => {
      summaryClicked += 1;
      defaultPrevented = event.defaultPrevented;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(1);
    expect(defaultPrevented).toBe(true);
  });

  it("opens the filed GSTR-1 View Summary page before a combined PDF and Excel run", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let excelClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });
    documentRef.querySelector("[data-excel]")?.addEventListener("click", () => {
      excelClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-view-clicked"]),
    );
    expect(summaryClicked).toBe(1);
    expect(excelClicked).toBe(0);
  });

  it("uses the filed GSTR-1 route as return-type evidence before View Summary navigation", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "PDF",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Filed return detail</h1>
          <section>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">VIEW SUMMARY PROCEED TO FILE/SUMMARY</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
            <button data-back type="button">Back</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    let backClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      backClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["filed-gstr1-summary-view-clicked"]),
    );
    expect(summaryClicked).toBe(1);
    expect(backClicked).toBe(0);
  });

  it("does not leave the filed GSTR-1 detail page before an Excel-only run", async () => {
    const gstr1Scope: FiledReturnsDownloadScope = {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    };
    const documentRef = createGstDocument(
      `
        <main>
          <h1>View Filed Returns</h1>
          <h2>GSTR-1</h2>
          <section>
            <p>Return Type - GSTR-1</p>
            <p>Financial Year - 2025-26</p>
            <p>Tax Period - May</p>
            <p>Status - Filed</p>
            <button data-summary type="button">View Summary</button>
            <button data-excel type="button">Download details of E-invoices in Excel</button>
          </section>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );
    let summaryClicked = 0;
    documentRef.querySelector("[data-summary]")?.addEventListener("click", () => {
      summaryClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, gstr1Scope);

    expect(result.state).toBe("ready");
    expect(result.safeSignals).not.toContain("filed-gstr1-summary-view-clicked");
    expect(summaryClicked).toBe(0);
  });

  it("waits for a target-bound GSTR-1 Excel control instead of blocking immediately", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-1</h1>
          <p>Return Type - GSTR-1</p>
          <p>Financial Year - 2025-26</p>
          <p>Tax Period - May</p>
          <p>Status - Filed</p>
        </main>
      `,
      "https://return.gst.gov.in/returns/auth/gstr1",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-1",
    });

    expect(result).toMatchObject({
      state: "clicked",
      safeSignals: ["filed-gstr1-target-bound-detail", "filed-gstr1-excel-control-pending"],
    });
  });
});
