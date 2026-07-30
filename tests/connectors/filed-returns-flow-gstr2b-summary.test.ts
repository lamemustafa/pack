import { describe, expect, it, vi } from "vitest";
import { runFiledReturnsDownloadStep } from "../../src/connectors/gst/filed-returns-flow";
import {
  createGstDocument,
  createGstr2bSummaryDocument,
  makeLayoutVisible,
} from "./filed-returns-flow.test-helpers";

describe("filed returns flow — GSTR-2B summary identity and acquisition", () => {
  it("recognises the matching GSTR-2B summary page as portal-capture ready", async () => {
    const documentRef = createGstr2bSummaryDocument();

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-summary-route",
        "gstr2b-visible-period-verified",
        "gstr2b-download-ready",
        "filed-return-download-ready",
      ]),
    );
  });

  it("waits for the GST portal to close a session warning after Continue", async () => {
    const documentRef = createGstr2bSummaryDocument(`
      <section class="modal show" role="dialog">
        <h2>Warning</h2>
        <p>Your logged in session will expire in next 02:54 Minutes. Click Continue to extend your session, or click Logout to logout of the application.</p>
        <a data-logout href="/services/logout">Logout</a>
        <button data-continue>Continue</button>
      </section>
      <div class="modal-backdrop show"></div>
    `);
    let continueClicked = 0;
    let logoutClicked = 0;
    documentRef.querySelector("[data-continue]")?.addEventListener("click", () => {
      continueClicked += 1;
    });
    documentRef.querySelector("[data-logout]")?.addEventListener("click", (event) => {
      event.preventDefault();
      logoutClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "safe-dialog-dismissed",
        "dialog-continue",
        "safe-dialog-still-visible",
        "gstr2b-dialog-dismissal-waiting",
      ]),
    );
    expect(continueClicked).toBe(1);
    expect(logoutClicked).toBe(0);
    expect(documentRef.querySelector<HTMLElement>(".modal")?.style.display).not.toBe("none");
    expect(documentRef.querySelector(".modal-backdrop")).not.toBeNull();
  });

  it("ignores unrelated GSTR-2B localStorage when deciding portal-capture readiness", async () => {
    const documentRef = createGstr2bSummaryDocument();
    vi.stubGlobal("localStorage", documentRef.defaultView?.localStorage);
    localStorage.setItem("rtn_prd", "042026");
    localStorage.setItem("sum042026", JSON.stringify({ summary: { available: true } }));

    try {
      const result = await runFiledReturnsDownloadStep(documentRef, {
        artifactType: "PDF_AND_EXCEL",
        financialYear: "2026-27",
        period: "May",
        returnType: "GSTR-2B",
      });

      expect(result.state).toBe("ready");
      expect(result.safeSignals).toEqual(
        expect.arrayContaining([
          "gstr2b-summary-route",
          "gstr2b-visible-period-verified",
          "gstr2b-download-ready",
          "filed-return-download-ready",
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits on the GSTR-2B app route until summary download controls render", async () => {
    const documentRef = createGstDocument(
      `
        <app-root>
          <h1>GSTR-2B</h1>
          <div class="loader"></div>
        </app-root>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr2b-auth-route", "gstr2b-summary-loading"]),
    );
  });

  it("waits on a blank GSTR-2B summary route instead of treating it as capture-ready", async () => {
    const documentRef = createGstDocument(
      `
        <app-root>
          <div class="loader"></div>
        </app-root>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining(["gstr2b-auth-route", "gstr2b-summary-loading"]),
    );
    expect(result.safeSignals).not.toContain("gstr2b-download-ready");
  });

  it("returns from a stale GSTR-2B summary page when the visible period does not match", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>April 2026 Auto-drafted ITC Statement</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-summary-period-mismatch",
        "gstr2b-summary-back-clicked",
      ]),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("rejects incidental GSTR-2B month and year text without labelled scope evidence", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Generated in May for the 2026-27 portal cycle.</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-labelled-period-evidence-missing",
        "gstr2b-summary-period-mismatch",
        "gstr2b-summary-back-clicked",
      ]),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("accepts the structured GSTR-2B statement identity when labels are absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>May 2026 Auto-drafted ITC Statement</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toContain("gstr2b-visible-period-verified");
  });

  it("accepts the structured GSTR-2B statement identity in a visible div", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <div>May 2026 Auto-drafted ITC Statement</div>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
  });

  it("accepts the split GSTR-2B statement identity when labels are absent", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <p>May 2026</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toContain("gstr2b-visible-period-verified");
  });

  it("ignores an unrelated footer date beside a split GSTR-2B statement identity", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <p>May 2026</p>
          <footer><p>April 2026</p></footer>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
  });

  it("rejects ambiguous split GSTR-2B statement periods", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <p>April 2026</p>
          <p>May 2026</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.safeSignals).toContain("gstr2b-labelled-period-evidence-missing");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("rejects accessibility-only GSTR-2B statement period evidence", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>Auto-drafted ITC Statement for the month</h1>
          <p>GSTR-2B</p>
          <button aria-label="May 2026"></button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.safeSignals).toContain("gstr2b-labelled-period-evidence-missing");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("uses the GSTR-2B Back to Dashboard control before browser history for stale summaries", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>May 2026 Auto-drafted ITC Statement</p>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    const back = vi.spyOn(documentRef.defaultView!.history, "back").mockImplementation(() => {});
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF",
      financialYear: "2026-27",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-summary-period-mismatch",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("trusts explicit GSTR-2B period labels over incidental page month text", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Financial Year - 2025-26</p>
          <p>Return Period - April</p>
          <aside>Quarter 1: April May June</aside>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "June",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
  });

  it("uses GSTR-2B server page config to verify the requested summary period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Auto-drafted ITC Statement</p>
          <aside>Site year 2026-27</aside>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "052025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("ready");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-summary-route",
        "gstr2b-visible-period-verified",
        "gstr2b-download-ready",
      ]),
    );
  });

  it("rejects GSTR-2B server scope that conflicts with the visible statement", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>April 2025 Auto-drafted ITC Statement</p>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "052025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-server-visible-period-conflict",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
  });

  it("rejects a statement heading that conflicts with matching GSTR-2B labels", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <p>Financial Year - 2025-26</p>
          <p>Return Period - May</p>
          <p>April 2025 Auto-drafted ITC Statement</p>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "052025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toContain("gstr2b-visible-period-mismatch");
    expect(result.safeSignals).toContain("gstr2b-server-visible-period-conflict");
  });

  it("returns from a GSTR-2B summary when server page config identifies another period", async () => {
    const documentRef = createGstDocument(
      `
        <main>
          <h1>GSTR-2B</h1>
          <button data-back>BACK TO DASHBOARD</button>
          <button>DOWNLOAD GSTR-2B SUMMARY (PDF)</button>
          <button>DOWNLOAD GSTR-2B DETAILS (EXCEL)</button>
        </main>
        <script>
          var server_urls = {
            "FIN_YEAR": "2025-26",
            "RETURN_PERIOD": "042025",
            "FORM_TYPE": "GSTR2B"
          };
        </script>
      `,
      "https://gstr2b.gst.gov.in/gstr2b/auth/gstr2b/summary",
    );
    makeLayoutVisible(documentRef);
    let dashboardBackClicked = 0;
    documentRef.querySelector("[data-back]")?.addEventListener("click", () => {
      dashboardBackClicked += 1;
    });

    const result = await runFiledReturnsDownloadStep(documentRef, {
      artifactType: "PDF_AND_EXCEL",
      financialYear: "2025-26",
      period: "May",
      returnType: "GSTR-2B",
    });

    expect(result.state).toBe("clicked");
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "gstr2b-visible-period-mismatch",
        "gstr2b-server-period-mismatch",
        "gstr2b-summary-dashboard-back-clicked",
      ]),
    );
    expect(dashboardBackClicked).toBe(1);
  });
});
